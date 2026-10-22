// Asset catalog: every library object with its real size, collision, textures, category, game availability and hand rating.
// Buildings: Granny bounds via tools/gr2info (client Granny 2.4). Trees: SpeedTree bounds via tools/spt2json.
// Collision: <model>.mdatr shapes (footprint up to walking height). Ratings: data/ratings.json.
// Writes %APPDATA%\APIX Map Studio\catalog.json (read by Map Studio and the MCP tool mapstudio_catalog).
//
// usage: node tools/build-catalog.js [--force]     (--force recomputes cached Granny / SpeedTree results)
const fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const { getLibrary, resolveAsset, PACK_ROOT, APIX_ROOT } = require("../assets");
const { parseMdatr } = require("../mapgen/mdatr");
const { shapePoints, REACH } = require("../mapgen/collision");

const APPDATA = path.join(process.env.APPDATA, "APIX Map Studio");
const OUT = path.join(APPDATA, "catalog.json");
const CACHE = path.join(APPDATA, "catalog-cache.json");          // gr2 path + mtime -> gr2info line
const GR2INFO = path.join(__dirname, "gr2info", "gr2info.exe");
const SPT2JSON = path.join(__dirname, "spt2json", "spt2json.exe");
const CLIENT_DIST = path.join(APIX_ROOT, "apix-client", "dist"), CLIENT_BIN = path.join(APIX_ROOT, "apix-client", "bin");
const force = process.argv.includes("--force");
const ratings = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "ratings.json"), "utf8"));

const indexed = new Set(fs.readFileSync(path.join(PACK_ROOT, "Index"), "utf8").split(/\r?\n/).map((l) => l.split("\t")[0].trim().toLowerCase()).filter(Boolean));
const packOf = (file) => { const rel = path.relative(PACK_ROOT, file); return rel.startsWith("..") ? null : rel.split(path.sep)[0].toLowerCase(); };

const CATEGORIES = [
  ["tree", /tree|pine|oak|birch|aspen|ginkgo|deodar|cedar|spruce|maple|beech|palm|bamboo|willow|sequoia|cypress|baobab|sassafras|pagoda[0-9_]/i],
  ["plant", /bush|shrub|plant|flower|grass|fern|lotus|aloe|ivy|reed|weed|mushroom/i],
  ["rock", /rock|stone(?!light)|cliff|boulder|pebble|crag/i],
  ["building", /house|hut|tent|home|building|pavil|temple|tower|castle|shop|inn|guest|hall|camp_.*build|workhouse|shrine_?\d|pagoda/i],
  ["wall", /wall|fence|gate|door|palisade|barrier|arch/i],
  ["bridge", /bridge|stair/i],
  ["light", /lamp|light|lantern|brazier|torch|candle|fire/i],
  ["monument", /statue|altar|grave|tomb|totem|monument|lion|stele|obelisk|ruin|pillar|column/i],
  ["prop", /table|chair|bench|box|barrel|sack|jar|basket|cart|crate|well|sign|board|flag|banner|vase|pot|bucket|tool|weapon|rack|bed/i],
];
const categoryOf = (p) => { const s = `${p.name} ${p.model}`; for (const [c, re] of CATEGORIES) if (re.test(s)) return c; return p.type === "Tree" ? "tree" : "other"; };

const normalize = (n) => n.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[\s\-]+/g, "_");
function textureFound(ref, modelFile) {
  const base = path.basename(ref.replace(/\\/g, "/"));
  try { if (fs.readdirSync(path.dirname(modelFile)).some((f) => /\.(dds|tga|png)$/i.test(f) && normalize(f) === normalize(base))) return true; } catch { /* no dir */ }
  const game = ref.replace(/\\/g, "/");
  if (/ymir work\//i.test(game)) for (const ext of [".dds", ".tga", ".png"]) if (resolveAsset(game.replace(/\.[a-z0-9]+$/i, ext))) return true;
  return false;
}

function collisionOf(model) {
  const f = resolveAsset(model.replace(/\.gr2$/i, ".mdatr"));
  if (!f) return { kind: "none" };
  const data = parseMdatr(fs.readFileSync(f));
  if (!data) return { kind: "bad" };
  const pts = data.shapes.flatMap(shapePoints).filter((p) => p[2] <= REACH * 100);
  if (!pts.length) return { kind: "shapes", shapes: data.shapes.length, footprint: [0, 0] };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { kind: "shapes", shapes: data.shapes.length, footprint: [+((x1 - x0) / 100).toFixed(2), +((y1 - y0) / 100).toFixed(2)] };
}

(async () => {
  const lib = [...getLibrary().values()];
  const cache = !force && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
  // 1) Granny bounds for every resolvable .gr2 not cached yet
  const gr2 = new Map();
  for (const p of lib) if (/\.gr2$/i.test(p.model)) { const f = resolveAsset(p.model); if (f) gr2.set(f, `${f}|${fs.statSync(f).mtimeMs}`); }
  const todo = [...gr2.entries()].filter(([, key]) => !cache[key]);
  console.log(`gr2: ${gr2.size} models, ${todo.length} to read`);
  for (let i = 0; i < todo.length; i += 400) {
    const list = path.join(os.tmpdir(), `gr2info-${process.pid}.txt`);
    fs.writeFileSync(list, todo.slice(i, i + 400).map(([f]) => f).join("\n"));
    let out = "";
    try { out = execFileSync(GR2INFO, [list], { encoding: "utf8", maxBuffer: 1 << 28, env: { ...process.env, PATH: `${CLIENT_DIST};${process.env.PATH}` }, windowsHide: true }); }
    catch (e) { out = String(e.stdout || ""); }
    for (const line of out.split(/\r?\n/)) { if (!line.startsWith("{")) continue; try { const j = JSON.parse(line); const key = gr2.get(j.file); if (key) cache[key] = j; } catch { /* partial line */ } }
    process.stdout.write(`  ${Math.min(i + 400, todo.length)}/${todo.length}\r`);
  }
  // 2) SpeedTree bounds (spt2json writes the whole tree; only bounds and texture names are kept)
  const trees = lib.filter((p) => /^tree$/i.test(p.type) && resolveAsset(p.model));
  let treeRuns = 0;
  for (const p of trees) {
    const f = resolveAsset(p.model), key = `${f}|${fs.statSync(f).mtimeMs}`;
    if (cache[key]) continue;
    const tmp = path.join(os.tmpdir(), `spt-${process.pid}.json`);
    try {
      execFileSync(SPT2JSON, [f, tmp], { windowsHide: true, timeout: 30000, env: { ...process.env, PATH: `${CLIENT_BIN};${process.env.PATH}` } });
      const j = JSON.parse(fs.readFileSync(tmp, "utf8"));
      const b = j.bounds;   // [minx, miny, minz, maxx, maxy, maxz] cm
      cache[key] = { file: f, min: b.slice(0, 3), max: b.slice(3, 6), textures: [j.textures.branch, j.textures.composite].filter(Boolean), leaves: j.leaves.length };
    } catch { cache[key] = { file: f, error: 1 }; }
    treeRuns++;
  }
  console.log(`\ntrees: ${trees.length}, ${treeRuns} computed`);
  fs.writeFileSync(CACHE, JSON.stringify(cache));

  // 3) catalog entries
  const items = {};
  const counts = { total: 0, byCategory: {}, bySource: {}, usable: 0, warnings: {} };
  for (const p of lib) {
    const file = p.model ? resolveAsset(p.model) : null;
    const pack = packOf(p.file), modelPack = file ? packOf(file) : null;
    const source = /[\\/]apix_fem[\\/]/i.test(p.file) ? "fem" : pack ? "client" : "editor";
    const inGame = source === "client" && indexed.has(pack) && (!file || (modelPack && indexed.has(modelPack)));
    const e = { crc: p.crc, name: p.name, type: p.type, folder: p.folder, model: p.model, source, inGame, category: categoryOf(p), warnings: [] };
    if (!file && p.model) e.warnings.push("model-missing");
    if (source === "editor") e.warnings.push("editor-only");
    if (source === "fem") e.warnings.push("needs-packing");
    const c = file && cache[`${file}|${fs.statSync(file).mtimeMs}`];
    if (c && !c.error) {
      e.size = [0, 1, 2].map((k) => +((c.max[k] - c.min[k]) / 100).toFixed(2));
      e.bounds = { min: c.min, max: c.max };
      if (c.tris !== undefined) e.tris = c.tris;
      const tex = c.textures || [];
      e.textures = tex;
      const miss = /^tree$/i.test(p.type)
        ? tex.filter((t) => !textureFound(/\.[a-z0-9]{2,4}$/i.test(t) ? t : `${t}.dds`, file))
        : tex.filter((t) => !textureFound(t, file));
      if (miss.length) { e.missingTextures = miss; e.warnings.push("texture-missing"); }
      if (Math.max(e.size[0], e.size[1]) > 40) e.warnings.push("huge");
      if (Math.max(...e.size) < 0.15) e.warnings.push("tiny");
      if (c.min[2] < -100) e.warnings.push("sunk-origin");
    } else if (file && (c && c.error)) {
      // Granny file format 7 (header u32 at 32): the client's Granny 2.4 cannot read it -> invisible in game until converted
      let v = 0; try { const fd = fs.openSync(file, "r"), b = Buffer.alloc(36); fs.readSync(fd, b, 0, 36, 0); fs.closeSync(fd); v = b.readUInt32LE(32); } catch { /* unreadable */ }
      e.warnings.push(v === 7 ? "granny-v7" : "model-unreadable");
    }
    if (/\.gr2$/i.test(p.model || "") && file) {
      e.collision = source === "fem" ? { kind: "none" } : collisionOf(p.model);
      if (e.collision.kind !== "shapes") e.warnings.push("no-collision");
    } else if (/^tree$/i.test(p.type)) e.collision = { kind: "trunk", radius: +Math.max(0.3, (p.treeSize || 1000) / 100 * 0.025).toFixed(2) };
    const r = ratings[p.crc] || ratings[p.name];
    if (r) { e.rating = r.rating; e.reason = r.reason; }
    const BAD = ["model-missing", "texture-missing", "model-unreadable", "granny-v7", "huge", "tiny"];
    e.usable = inGame && !e.warnings.some((w) => BAD.includes(w)) && e.rating !== "avoid" && e.rating !== "rim-only";
    if (source === "fem" && !e.warnings.some((w) => BAD.includes(w)) && e.rating !== "avoid") e.usableAfterPacking = true;
    items[p.crc >>> 0] = e;
    counts.total++; counts.byCategory[e.category] = (counts.byCategory[e.category] || 0) + 1; counts.bySource[source] = (counts.bySource[source] || 0) + 1;
    if (e.usable) counts.usable++;
    for (const w of e.warnings) counts.warnings[w] = (counts.warnings[w] || 0) + 1;
  }
  fs.mkdirSync(APPDATA, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), counts, items }));
  console.log(JSON.stringify(counts, null, 1));
  console.log("written", OUT);
})().catch((e) => { console.error(e); process.exit(1); });
