// APIX map generator: writes a WorldEditor/Metin2 outdoor map straight to files, without the editor.
//
// Usage (from apix-map-studio): node mapgen/mapgen.js <spec.js> [--out <editor root>] [--name <map name>] [--force]
//
// A spec module exports { name, sizeX, sizeY, height(x, y), texture(x, y), textures[], water, attr(x, y), objects() }.
// Coordinates in a spec are global height cells (0 .. sizeX*128); 1 cell = 2 m. Formats (verified against
// WorldEditor Remix v59 saves, 2026-10-21):
//   height.raw  131x131 uint16 LE per terrain; raw(i, j) = cell(i - 1, j - 1), so the 1-cell border overlaps neighbours.
//   tile.raw    258x258 bytes, texture number per half cell; tile(c, r) = cell((c - 1) / 2, (r - 1) / 2).
//   attr.atr    u16 0x0A4A, u16 256, u16 256, then 256x256 flag bytes (1 = block, 2 = water, 4 = no PvP), 1 m each.
//   water.wtr   u16 0x1532, u16 128, u16 128, u8 count, 128x128 water index bytes (255 = none), count x int32 raw heights.
//   AreaData    objects with world x = cell x * 200, y = -(cell y * 200), absolute z in cm (raw height / 2), bias 0;
//               the file must end with "ObjectCount N" or the editor loads no objects.
// Heights are raw units: 1 m = 200, a flat map is 32767 (HeightScale 0.5).

const fs = require("fs");
const path = require("path");

const DEFAULT_ROOT = "C:\\Users\\micha\\Documents\\we_remix_v59__20260716-1745";
const CELLS = 128;            // height cells per terrain
const CELL_CM = 200;
const CRLF = "\r\n";

const ATTR_FLAGS = { block: 1, water: 2, banpk: 4 };

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function text(lines) { return lines.join(CRLF) + CRLF; }
function fixed(v) { return Number(v).toFixed(6); }

function heightGrid(spec) {
  const w = spec.sizeX * CELLS + 3, h = spec.sizeY * CELLS + 3;   // cells -1 .. size*128 + 1
  const grid = new Uint16Array(w * h);
  for (let y = -1; y < h - 1; y++) {
    for (let x = -1; x < w - 1; x++) {
      grid[(y + 1) * w + (x + 1)] = clamp(Math.round(spec.height(x, y)), 0, 65535);
    }
  }
  return { at: (x, y) => grid[(clamp(y, -1, h - 2) + 1) * w + (clamp(x, -1, w - 2) + 1)] };
}

function writeTerrain(dir, tx, ty, spec, heights) {
  const ox = tx * CELLS, oy = ty * CELLS;

  const height = Buffer.alloc(131 * 131 * 2);
  for (let j = 0; j < 131; j++) for (let i = 0; i < 131; i++) {
    height.writeUInt16LE(heights.at(ox + i - 1, oy + j - 1), (j * 131 + i) * 2);
  }

  const tile = Buffer.alloc(258 * 258);
  for (let r = 0; r < 258; r++) for (let c = 0; c < 258; c++) {
    tile[r * 258 + c] = spec.texture(ox + (c - 1) / 2, oy + (r - 1) / 2, heights.at.bind(null));
  }

  const attr = Buffer.alloc(6 + 256 * 256);
  attr.writeUInt16LE(0x0a4a, 0); attr.writeUInt16LE(256, 2); attr.writeUInt16LE(256, 4);
  for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) {
    const names = spec.attr ? spec.attr(ox + c / 2, oy + r / 2, heights.at) : [];
    attr[6 + r * 256 + c] = names.reduce((acc, n) => acc | ATTR_FLAGS[n], 0);
  }

  const level = spec.water ? spec.water.level : null;
  const water = Buffer.alloc(7 + 128 * 128 + (level === null ? 0 : 4));
  water.writeUInt16LE(0x1532, 0); water.writeUInt16LE(128, 2); water.writeUInt16LE(128, 4);
  water[6] = level === null ? 0 : 1;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const wet = level !== null && spec.water.covers(ox + x, oy + y, heights.at);
    water[7 + y * 128 + x] = wet ? 0 : 255;
  }
  if (level !== null) water.writeInt32LE(level, 7 + 128 * 128);

  const minX = ox * CELL_CM, maxX = (ox + CELLS) * CELL_CM, minY = oy * CELL_CM, maxY = (oy + CELLS) * CELL_CM;
  const objects = spec.placed.filter((o) => o.cx * CELL_CM >= minX && o.cx * CELL_CM < maxX && o.cy * CELL_CM >= minY && o.cy * CELL_CM < maxY);
  const area = ["AreaDataFile", ""];
  objects.forEach((o, i) => {
    const z = heights.at(Math.round(o.cx), Math.round(o.cy)) / 2 + (o.lift || 0);
    area.push(`Start Object${String(i).padStart(3, "0")}`,
      `    ${fixed(o.cx * CELL_CM)} ${fixed(-o.cy * CELL_CM)} ${fixed(z)}`,
      `    ${o.crc >>> 0}`,
      `    ${fixed(o.roll || 0)}#${fixed(o.pitch || 0)}#${fixed(o.yaw || 0)}`,       // client order: vertical turn last
      `    ${fixed(0)}`,
      "End Object");
  });
  area.push("", `ObjectCount ${objects.length}`);                   // without this trailer the editor loads no objects

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "height.raw"), height);
  fs.writeFileSync(path.join(dir, "tile.raw"), tile);
  fs.writeFileSync(path.join(dir, "attr.atr"), attr);
  fs.writeFileSync(path.join(dir, "water.wtr"), water);
  fs.writeFileSync(path.join(dir, "AreaData.txt"), text(area));
  fs.writeFileSync(path.join(dir, "AreaProperty.txt"), text(["ScriptType AreaProperty", "", 'AreaName ""', "", `NumWater ${water[6]}`, ""]));
  fs.writeFileSync(path.join(dir, "AreaAmbienceData.txt"), text(["AreaAmbienceDataFile", "", "", "ObjectCount 0"]));
  return objects.length;
}

function writeTextureSet(file, textures) {
  const lines = ["TextureSet", "", `TextureCount ${textures.length}`, ""];
  textures.forEach((t, i) => {
    const tag = `Texture${String(i + 1).padStart(3, "0")}`;
    lines.push(`Start ${tag}`, `    "${t.file}"`, `    ${fixed(t.uScale || 4)}`, `    ${fixed(t.vScale || 4)}`,
      `    ${fixed(0)}`, `    ${fixed(0)}`, "    1", "    0", "    0", `End ${tag}`);
  });
  fs.writeFileSync(file, text(lines));
}

function generate(spec, root, name, force = false) {
  const mapDir = path.join(root, name);
  if (fs.existsSync(mapDir) && !fs.existsSync(path.join(mapDir, ".mapgen"))) {
    throw new Error(`${mapDir} exists and was not created by mapgen; pick another --name`);
  }
  if (fs.existsSync(path.join(mapDir, "_studio_backup")) && !force) {
    throw new Error(`${mapDir} was edited in Map Studio; regenerating would drop those edits (use --force or another --name)`);
  }
  spec.placed = spec.objects ? spec.objects() : [];
  const heights = heightGrid(spec);
  fs.mkdirSync(path.join(root, "textureset"), { recursive: true });
  writeTextureSet(path.join(root, "textureset", `${name}.txt`), spec.textures);
  fs.mkdirSync(mapDir, { recursive: true });
  fs.writeFileSync(path.join(mapDir, ".mapgen"), `generated by scripts/mapgen/mapgen.js ${new Date().toISOString()}\n`);
  const { ROTATION_MARKER, ROTATION_NOTE } = require("../maplib");
  fs.writeFileSync(path.join(mapDir, ROTATION_MARKER), ROTATION_NOTE);     // rotations below are written in client order
  fs.writeFileSync(path.join(mapDir, "Setting.txt"), text(["ScriptType\tMapSetting", "", "CellScale\t200", "HeightScale\t0.500000", "",
    "ViewRadius\t128", "", `MapSize\t${spec.sizeX}\t${spec.sizeY}`, "BasePosition\t0\t0", `TextureSet\ttextureset\\${name}.txt`,
    `Environment\t${spec.environment || ""}`, ""]));
  fs.writeFileSync(path.join(mapDir, "MapProperty.txt"), text(["ScriptType MapProperty", "", 'MapType "Outdoor"', ""]));
  let objects = 0;
  for (let ty = 0; ty < spec.sizeY; ty++) for (let tx = 0; tx < spec.sizeX; tx++) {
    objects += writeTerrain(path.join(mapDir, String(tx).padStart(3, "0") + String(ty).padStart(3, "0")), tx, ty, spec, heights);
  }
  return { mapDir, objects };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (flag, fallback) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : fallback; };
  if (!args[0]) { console.error("usage: node mapgen.js <spec.js> [--out <editor root>] [--name <map name>]"); process.exit(2); }
  const spec = require(path.resolve(args[0]));
  const result = generate(spec, opt("--out", DEFAULT_ROOT), opt("--name", spec.name), args.includes("--force"));
  console.log(`wrote ${result.mapDir} (${spec.sizeX}x${spec.sizeY} terrain, ${result.objects} objects)`);
}

module.exports = { generate, ATTR_FLAGS };
