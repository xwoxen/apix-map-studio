// Game export: export a copy of apix_pvp_arena with two spawns and a town, then check every staged file against
// the manifest hashes, decode server_attr sector by sector, compare it with attr.atr, check object footprints
// and parse regen.txt / npc.txt with the server's column rules.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const assert = require("assert");
const { exportGame } = require("../mapgen/export-game");
const { decompress } = require("../mapgen/lzo");
const { writeSpawns } = require("../mapgen/spawns");
const { parseAreaData } = require("../maplib");

const editorRoot = process.argv[2] || "C:/Users/micha/Documents/we_remix_v59__20260716-1745";
const name = "apix_pvp_arena";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mapstudio-export-"));
const mapDir = path.join(tmp, name);
fs.mkdirSync(path.join(tmp, "textureset"));
fs.copyFileSync(path.join(editorRoot, "textureset", `${name}.txt`), path.join(tmp, "textureset", `${name}.txt`));
fs.cpSync(path.join(editorRoot, name), mapDir, { recursive: true, filter: (src) => !/_studio(_backup)?$/.test(src) });
if (!fs.existsSync(path.join(mapDir, "_export", "atlas"))) {
  // the export needs Map Studio's minimap and atlas; a plain copy of the map's tiles stands in for them here
  fs.mkdirSync(path.join(mapDir, "_export", "atlas"), { recursive: true });
  fs.writeFileSync(path.join(mapDir, "_export", "atlas", `${name}_atlas.dds`), Buffer.alloc(128));
  fs.writeFileSync(path.join(mapDir, "_export", "atlas", "atlas.sub"), "title subImage\r\n");
  if (!fs.existsSync(path.join(mapDir, "000000", "minimap.dds"))) fs.writeFileSync(path.join(mapDir, "000000", "minimap.dds"), Buffer.alloc(128));
}
writeSpawns(mapDir, [
  { id: 1, type: "m", vnum: 101, x: 60.4, y: 200.2, radius: 12, count: 7, respawn: 90, direction: 0 },
  { id: 2, type: "npc", vnum: 20016, x: 128, y: 188, radius: 0, count: 1, respawn: 60, direction: 0 }
], { x: 128, y: 182 });

const out = path.join(tmp, "staged");
const m = exportGame(mapDir, { index: 90, base: [665600, 25600], out, editorRoot: tmp });

// every file listed with the right hash, and nothing unlisted
const listed = new Set(m.files.map((f) => f.path));
for (const f of m.files) {
  const data = fs.readFileSync(path.join(out, f.path));
  assert.strictEqual(crypto.createHash("sha256").update(data).digest("hex"), f.sha256, `hash of ${f.path}`);
}
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.relative(out, path.join(d, e.name)).replace(/\\/g, "/")]));
for (const f of walk(out)) if (f !== "manifest.json") assert.ok(listed.has(f), `${f} missing from the manifest`);
assert.deepStrictEqual(m.town, [128, 182], "town from spawns.json");

// server_attr: 4×4 sectors of 128×128 DWORDs, block/water/no-PvP match attr.atr, OBJECT only near objects
const sa = fs.readFileSync(path.join(out, "server", name, "server_attr"));
const w = sa.readInt32LE(0), h = sa.readInt32LE(4);
assert.deepStrictEqual([w, h], [4, 4]);
let p = 8;
const sectors = [];
for (let i = 0; i < w * h; i++) {
  const n = sa.readInt32LE(p); p += 4;
  const d = decompress(sa.subarray(p, p + n), 70000); p += n;
  assert.strictEqual(d.length, 65536, `sector ${i} size`);
  sectors.push(d);
}
assert.strictEqual(p, sa.length, "trailing bytes in server_attr");
const cell = (gx, gy) => sectors[Math.floor(gy / 128) * w + Math.floor(gx / 128)].readUInt32LE(((gy % 128) * 128 + (gx % 128)) * 4);
const atr = fs.readFileSync(path.join(mapDir, "000000", "attr.atr"));
const objects = parseAreaData(fs.readFileSync(path.join(mapDir, "000000", "AreaData.txt"), "latin1"));
let mismatch = 0, objectCells = 0, stray = 0;
for (let gy = 0; gy < 512; gy++) for (let gx = 0; gx < 512; gx++) {
  const v = cell(gx, gy);
  if ((v & 7) !== (atr[6 + Math.floor(gy / 2) * 256 + Math.floor(gx / 2)] & 7)) mismatch++;
  if (v & 128) {
    objectCells++;
    if (!objects.some((o) => Math.hypot(o.x / 100 - gx / 2, -o.y / 100 - gy / 2) < 8)) stray++;
  }
}
assert.strictEqual(mismatch, 0, "server_attr flags differ from attr.atr");
assert.ok(objectCells > 100, "no object footprints");
assert.strictEqual(stray, 0, "OBJECT cells far from every object");
assert.strictEqual(cell(256, 364) & 129, 0, "town cell is blocked");

// regen.txt / npc.txt: type, x, y, half w, half h, z, direction, time, percent, count, vnum
const rows = (f) => fs.readFileSync(path.join(out, "server", name, f), "latin1").split("\n").filter(Boolean).map((l) => l.split("\t"));
const regen = rows("regen.txt"), npc = rows("npc.txt");
assert.deepStrictEqual(regen, [["m", "60", "200", "12", "12", "0", "0", "90s", "100", "7", "101"]]);
assert.deepStrictEqual(npc, [["m", "128", "188", "0", "0", "0", "0", "1m", "100", "1", "20016"]]);
assert.deepStrictEqual(m.spawns.warnings, []);

// shadow maps: 256×256 words and a DXT1 texture
const terr = path.join(out, "client", name, name, "000000");
assert.strictEqual(fs.statSync(path.join(terr, "shadowmap.raw")).size, 131072);
assert.strictEqual(fs.readFileSync(path.join(terr, "shadowmap.dds")).toString("latin1", 84, 88), "DXT1");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`ok: export staged ${m.files.length} files, server_attr ${w}×${h} sectors (${objectCells} object cells), ${regen.length} regen + ${npc.length} npc rows`);
