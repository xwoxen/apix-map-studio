// Asset sheet: renders library objects one by one on a blank test map and puts the shots on one labelled PNG, to check
// how assets really look (snow trees rendering green, props that read wrong, effects) before a map uses them.
// usage: node tools/asset-sheet.js <out.png> <name> [<name> ...] [--ground snow|grass] [--cols 6] [--pitch 14]
//   names are library names (exact, else the first containing match); the map in use is never touched
const fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const { generate } = require("../mapgen/mapgen.js");

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const ground = opt("ground", "grass"), cols = Number(opt("cols", 6)), pitch = Number(opt("pitch", 14));
const [out, ...names] = args;
if (!out || !names.length) { console.log("usage: node tools/asset-sheet.js <out.png> <name> [...] [--ground snow|grass] [--cols 6] [--pitch 14]"); process.exit(1); }

const tmp = path.join(os.tmpdir(), "mapstudio-asset-sheet");
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const tex = ground === "snow" ? "d:/ymir work/terrainmaps/n/snow.m/snow01.dds" : "d:/ymir work/terrainmaps/a/grass/grass 01.dds";
generate({ name: "sheet", sizeX: 4, sizeY: 1, height: () => 32767, texture: () => 1, textures: [{ file: tex }], water: null, objects: () => [] }, tmp, "sheet");

const script = path.join(tmp, "sheet-eval.js");
fs.writeFileSync(script, `(async () => {
  const api = window.__studio.api, names = ${JSON.stringify(names)}, cols = ${cols}, pitch = ${pitch};
  const placed = []; let x = 10;
  for (const n of names) {
    const hits = (await api("search_library", { query: n, limit: 50 })).items;
    const hit = hits.find((e) => e.name.toLowerCase() === n.toLowerCase()) || hits[0];
    if (!hit) { placed.push({ n, missing: true }); continue; }
    const info = (await api("catalog", { query: hit.name, limit: 20 })).items.find((e) => e.crc === hit.crc) || {};
    const s = info.size || [4, 4, 4], w = Math.min(Math.max(s[0], s[1], 4), 60);
    x += w / 2 + 6;
    placed.push({ n: hit.name, crc: hit.crc, x, size: s, usable: info.usable, warn: (info.warnings || []).join(",") });
    x += w / 2 + 6;
  }
  await api("add_objects", { items: placed.filter((p) => !p.missing).map((p) => ({ crc: p.crc, x: p.x, y: 128 })) });
  const W = 300, H = 240, rows = Math.ceil(placed.length / cols);
  const c = document.createElement("canvas"); c.width = W * cols; c.height = (H + 34) * rows;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i], cx = (i % cols) * W, cy = Math.floor(i / cols) * (H + 34);
    if (!p.missing) {
      const size = Math.max(p.size[0], p.size[1], p.size[2], 3);
      const shot = (await api("screenshot", { x: p.x, y: 128, distance: Math.max(10, size * 2.6), yaw: 0, pitch })).png;
      const img = new Image(); img.src = shot; await img.decode();
      g.drawImage(img, cx, cy, W, H);
    }
    g.fillStyle = p.missing ? "#b00" : p.usable === false ? "#b60" : "#000"; g.font = "13px sans-serif";
    g.fillText(p.missing ? p.n + " - nenájdené" : p.n, cx + 4, cy + H + 14);
    if (!p.missing) { g.fillStyle = "#555"; g.font = "11px sans-serif"; g.fillText(p.size.map((v) => v.toFixed(1)).join(" × ") + " m" + (p.usable === false ? "  NEPOUŽITEĽNÉ" : "") + (p.warn ? "  " + p.warn : ""), cx + 4, cy + H + 28); }
  }
  return { placed: placed.map(({ n, usable, missing }) => ({ n, usable, missing })), shots: { sheet: c.toDataURL("image/png") } };
})();
`);
execFileSync(process.execPath, [path.join(__dirname, "..", "test", "run-eval.js"), path.join(tmp, "sheet"), script, path.join(tmp, "out"), "--inplace"], { stdio: ["ignore", "ignore", "inherit"], timeout: 900000 });
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.copyFileSync(path.join(tmp, "out", "sheet.png"), out);
const res = JSON.parse(fs.readFileSync(path.join(tmp, "out", "result.json"), "utf8"));
for (const p of res.placed) console.log(p.missing ? "missing " : p.usable === false ? "unusable" : "ok      ", p.n);
console.log("sheet:", path.resolve(out));
