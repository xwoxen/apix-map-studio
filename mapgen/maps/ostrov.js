// Demo island for scripts/mapgen: shore, plateau with a ruined bell house, dirt path with lanterns, pine forest, sea.
// All coordinates are global height cells (1 cell = 2 m); heights are raw (32767 = flat, 1 m = 200).

const BASE = 32767;
const SEA_LEVEL = BASE + 700;                      // water surface +3.5 m above the sea floor
const HILL = { x: 60, y: 70, top: 38600, radius: 16, blend: 8 };
const TEX = { grass: 1, sand: 2, dirt: 3, stone: 4 };
const CRC = {
  bell: 452233971, light: 459116056, rock1: 649849854, rock2: 1013693213, gate: 2461524686,
  pillar: 2770713557, wall1: 1578479083, wall2: 2351827116, pine1: 1337000076, pine2: 1337000176
};

const smooth = (e0, e1, v) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const coastAt = (dx, dy) => { const a = Math.atan2(dy, dx); return 42 + 5 * Math.sin(a * 3) + 3 * Math.cos(a * 5 + 1); };
const pathX = (y) => 62 + 2 * Math.sin(y / 6);

function island(x, y) {
  const dx = x - 64, dy = y - 64, d = Math.hypot(dx, dy), coast = coastAt(dx, dy);
  const land = smooth(coast + 10, coast - 3, d), t = Math.min(1, d / coast);
  let h = BASE + land * (1200 + 1000 * (1 - t * t));
  h += land * 5200 * Math.exp(-((dx + 4) ** 2 + (dy - 6) ** 2) / 200);
  h += land * 1800 * Math.exp(-((dx - 20) ** 2 + (dy + 17) ** 2) / 72);
  return h;
}

function height(x, y) {
  const base = island(x, y);
  const d = Math.hypot(x - HILL.x, y - HILL.y);
  if (d <= HILL.radius) return HILL.top;
  if (d >= HILL.radius + HILL.blend) return base;
  const w = smooth(HILL.radius + HILL.blend, HILL.radius, d);
  return base * (1 - w) + HILL.top * w;
}

function texture(x, y, heightAt) {
  const h = heightAt(Math.round(x), Math.round(y));
  if (Math.hypot(x - HILL.x, y - HILL.y) < 6 || Math.hypot(x - 84, y - 47) < 4) return TEX.stone;
  if (y >= 14 && y <= 50 && Math.abs(x - pathX(y)) < 1.6) return TEX.dirt;
  if (Math.hypot(x - HILL.x, y - HILL.y) < 13) return TEX.dirt;          // courtyard on the plateau
  if (h < BASE + 1500) return TEX.sand;
  return TEX.grass;
}

function objects() {
  let seed = 20261021;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const placed = [];
  const taken = [];
  const free = (x, y, r) => taken.every((t) => Math.hypot(x - t.x, y - t.y) > r + t.r);
  const add = (kind, x, y, yaw = 0, r = 2) => { placed.push({ crc: CRC[kind], cx: x, cy: y, yaw }); taken.push({ x, y, r }); };

  add("bell", 60, 70, 180, 9);
  add("light", 56, 63); add("light", 64, 63);
  add("gate", 62, 48, 0, 5); add("pillar", 55, 50, 0, 3); add("pillar", 69, 50, 0, 3);
  add("wall1", 51, 74, 90, 4); add("wall2", 71, 78, 270, 4); add("wall2", 48, 66, 90, 4); add("wall1", 72, 66, 270, 4);
  add("pillar", 52, 80, 0, 3); add("pillar", 68, 82, 0, 3); add("pillar", 60, 84, 0, 3);
  for (const y of [43, 37, 31, 25]) { add("light", Math.round(pathX(y)) - 3, y, 0, 1); add("light", Math.round(pathX(y)) + 3, y, 0, 1); }

  for (let i = 0; i < 12; i++) {                                     // rocks along the shore
    const a = (i / 12) * Math.PI * 2 + 0.4, dx = Math.cos(a), dy = Math.sin(a), r = coastAt(dx, dy) - 3;
    const x = Math.round(64 + r * dx), y = Math.round(64 + r * dy);
    if (Math.abs(x - 62) < 6 && y < 50) continue;
    if (free(x, y, 3)) add(i % 2 ? "rock1" : "rock2", x, y, Math.round(rnd() * 360), 3);
  }
  let pines = 0;
  for (let tries = 0; pines < 55 && tries < 6000; tries++) {          // forest on land, off the plateau and the path
    const x = Math.round(14 + rnd() * 100), y = Math.round(14 + rnd() * 100), dx = x - 64, dy = y - 64;
    if (Math.hypot(dx, dy) > coastAt(dx, dy) - 7) continue;
    if (Math.hypot(x - HILL.x, y - HILL.y) < HILL.radius - 2) continue;
    if (y >= 12 && y <= 52 && Math.abs(x - pathX(y)) < 6) continue;
    if (!free(x, y, 3)) continue;
    add(rnd() < 0.5 ? "pine1" : "pine2", x, y, Math.round(rnd() * 360), 2);
    pines++;
  }
  return placed;
}

module.exports = {
  name: "apix_gen_ostrov",
  sizeX: 1,
  sizeY: 1,
  height,
  texture,
  textures: [
    { file: "d:/ymir work/terrainmaps/a/grass/grass 01.dds" },
    { file: "d:/ymir work/terrainmaps/a/beach/beach sand 01.dds" },
    { file: "d:/ymir work/terrainmaps/a/field/field 02.dds" },
    { file: "d:/ymir work/terrainmaps/a/stone/stone02.dds" }
  ],
  water: { level: SEA_LEVEL, covers: (x, y, heightAt) => heightAt(x, y) < SEA_LEVEL + 200 },
  attr: (x, y, heightAt) => {
    const flags = [];
    if (heightAt(Math.floor(x), Math.floor(y)) < SEA_LEVEL) flags.push("water");
    if (Math.hypot(x - HILL.x, y - HILL.y) < HILL.radius - 2) flags.push("banpk");
    return flags;
  },
  objects
};
