// PvP arena template for mapgen: an isolated duel floor ringed by a wall and a water moat (both blocked),
// stepped spectator stands and a plaza (no-PvP), set in a meadow valley with forest, a lake and an
// entrance road from the south. Distances below are cells (1 cell = 2 m) from the map centre.

const G = 32767 + 1000;                               // ground level (raw, 1 m = 200)
const R = { floor: 11, wall: 12.5, moat: 15.5, stands: 23, plaza: 31 };
const STEP = 240;                                     // 1.2 m per stand step
const TEX = { grass: 1, grassDark: 2, dirt: 3, tile: 4, stone: 5, cliff: 6, sand: 7 };
const CRC = {
  brazier: 2471529475, flag: 2401125466, pillar: 796958272, pillar2: 1780937370, statue: 1820216212,
  tent: 68844411, tent2: 3760465448, campfire: 3801685253, lamp: 3979323067, light: 459116056,
  rock1: 649849854, rock2: 1013693213, pine1: 1337000076, pine2: 1337000176
};

const smooth = (e0, e1, v) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); }

function create({ name = "apix_pvp_arena", seed = 9090 } = {}) {
  const C = { x: 64, y: 64 };
  const LAKE = { x: 100, y: 30, r: 11 };
  const road = (x, y) => y > C.y + R.plaza - 1 && Math.abs(x - C.x - 1.5 * Math.sin(y / 7)) < 3.2;
  const lakeD = (x, y) => Math.hypot(x - LAKE.x, y - LAKE.y);

  // radial profile as [radius in cells, raw height] knots, smoothstep between them (no 2 m stair edges)
  const PROFILE = [
    [0, G], [10.6, G], [11.4, G + 600], [12.1, G + 600], [13.0, G - 500], [14.8, G - 500],   // floor, wall, moat
    [15.6, G + STEP], [17.6, G + STEP], [18.3, G + 2 * STEP], [20.3, G + 2 * STEP],          // three stand steps
    [21.0, G + 3 * STEP], [R.stands, G + 3 * STEP], [R.stands + 3.5, G]                       // walk down to the plaza
  ];
  function profile(d) {
    for (let i = 1; i < PROFILE.length; i++) {
      const [r0, h0] = PROFILE[i - 1], [r1, h1] = PROFILE[i];
      if (d <= r1) return h0 + (h1 - h0) * smooth(r0, r1, d);
    }
    return G;
  }

  function height(x, y) {
    const d = Math.hypot(x - C.x, y - C.y);
    if (d <= R.plaza) return profile(d);
    let h = G + smooth(R.plaza + 4, 62, d) * 1800;    // valley rim up to +9 m
    h += 90 * Math.sin(x * 0.21) * Math.cos(y * 0.17) * smooth(R.plaza + 2, R.plaza + 10, d);
    if (road(x, y)) h = G + (h - G) * 0.35;           // the road cuts a gentle pass through the rim
    const l = lakeD(x, y);
    if (l < LAKE.r + 6) h += (G - 700 - h) * smooth(LAKE.r + 6, LAKE.r - 3, l);   // lake bowl 3.5 m below the plaza
    return h;
  }

  function texture(x, y) {
    const d = Math.hypot(x - C.x, y - C.y);
    if (d <= R.floor - 0.3) return TEX.tile;
    if (d <= R.wall + 0.2) return TEX.cliff;
    if (d <= R.moat) return TEX.sand;
    if (d <= R.stands) return TEX.stone;
    if (d <= R.plaza) return TEX.dirt;
    if (road(x, y)) return TEX.dirt;
    if (lakeD(x, y) < LAKE.r + 3.5) return TEX.sand;
    return d > 44 ? TEX.grassDark : TEX.grass;
  }

  const WATER = G - 120;
  const water = {
    level: WATER,
    covers: (x, y) => { const d = Math.hypot(x - C.x, y - C.y); return (d > R.wall - 0.5 && d < R.moat + 0.5) || lakeD(x, y) < LAKE.r + 2; }
  };

  function attr(x, y, at) {
    const d = Math.hypot(x - C.x, y - C.y), out = [];
    const cx = Math.floor(x), cy = Math.floor(y);                         // water attr follows the visible water cell
    const wet = water.covers(cx, cy) && at(cx, cy) < WATER;
    if (d > R.floor && d <= R.moat) out.push("block");                    // isolates the duel floor
    if (wet) out.push("water");
    if (wet && lakeD(x, y) < LAKE.r + 2) out.push("block");
    if (d > R.moat && d <= R.plaza + 2) out.push("banpk");                 // spectators and plaza are safe
    if (x < 2 || y < 2 || x > 126 || y > 126) out.push("block");          // map border
    return out;
  }

  function objects() {
    const rnd = rng(seed);
    const out = [], taken = [];
    const add = (crc, cx, cy, yaw = 0, r = 1.5) => { out.push({ crc, cx, cy, yaw }); taken.push([cx, cy, r]); };
    const free = (x, y, r) => taken.every(([tx, ty, tr]) => Math.hypot(x - tx, y - ty) > r + tr);
    const ring = (n, r, off = 0) => Array.from({ length: n }, (_, i) => { const a = off + (i / n) * Math.PI * 2; return [C.x + Math.cos(a) * r, C.y + Math.sin(a) * r, a]; });
    const deg = (a) => (a * 180) / Math.PI;

    for (const [x, y, a] of ring(8, (R.floor + R.wall) / 2, Math.PI / 8)) add(CRC.brazier, x, y, deg(a), 1);       // fire on the wall
    for (const [x, y, a] of ring(12, R.stands - 0.6)) add(CRC.pillar, x, y, deg(a) + 90, 1);                     // stand rim columns
    for (const [x, y, a] of ring(8, R.stands + 1.5, Math.PI / 8)) add(CRC.flag, x, y, deg(a) + 90, 1);           // banners around the stands
    for (const [x, y, a] of ring(16, R.plaza - 1.2, Math.PI / 16)) {                                             // plaza lamps, road gap kept
      if (Math.abs(x - C.x) < 4 && y > C.y) continue;
      add(CRC.lamp, x, y, deg(a), 1);
    }
    for (const [x, y, a] of ring(4, R.plaza - 4, Math.PI / 4)) add(CRC.statue, x, y, deg(a) + 180, 2);           // statues on the plaza diagonals
    add(CRC.pillar2, C.x - 4.5, C.y + R.plaza + 1, 0, 1.5); add(CRC.pillar2, C.x + 4.5, C.y + R.plaza + 1, 0, 1.5);   // entrance
    add(CRC.tent, C.x - 9, C.y - R.plaza - 3, 180, 3); add(CRC.tent2, C.x + 2, C.y - R.plaza - 4, 180, 3);         // traders north of the plaza
    add(CRC.campfire, C.x - 3, C.y - R.plaza - 1.5, 0, 1.5);
    for (let y = C.y + R.plaza + 6; y < 124; y += 8) {                                                             // road lights
      const x = C.x + 1.5 * Math.sin(y / 7);
      add(CRC.light, x - 4.2, y, 0, 1); add(CRC.light, x + 4.2, y, 0, 1);
    }
    for (let i = 0; i < 10; i++) {                                                                                 // rocks at the lake
      const a = (i / 10) * Math.PI * 2;
      const x = LAKE.x + Math.cos(a) * (LAKE.r + 2.8), y = LAKE.y + Math.sin(a) * (LAKE.r + 2.8);
      if (x > 2 && y > 2 && x < 126 && y < 126 && free(x, y, 1.5)) add(rnd() < 0.5 ? CRC.rock1 : CRC.rock2, x, y, rnd() * 360, 1.5);
    }
    let pines = 0;
    for (let t = 0; t < 8000 && pines < 120; t++) {                                                                // forest on the valley rim
      const x = 3 + rnd() * 122, y = 3 + rnd() * 122;
      const d = Math.hypot(x - C.x, y - C.y);
      if (d < R.plaza + 9 || road(x, y) || Math.abs(x - C.x) < 7 && y > C.y + R.plaza) continue;
      if (lakeD(x, y) < LAKE.r + 4.5) continue;
      if (rnd() > smooth(R.plaza + 6, 52, d) + 0.1) continue;                                                     // denser further out
      if (!free(x, y, 2.5)) continue;
      add(rnd() < 0.5 ? CRC.pine1 : CRC.pine2, x, y, rnd() * 360, 2.5);
      pines++;
    }
    for (let i = 0; i < 14; i++) {                                                                                 // boulders in the woods
      const x = 4 + rnd() * 120, y = 4 + rnd() * 120;
      if (Math.hypot(x - C.x, y - C.y) > R.plaza + 12 && !road(x, y) && free(x, y, 2)) add(rnd() < 0.5 ? CRC.rock1 : CRC.rock2, x, y, rnd() * 360, 2);
    }
    return out;
  }

  return {
    name, sizeX: 1, sizeY: 1, height, texture, water, attr, objects,
    textures: [
      { file: "d:/ymir work/terrainmaps/a/grass/grass 01.dds" },
      { file: "d:/ymir work/terrainmaps/a/grass/grass 02.dds" },
      { file: "d:/ymir work/terrainmaps/a/field/field 02.dds" },
      { file: "d:/ymir work/terrainmaps/12temple/stone_tile_001.dds" },
      { file: "d:/ymir work/terrainmaps/12temple/stone_02.dds" },
      { file: "d:/ymir work/terrainmaps/12temple/5st_cliff_001.dds" },
      { file: "d:/ymir work/terrainmaps/a/beach/beach sand 01.dds" }
    ],
    environment: "a1.msenv",
    // meters from the map's north-west corner, for Town.txt and later duel quests
    spawn: { x: C.x * 2, y: (C.y + R.plaza + 3) * 2 },
    duelPoints: [{ x: C.x * 2, y: (C.y - 7) * 2 }, { x: C.x * 2, y: (C.y + 7) * 2 }]
  };
}

module.exports = { ...create(), create };
