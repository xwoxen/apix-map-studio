// Terrain files: decoding and re-encoding editor-saved files must reproduce them byte for byte.
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const lib = require("../maplib");

const editorRoot = "C:/Users/micha/Documents/we_remix_v59__20260716-1745";
const maps = process.argv.slice(2).length ? process.argv.slice(2) : ["apix_demo_ostrov", "apix_gen_ostrov"];

for (const name of maps) {
  const t = path.join(editorRoot, name, "000000");
  const water = fs.readFileSync(path.join(t, "water.wtr"));
  assert.ok(lib.encodeWater(lib.decodeWater(water)).equals(water), `${name}: water.wtr changed`);
  const attr = fs.readFileSync(path.join(t, "attr.atr"));
  assert.ok(lib.encodeAttr(lib.decodeAttr(attr)).equals(attr), `${name}: attr.atr changed`);
  const ts = fs.readFileSync(path.join(editorRoot, "textureset", `${name}.txt`), "latin1");
  assert.strictEqual(lib.formatTextureSet(lib.parseTextureSet(ts)), ts, `${name}: texture set changed`);

  // full save into a scratch copy: heights/tiles untouched must come out identical
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mapstudio-t-"));
  fs.mkdirSync(path.join(tmp, "000000"));
  for (const f of ["height.raw", "tile.raw", "water.wtr", "attr.atr", "AreaProperty.txt"]) fs.copyFileSync(path.join(t, f), path.join(tmp, "000000", f));
  const height = new Uint16Array(fs.readFileSync(path.join(t, "height.raw")).buffer.slice(0));
  lib.saveTerrain(tmp, { textureSet: null, terrains: [{
    key: "000000", height, tile: fs.readFileSync(path.join(t, "tile.raw")),
    water: lib.decodeWater(water), attr: lib.decodeAttr(attr)
  }] });
  for (const f of ["height.raw", "tile.raw", "water.wtr", "attr.atr", "AreaProperty.txt"]) {
    assert.ok(fs.readFileSync(path.join(tmp, "000000", f)).equals(fs.readFileSync(path.join(t, f))), `${name}: ${f} changed after save`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`ok: ${name} terrain files identical after round trip`);
}

// a newly painted water level is stored, an unused one is dropped
const w = { idx: new Uint8Array(128 * 128).fill(255), levels: [33000, 34000] };
w.idx[5] = 1;
const enc = lib.encodeWater(w);
assert.strictEqual(enc[6], 1);
assert.strictEqual(enc[7 + 5], 0);
assert.strictEqual(enc.readInt32LE(7 + 128 * 128), 34000);
console.log("ok: water level compaction");
