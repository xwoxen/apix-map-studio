// Map spawns kept by Map Studio in <map>/_studio/spawns.json and written to the server's regen.txt / npc.txt
// (game/src/regen.cpp read_line: type, x, y, half width, half height, z, direction, respawn, percent, count, vnum;
// x/y in meters from the map's corner). Types: m = monsters, g = group, ga = aggressive group, npc = npc.txt.

const fs = require("fs");
const path = require("path");

const TYPES = ["m", "g", "ga", "npc"];

function spawnsFile(mapDir) { return path.join(mapDir, "_studio", "spawns.json"); }

function readSpawns(mapDir) {
  const f = spawnsFile(mapDir);
  if (!fs.existsSync(f)) return [];
  const data = JSON.parse(fs.readFileSync(f, "utf8"));
  return (data.spawns || []).filter((s) => TYPES.includes(s.type) && s.vnum > 0);
}

function writeSpawns(mapDir, spawns) {
  const f = spawnsFile(mapDir);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const clean = spawns.map(({ id, type, vnum, x, y, radius, count, respawn, direction }) =>
    ({ id, type, vnum: vnum | 0, x: +(+x).toFixed(2), y: +(+y).toFixed(2), radius: +radius || 0, count: Math.max(1, count | 0), respawn: Math.max(1, respawn | 0), direction: direction | 0 }));
  fs.writeFileSync(f, JSON.stringify({ version: 1, spawns: clean }, null, 2) + "\n");
  return f;
}

// 3600 -> "1h", 90 -> "90s", 600 -> "10m" (the parser adds up h / m / s parts)
function timeText(sec) {
  if (sec % 3600 === 0) return `${sec / 3600}h`;
  if (sec % 60 === 0) return `${sec / 60}m`;
  return `${sec}s`;
}

function regenRows(spawns) {
  const row = (s, type, r, count) => [type, Math.round(s.x), Math.round(s.y), r, r, 0, s.direction | 0, timeText(s.respawn), 100, count, s.vnum].join("\t");
  const regen = [], npc = [];
  for (const s of spawns) {
    if (s.type === "npc") npc.push(row(s, "m", 0, 1));
    else regen.push(row(s, s.type, Math.max(1, Math.round(s.radius)), s.type === "m" ? s.count : 1));
  }
  const text = (rows) => (rows.length ? rows.join("\n") + "\n" : "");
  return { regen: text(regen), npc: text(npc) };
}

module.exports = { TYPES, readSpawns, writeSpawns, regenRows, timeText };
