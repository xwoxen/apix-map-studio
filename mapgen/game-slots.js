// Where a map goes in the game world: its map index (apix-server/gamefiles/data/map/index) and a BasePosition
// rectangle that overlaps no server map (Setting.txt) and no client atlas entry (root atlasinfo.txt), with one
// terrain of margin. A map already in the index keeps its slot. Read only: nothing here writes server or client files.

const fs = require("fs");
const path = require("path");
const { APIX_ROOT, PACK_ROOT } = require("../assets");

const TERRAIN = 25600;
const SERVER_MAPS = path.join(APIX_ROOT, "apix-server", "gamefiles", "data", "map");

function readIndex() {
  try {
    return fs.readFileSync(path.join(SERVER_MAPS, "index"), "latin1").split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2 && /^\d+$/.test(p[0])).map(([i, n]) => ({ index: Number(i), name: n }));
  } catch { return []; }
}

function readRects() {
  const rects = [];
  let dirs = [];
  try { dirs = fs.readdirSync(SERVER_MAPS); } catch { /* no server data */ }
  for (const d of dirs) {
    const f = path.join(SERVER_MAPS, d, "Setting.txt");
    if (!fs.existsSync(f)) continue;
    const t = fs.readFileSync(f, "latin1");
    const b = t.match(/BasePosition\s+(\d+)\s+(\d+)/), s = t.match(/MapSize\s+(\d+)\s+(\d+)/);
    if (b && s) rects.push({ name: d, x: +b[1], y: +b[2], w: +s[1] * TERRAIN, h: +s[2] * TERRAIN });
  }
  try {
    for (const line of fs.readFileSync(path.join(PACK_ROOT, "root", "atlasinfo.txt"), "latin1").split(/\r?\n/)) {
      const p = line.trim().split(/\s+/);
      if (p.length >= 5) rects.push({ name: p[0], x: +p[1], y: +p[2], w: +p[3] * TERRAIN, h: +p[4] * TERRAIN });
    }
  } catch { /* no client pack */ }
  return rects;
}

function suggestSlot(mapName, size) {
  const index = readIndex(), rects = readRects();
  const own = index.find((e) => e.name === mapName);
  if (own) {
    const r = rects.find((e) => e.name === mapName);
    if (r) return { index: own.index, base: [r.x, r.y], existing: true };
  }
  const used = new Set(index.map((e) => e.index));
  let free = 90;
  while (used.has(free) && free < 999) free++;
  const w = size[0] * TERRAIN, h = size[1] * TERRAIN;
  const clear = (x, y) => rects.every((r) => r.name === mapName || x + w + TERRAIN <= r.x || r.x + r.w <= x - TERRAIN || y + h + TERRAIN <= r.y || r.y + r.h <= y - TERRAIN);
  for (let y = TERRAIN; y < 400 * TERRAIN; y += TERRAIN) for (let x = TERRAIN; x < 400 * TERRAIN; x += TERRAIN) if (clear(x, y)) return { index: free, base: [x, y], existing: false };
  throw new Error("no free world position found");
}

module.exports = { suggestSlot, readIndex, readRects };
