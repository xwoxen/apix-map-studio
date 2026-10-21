// Reading and writing WorldEditor AreaData (map objects). Plain Node so it can be tested without Electron.
const fs = require("fs");
const path = require("path");

const CRLF = "\r\n";
const TERRAIN_CM = 25600;        // 128 cells x 200 cm

function terrainKey(tx, ty) { return String(tx).padStart(3, "0") + String(ty).padStart(3, "0"); }

function parseAreaData(text, key) {
  const objects = [];
  const re = /Start Object\d+\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)#(\S+)#(\S+)\s+(\S+)\s+End Object/g;
  let m;
  while ((m = re.exec(text))) {
    objects.push({ x: +m[1], y: +m[2], z: +m[3], crc: Number(m[4]) >>> 0, yaw: +m[5], pitch: +m[6], roll: +m[7], bias: +m[8], terrain: key });
  }
  return objects;
}

function fixed(v) { return Number(v).toFixed(6); }

function formatAreaData(list) {
  const lines = ["AreaDataFile", ""];
  list.forEach((o, i) => {
    lines.push(`Start Object${String(i).padStart(3, "0")}`, `    ${fixed(o.x)} ${fixed(o.y)} ${fixed(o.z)}`, `    ${o.crc >>> 0}`,
      `    ${fixed(o.yaw)}#${fixed(o.pitch || 0)}#${fixed(o.roll || 0)}`, `    ${fixed(o.bias || 0)}`, "End Object");
  });
  lines.push("", `ObjectCount ${list.length}`);          // WorldEditor ignores objects without this trailer
  return lines.join(CRLF) + CRLF;
}

// Objects go to the terrain under them; every terrain folder gets a fresh AreaData.txt, old files are backed up first.
function saveObjects(dir, size, objects) {
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
    const file = path.join(dir, key, "AreaData.txt");
    if (!fs.existsSync(path.dirname(file))) continue;
    if (fs.existsSync(file)) {
      fs.mkdirSync(path.join(backup, key), { recursive: true });
      fs.copyFileSync(file, path.join(backup, key, "AreaData.txt"));
    }
    const list = groups.get(key) || [];
    fs.writeFileSync(file, formatAreaData(list));
    written += list.length;
  }
  return { written, backup };
}

module.exports = { terrainKey, parseAreaData, formatAreaData, saveObjects };
