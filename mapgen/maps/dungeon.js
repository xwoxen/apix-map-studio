// Dungeon template for mapgen: rooms and corridors carved 20 m deep into a rock plateau, a large boss
// room farthest from the start room, cliffs marked as blocked, lights and ruins placed in the rooms.
// create({ name, sizeX, sizeY, seed }) returns a spec; the module itself is a 1x1 spec for the CLI.

const FLOOR = 32767, TOP = FLOOR + 4000;            // 20 m deep
const TEX = { tile: 1, path: 2, cliff: 3, rock: 4 };
const CRC = { light: 459116056, pillar: 2770713557, gate: 2461524686, wall1: 1578479083, wall2: 2351827116, rock1: 649849854, rock2: 1013693213 };

function rng(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
}
const smooth = (e0, e1, v) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
function segDist(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}

function create({ name = "apix_dungeon", sizeX = 1, sizeY = 1, seed = name } = {}) {
  const rnd = rng(seed);
  const W = sizeX * 128, H = sizeY * 128;
  // rooms on a jittered grid (about 42 cells = 84 m per slot)
  const nx = Math.max(2, Math.round(W / 42)), ny = Math.max(2, Math.round(H / 42));
  const rooms = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (rnd() < 0.2 && rooms.length > 2) continue;
    const cw = W / nx, ch = H / ny;
    rooms.push({ x: cw * (i + 0.5) + (rnd() - 0.5) * cw * 0.35, y: ch * (j + 0.5) + (rnd() - 0.5) * ch * 0.35, r: 9 + rnd() * 5 });
  }
  const start = rooms[0];
  let boss = rooms[1];
  for (const r of rooms) if (Math.hypot(r.x - start.x, r.y - start.y) > Math.hypot(boss.x - start.x, boss.y - start.y)) boss = r;
  boss.r = Math.min(20, Math.min(W, H) / 5);
  for (const r of rooms) {                            // keep every room (and its cliff) inside the map
    r.x = Math.max(r.r + 6, Math.min(W - r.r - 6, r.x));
    r.y = Math.max(r.r + 6, Math.min(H - r.r - 6, r.y));
  }
  // corridors: minimum spanning tree plus a couple of loops
  const edges = [], inTree = new Set([0]);
  while (inTree.size < rooms.length) {
    let best = null;
    for (const a of inTree) for (let b = 0; b < rooms.length; b++) {
      if (inTree.has(b)) continue;
      const d = Math.hypot(rooms[a].x - rooms[b].x, rooms[a].y - rooms[b].y);
      if (!best || d < best.d) best = { a, b, d };
    }
    edges.push([best.a, best.b]); inTree.add(best.b);
  }
  for (let k = 0; k < Math.floor(rooms.length / 4); k++) {
    const a = Math.floor(rnd() * rooms.length), b = Math.floor(rnd() * rooms.length);
    if (a !== b) edges.push([a, b]);
  }
  const HALF = 3.2;                                   // corridor half width in cells (~13 m wide)
  // distance field: < 0 inside a room or corridor (cells)
  const field = new Float32Array((W + 3) * (H + 3));
  const kind = new Uint8Array((W + 3) * (H + 3));     // 1 room, 2 corridor
  for (let y = -1; y <= H + 1; y++) for (let x = -1; x <= W + 1; x++) {
    let d = 99, k = 0;
    for (const r of rooms) { const v = Math.hypot(x - r.x, y - r.y) - r.r; if (v < d) { d = v; k = 1; } }
    for (const [a, b] of edges) { const v = segDist(x, y, rooms[a], rooms[b]) - HALF; if (v < d - 0.5) { d = v; k = 2; } }
    field[(y + 1) * (W + 3) + (x + 1)] = d;
    kind[(y + 1) * (W + 3) + (x + 1)] = k;
  }
  const at = (x, y) => field[(Math.max(-1, Math.min(H + 1, Math.round(y))) + 1) * (W + 3) + (Math.max(-1, Math.min(W + 1, Math.round(x))) + 1)];
  const kindAt = (x, y) => kind[(Math.max(-1, Math.min(H + 1, Math.round(y))) + 1) * (W + 3) + (Math.max(-1, Math.min(W + 1, Math.round(x))) + 1)];

  const height = (x, y) => {
    const d = at(x, y);
    const wobble = 120 * Math.sin(x * 0.37 + y * 0.11) * Math.cos(y * 0.29);
    return FLOOR + (TOP - FLOOR) * smooth(0, 4, d) + (d > 1 ? wobble : 0);
  };
  const texture = (x, y) => {
    const d = at(x, y);
    if (d > 4) return TEX.rock;
    if (d > 0.2) return TEX.cliff;
    return kindAt(x, y) === 1 ? TEX.tile : TEX.path;
  };

  const objects = () => {
    const out = [];
    const add = (crc, cx, cy, yaw = 0) => out.push({ crc, cx, cy, yaw });
    for (const r of rooms) {
      if (r === boss) continue;
      const n = 4;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + 0.4; add(CRC.light, r.x + Math.cos(a) * (r.r - 2.5), r.y + Math.sin(a) * (r.r - 2.5)); }
    }
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; add(CRC.pillar, boss.x + Math.cos(a) * (boss.r - 4), boss.y + Math.sin(a) * (boss.r - 4)); }
    add(CRC.gate, boss.x, boss.y - boss.r * 0.3, 180);
    for (const [a, b] of edges) {                     // rubble along corridor walls
      const A = rooms[a], B = rooms[b], len = Math.hypot(B.x - A.x, B.y - A.y);
      for (let t = 0.3; t < 0.8; t += 0.5) {
        const nxv = -(B.y - A.y) / len, nyv = (B.x - A.x) / len, side = rnd() < 0.5 ? -1 : 1;
        add(rnd() < 0.5 ? CRC.rock1 : CRC.rock2, A.x + (B.x - A.x) * t + nxv * side * (HALF - 0.8), A.y + (B.y - A.y) * t + nyv * side * (HALF - 0.8), Math.round(rnd() * 360));
      }
    }
    return out;
  };

  return {
    name, sizeX, sizeY, height, texture, objects,
    textures: [
      { file: "d:/ymir work/terrainmaps/12temple/stone_tile_001.dds" },
      { file: "d:/ymir work/terrainmaps/12temple/stone_02.dds" },
      { file: "d:/ymir work/terrainmaps/12temple/5st_cliff_001.dds" },
      { file: "d:/ymir work/terrainmaps/b/stone/dc_rock_00.dds" }
    ],
    water: null,
    attr: (x, y) => (at(x, y) > 0.6 ? ["block"] : []),
    environment: "dark.msenv",
    start: { x: start.x * 2, y: start.y * 2 },          // meters, for spawn points later
    rooms: rooms.length
  };
}

module.exports = { ...create({ name: "apix_gen_dungeon" }), create };
