// Conformance with the client's file formats, over every official map in the client pack: whatever Map Studio reads
// and writes must keep its meaning for the game. Each rule mirrors the client code it comes from:
//   AreaData      GameLib/Area.cpp       objects, rotation yaw#pitch#roll (whole degrees, atoi), height bias
//   height.raw    PRTerrainLib/Terrain   131 x 131 WORD (terrain 128 cells + border)
//   tile.raw      PRTerrainLib/Terrain   258 x 258 BYTE, values index textureset Texture001..N (0 = none)
//   attr.atr      PRTerrainLib/Terrain   magic 2634, 256 x 256 BYTE
//   water.wtr     PRTerrainLib/Terrain   magic 5426, 128 x 128 BYTE + layer heights (LONG; WORD only in legacy files)
//   textureset    PRTerrainLib/TextureSet TextureCount N, blocks Texture001..N in order
// usage: node test/conformance.js [maxMaps]
const fs = require("fs"), path = require("path"), assert = require("assert");
const { parseAreaData, formatAreaData, parseTextureSet, decodeAttr, encodeAttr, decodeWater } = require("../maplib");
const { listSourceMaps } = require("../mapread");
const { PACK_ROOT } = require("../assets");

const limit = Number(process.argv[2] || 1e9);
const findCi = (dir, f) => { try { const n = fs.readdirSync(dir).find((x) => x.toLowerCase() === f.toLowerCase()); return n ? path.join(dir, n) : null; } catch { return null; } };
const maps = [], seen = new Set();
// official maps only: our own deployed apix_* maps were written by Map Studio and are checked by their own builds
for (const m of listSourceMaps()) if (m.dir.startsWith(PACK_ROOT) && !/^apix_/i.test(m.name) && !seen.has(m.dir.toLowerCase())) { seen.add(m.dir.toLowerCase()); maps.push(m); }
// problems = Map Studio would read or write something with another meaning than the client (test fails);
// notes = quirks of the official data itself, the same in Studio and in the game (listed, test passes)
const stats = { maps: 0, tiles: 0, objects: 0, tilted: 0, biased: 0, extra: 0, textures: 0 }, problems = [], notes = new Map();
const problem = (m, msg) => { if (problems.length < 40) problems.push(`${m}: ${msg}`); };
const note = (m, msg) => { if (!notes.has(m)) notes.set(m, msg); };
const same = (a, b) => Math.abs(a - b) < 1e-3;

for (const m of maps.slice(0, limit)) {
  const setting = fs.readFileSync(findCi(m.dir, "setting.txt"), "latin1");
  const size = (setting.match(/MapSize\s+(\d+)\s+(\d+)/) || [0, 0, 0]).slice(1).map(Number);
  const ts = (setting.match(/TextureSet\s+(\S+)/) || [])[1] || "";
  const tsFile = [path.join(PACK_ROOT, "textureset", path.basename(ts.replace(/\\/g, "/"))), path.join(PACK_ROOT, "textureset", "textureset", path.basename(ts.replace(/\\/g, "/")))].find((f) => fs.existsSync(f));
  let texCount = null;
  if (tsFile) {
    const text = fs.readFileSync(tsFile, "latin1"), entries = parseTextureSet(text);
    texCount = Number((text.match(/TextureCount\s+(\d+)/) || [])[1]);
    // the client loads Texture001..TextureCount by name (TextureSet.cpp); Studio looks textures up by that number too
    for (let i = 1; i <= texCount; i++) if (!entries.some((e) => e.index === i)) note(m.name, `textureset has no Texture${String(i).padStart(3, "0")} (TextureCount ${texCount})`);
    stats.textures += entries.length;
  }
  stats.maps++;
  for (let ty = 0; ty < size[1]; ty++) for (let tx = 0; tx < size[0]; tx++) {
    const key = String(tx).padStart(3, "0") + String(ty).padStart(3, "0"), t = findCi(m.dir, key);
    if (!t) continue;
    stats.tiles++;
    const h = findCi(t, "height.raw");
    if (h && fs.statSync(h).size !== 131 * 131 * 2) problem(m.name, `${key} height.raw ${fs.statSync(h).size} B`);
    const tile = findCi(t, "tile.raw");
    if (tile) {
      const b = fs.readFileSync(tile);
      if (b.length !== 258 * 258) problem(m.name, `${key} tile.raw ${b.length} B`);
      else if (texCount !== null) { let mx = 0; for (const v of b) if (v > mx) mx = v; if (mx > texCount) note(m.name, `tile.raw uses texture ${mx}, textureset has ${texCount}`); }
    }
    const at = findCi(t, "attr.atr");
    if (at) {
      const b = fs.readFileSync(at);
      if (b.readUInt16LE(0) !== 2634 || b.readUInt16LE(2) !== 256 || b.readUInt16LE(4) !== 256) problem(m.name, `${key} attr.atr header`);
      else if (!encodeAttr(decodeAttr(b)).equals(b.subarray(0, 6 + 256 * 256))) problem(m.name, `${key} attr.atr round trip`);
    }
    const wt = findCi(t, "water.wtr");
    if (wt) {
      const b = fs.readFileSync(wt);
      if (b.readUInt16LE(0) !== 5426) problem(m.name, `${key} water.wtr magic`);
      else {
        const n = b[6], rest = b.length - 7;
        if (n && rest !== 128 * 128 + 4 * n) problem(m.name, `${key} water.wtr ${n} layers in ${rest} B (WORD heights? Map Studio reads LONG)`);
        const w = decodeWater(b);
        if (w.levels.length !== n) problem(m.name, `${key} water levels ${w.levels.length}/${n}`);
      }
    }
    const ad = findCi(t, "areadata.txt");
    if (!ad) continue;
    const text = fs.readFileSync(ad, "latin1"), objs = parseAreaData(text, key);
    const declared = (text.match(/Start Object/g) || []).length;
    if (objs.length !== declared) problem(m.name, `${key} AreaData parsed ${objs.length} of ${declared} objects`);
    const again = parseAreaData(formatAreaData(objs), key);
    for (let i = 0; i < objs.length; i++) {
      const a = objs[i], b = again[i];
      stats.objects++;
      if (a.pitch || a.roll) stats.tilted++;
      if (a.bias) stats.biased++;
      if (a.extra) stats.extra++;
      for (const k of ["yaw", "pitch", "roll"]) if (!Number.isInteger(a[k])) problem(m.name, `${key} object ${i} ${k} ${a[k]} is not whole (client reads atoi)`);
      if (!b || b.crc !== a.crc || !same(b.x, a.x) || !same(b.y, a.y) || !same(b.z, a.z) || !same(b.bias, a.bias)
        || !same(((b.yaw % 360) + 360) % 360, ((a.yaw % 360) + 360) % 360) || !same(((b.pitch % 360) + 360) % 360, ((a.pitch % 360) + 360) % 360) || !same(((b.roll % 360) + 360) % 360, ((a.roll % 360) + 360) % 360))
        problem(m.name, `${key} object ${i} changes on save`);
      if (a.extra && JSON.stringify(a.extra) !== JSON.stringify(b.extra)) problem(m.name, `${key} object ${i} extra fields lost`);
    }
  }
}
// the client reads the first rotation number one character short (substr(0, s - 1)): Studio must write decimals
assert.ok(/^\s+0\.000000#/m.test(formatAreaData([{ x: 0, y: 0, z: 0, crc: 1, yaw: 45, pitch: 0, roll: 0, bias: 0 }])), "first rotation number keeps its decimals");
console.log(`conformance: ${stats.maps} official maps, ${stats.tiles} terrains, ${stats.objects} objects (${stats.tilted} tilted, ${stats.biased} with height bias, ${stats.extra} with extra fields), ${stats.textures} textures`);
if (notes.size) console.log(`notes (official data, same in the game):\n  ` + [...notes].map(([m, n]) => `${m}: ${n}`).join("\n  "));
if (problems.length) console.log(problems.join("\n"));
assert.strictEqual(problems.length, 0, `${problems.length} conformance problems`);
console.log("ok: every official map reads and writes with the same meaning as in the client");
