// Reading and writing WorldEditor AreaData (map objects). Plain Node so it can be tested without Electron.
const fs = require("fs");
const path = require("path");

const CRLF = "\r\n";
const TERRAIN_CM = 25600;        // 128 cells x 200 cm

function terrainKey(tx, ty) { return String(tx).padStart(3, "0") + String(ty).padStart(3, "0"); }

// Rotation "a#b#c" is what the client feeds to D3DXMatrixRotationYawPitchRoll in Metin2 space (z up), whole degrees
// (GameLib/Area.cpp reads it with atoi): the turn about the vertical axis is the THIRD number (the client's "roll"),
// the first two tilt the model. Map Studio's o.yaw is that vertical turn (same direction as three.js rotation.y);
// o.roll / o.pitch keep the first / second number for the round trip.
// Map Studio before 2026-10-23 wrote its yaw into the FIRST number. Such maps (saved by Studio or made by mapgen, without
// the rotation marker) are read with legacy = true: first number = vertical turn. Saving writes the client order + marker.
const ROTATION_MARKER = ".rotation-v2";
const ROTATION_NOTE = "AreaData rotation in client order (tilt#tilt#vertical turn), see maplib.js" + CRLF;
function isLegacyStudioMap(dir) {
  if (fs.existsSync(path.join(dir, ROTATION_MARKER))) return false;
  return fs.existsSync(path.join(dir, "_studio_backup")) || fs.existsSync(path.join(dir, ".mapgen"));
}

function parseAreaData(text, key, legacy = false) {
  const objects = [];
  const re = /Start Object\d+\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)#(\S+)#(\S+)\s+(\S+)\s+End Object/g;
  let m;
  while ((m = re.exec(text))) {
    const [a, b, c] = [+m[5], +m[6], +m[7]];
    const rot = legacy ? { yaw: a + c, pitch: b, roll: 0 } : { yaw: c, pitch: b, roll: a };
    objects.push({ x: +m[1], y: +m[2], z: +m[3], crc: Number(m[4]) >>> 0, ...rot, bias: +m[8], terrain: key });
  }
  return objects;
}

// AreaAmbienceData.txt (GameLib Area.cpp __Load_LoadAmbience): sound ambience objects with position (cm),
// CRC, range (cm) and the share of the range played at full volume. They never live in AreaData.txt.
function parseAmbienceData(text, key) {
  const objects = [];
  const re = /Start Object\d+\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d+)(?:\s+([\d.\-]+))?\s+End Object/g;
  let m;
  while ((m = re.exec(text))) {
    objects.push({ x: +m[1], y: +m[2], z: +m[3], crc: Number(m[4]) >>> 0, yaw: 0, pitch: 0, roll: 0, bias: 0, terrain: key,
      ambience: { range: Number(m[5]), percent: m[6] !== undefined ? Number(m[6]) : 0 } });
  }
  return objects;
}

function fixed(v) { return Number(v).toFixed(6); }

function formatAmbienceData(list) {
  const lines = ["AreaAmbienceDataFile", ""];
  list.forEach((o, i) => {
    lines.push(`Start Object${String(i).padStart(3, "0")}`, `    ${fixed(o.x)} ${fixed(o.y)} ${fixed(o.z)}`, `    ${o.crc >>> 0}`,
      `    ${Math.round(o.ambience.range)}`, `    ${fixed(o.ambience.percent || 0)}`, "End Object");
  });
  lines.push("", `ObjectCount ${list.length}`);
  return lines.join(CRLF) + CRLF;
}

// client order: tilt#tilt#vertical turn, whole degrees in 0..359 (the client truncates with atoi)
function rotation(o) {
  const deg = (v) => fixed((((Math.round(Number(v) || 0)) % 360) + 360) % 360);
  return `${deg(o.roll)}#${deg(o.pitch)}#${deg(o.yaw)}`;
}

function formatAreaData(list) {
  const lines = ["AreaDataFile", ""];
  list.forEach((o, i) => {
    lines.push(`Start Object${String(i).padStart(3, "0")}`, `    ${fixed(o.x)} ${fixed(o.y)} ${fixed(o.z)}`, `    ${o.crc >>> 0}`,
      `    ${rotation(o)}`, `    ${fixed(o.bias || 0)}`, "End Object");
  });
  lines.push("", `ObjectCount ${list.length}`);          // WorldEditor ignores objects without this trailer
  return lines.join(CRLF) + CRLF;
}

// Objects go to the terrain under them; every terrain folder gets a fresh AreaData.txt, old files are backed up first.
function saveObjects(dir, size, objects) {
  fs.writeFileSync(path.join(dir, ROTATION_MARKER), ROTATION_NOTE);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(dir, "_studio_backup", stamp);
  const groups = new Map();
  for (const o of objects) {
    const tx = Math.min(size[0] - 1, Math.max(0, Math.floor(o.x / TERRAIN_CM)));
    const ty = Math.min(size[1] - 1, Math.max(0, Math.floor(-o.y / TERRAIN_CM)));
    const key = terrainKey(tx, ty);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  let written = 0;
  for (let ty = 0; ty < size[1]; ty++) for (let tx = 0; tx < size[0]; tx++) {
    const key = terrainKey(tx, ty);
    if (!fs.existsSync(path.join(dir, key))) continue;
    const all = groups.get(key) || [];
    // ambience objects go to AreaAmbienceData.txt, everything else to AreaData.txt
    for (const [name, list, format] of [["AreaData.txt", all.filter((o) => !o.ambience), formatAreaData], ["AreaAmbienceData.txt", all.filter((o) => o.ambience), formatAmbienceData]]) {
      const file = path.join(dir, key, name);
      if (fs.existsSync(file)) {
        fs.mkdirSync(path.join(backup, key), { recursive: true });
        fs.copyFileSync(file, path.join(backup, key, name));
      }
      fs.writeFileSync(file, format(list));
      written += list.length;
    }
  }
  return { written, backup };
}

/* ---------- terrain files ---------- */
// height.raw 131x131 uint16 LE; tile.raw 258x258 bytes; attr.atr u16 0x0A4A,256,256 + 256x256 flags;
// water.wtr u16 0x1532,128,128, u8 count, 128x128 indexes (255 = dry), count x int32 raw heights.

function parseTextureSet(text) {
  const entries = [];
  const re = /Start Texture(\d+)\s+"([^"]*)"\s+([\d.\-]+)\s+([\d.\-]+)[\s\S]*?End Texture\1/g;
  let m;
  while ((m = re.exec(text))) entries.push({ index: Number(m[1]), file: m[2], uScale: Number(m[3]), vScale: Number(m[4]), block: m[0] });
  return entries;
}

function textureBlock(index, file, uScale = 4, vScale = 4) {
  const tag = `Texture${String(index).padStart(3, "0")}`;
  return [`Start ${tag}`, `    "${file}"`, `    ${fixed(uScale)}`, `    ${fixed(vScale)}`, `    ${fixed(0)}`, `    ${fixed(0)}`,
    "    1", "    0", "    0", `End ${tag}`].join(CRLF);
}

// Existing entries keep their original text; new ones get the editor's default block.
function formatTextureSet(entries) {
  const parts = ["TextureSet", "", `TextureCount ${entries.length}`, ""];
  for (const e of entries) parts.push(e.block || textureBlock(e.index, e.file, e.uScale, e.vScale));
  return parts.join(CRLF) + CRLF;
}

function decodeWater(buf) {
  const idx = new Uint8Array(128 * 128).fill(255);
  const levels = [];
  if (buf && buf.length >= 7 + 128 * 128) {
    idx.set(buf.subarray(7, 7 + 128 * 128));
    const count = buf[6];
    for (let i = 0; i < count; i++) levels.push(buf.readInt32LE(7 + 128 * 128 + i * 4));
  }
  return { idx, levels };
}

// Unused levels are dropped and indexes renumbered, so the count matches what is painted.
function encodeWater({ idx, levels }) {
  const used = [...new Set([...idx].filter((v) => v !== 255 && v < levels.length))].sort((a, b) => a - b);
  const remap = new Map(used.map((old, i) => [old, i]));
  const out = Buffer.alloc(7 + 128 * 128 + used.length * 4);
  out.writeUInt16LE(0x1532, 0); out.writeUInt16LE(128, 2); out.writeUInt16LE(128, 4); out[6] = used.length;
  for (let i = 0; i < 128 * 128; i++) out[7 + i] = remap.has(idx[i]) ? remap.get(idx[i]) : 255;
  used.forEach((old, i) => out.writeInt32LE(levels[old], 7 + 128 * 128 + i * 4));
  return out;
}

function decodeAttr(buf) {
  const flags = new Uint8Array(256 * 256);
  if (buf && buf.length >= 6 + 256 * 256) flags.set(buf.subarray(6, 6 + 256 * 256));
  return flags;
}

function encodeAttr(flags) {
  const out = Buffer.alloc(6 + 256 * 256);
  out.writeUInt16LE(0x0a4a, 0); out.writeUInt16LE(256, 2); out.writeUInt16LE(256, 4);
  out.set(flags, 6);
  return out;
}

// payload: { textureSet: { file, entries } | null, terrains: [{ key, height?, tile?, water?: { idx, levels }, attr? }] }
function saveTerrain(dir, payload) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(dir, "_studio_backup", stamp);
  const write = (file, data, rel) => {
    if (fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(path.join(backup, rel)), { recursive: true });
      fs.copyFileSync(file, path.join(backup, rel));
    }
    fs.writeFileSync(file, data);
  };
  const files = [];
  if (payload.textureSet) {
    write(payload.textureSet.file, formatTextureSet(payload.textureSet.entries), path.basename(payload.textureSet.file));
    files.push(path.basename(payload.textureSet.file));
  }
  for (const t of payload.terrains) {
    const tdir = path.join(dir, t.key);
    if (t.height) { write(path.join(tdir, "height.raw"), Buffer.from(t.height.buffer, t.height.byteOffset, t.height.byteLength), path.join(t.key, "height.raw")); files.push(`${t.key}/height.raw`); }
    if (t.tile) { write(path.join(tdir, "tile.raw"), Buffer.from(t.tile), path.join(t.key, "tile.raw")); files.push(`${t.key}/tile.raw`); }
    if (t.attr) { write(path.join(tdir, "attr.atr"), encodeAttr(t.attr), path.join(t.key, "attr.atr")); files.push(`${t.key}/attr.atr`); }
    if (t.water) {
      const wtr = encodeWater(t.water);
      write(path.join(tdir, "water.wtr"), wtr, path.join(t.key, "water.wtr"));
      const propFile = path.join(tdir, "AreaProperty.txt");
      const prop = fs.existsSync(propFile) ? fs.readFileSync(propFile, "latin1") : `ScriptType AreaProperty${CRLF}${CRLF}AreaName ""${CRLF}${CRLF}NumWater 0${CRLF}`;
      write(propFile, prop.replace(/NumWater\s+\d+/, `NumWater ${wtr[6]}`), path.join(t.key, "AreaProperty.txt"));
      files.push(`${t.key}/water.wtr`);
    }
  }
  return { files, backup };
}

module.exports = {
  terrainKey, parseAreaData, formatAreaData, isLegacyStudioMap, ROTATION_MARKER, ROTATION_NOTE, parseAmbienceData, formatAmbienceData, saveObjects,
  parseTextureSet, formatTextureSet, textureBlock, decodeWater, encodeWater, decodeAttr, encodeAttr, saveTerrain
};
