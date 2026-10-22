// Playground: a superflat 1 × 1 km test map, like Minecraft's flat world. Level grass with a measuring grid
// (a 1 m line every 10 m, a darker one every 64 m = one server sector), a no-PvP spawn plaza in the middle and
// one small test corner in each direction:
//   north  water pool (2.2 m deep, water attribute) with a sand rim
//   east   four ramps of 15°, 30°, 45° and 60° up to a 6 m plateau that ends in a sheer drop
//   south  blocked strips 1, 2 and 4 m wide on flat ground, and a 3 m wall that is blocked
//   west   a line of objects (pillar, tent, statue, lamp, brazier, pine, campfire, stone light, fire effect)
// Spec coordinates are height cells (2 m); the API and Town use meters from the north-west corner.

const G = 32767 + 1000;                         // ground level (raw, 1 m = 200)
const SIZE = 4, MID = 512;                       // terrains per side, map centre in meters
const TEX = { grass: 1, line: 2, sector: 3, plaza: 4, sand: 5, cliff: 6 };
const CRC = {
  pillar: 796958272, tent: 68844411, statue: 1820216212, lamp: 3979323067, brazier: 2471529475,
  pine: 1337000076, campfire: 3801685253, light: 459116056, fire: 3503684469
};

const POOL = { x0: 492, x1: 532, y0: 380, y1: 410 };               // meters
const RAMPS = { x0: 600, width: 12, gap: 4, y0: 490, top: 6, plateau: 12, angles: [15, 30, 45, 60] };
const STRIPS = { y0: 600, length: 30, xs: [[480, 1], [490, 2], [500, 4]] };
const WALL = { x0: 515, x1: 545, y0: 600, y1: 602, height: 3 };

const inRect = (mx, my, r) => mx >= r.x0 && mx < r.x1 && my >= r.y0 && my < r.y1;

// height of the ramp test at a point (meters): rising ramp, flat top, then a sheer drop
function rampHeight(mx, my) {
  for (let i = 0; i < RAMPS.angles.length; i++) {
    const y0 = RAMPS.y0 + i * (RAMPS.width + RAMPS.gap);
    if (my < y0 || my >= y0 + RAMPS.width) continue;
    const run = RAMPS.top / Math.tan((RAMPS.angles[i] * Math.PI) / 180);
    const d = mx - RAMPS.x0;
    if (d < 0) return 0;
    if (d < run) return (d / run) * RAMPS.top;
    if (d < run + RAMPS.plateau) return RAMPS.top;
    return 0;
  }
  return 0;
}

function create({ name = "apix_playground" } = {}) {
  function height(x, y) {
    const mx = x * 2, my = y * 2;
    if (inRect(mx, my, POOL)) return G - 500;
    if (inRect(mx, my, WALL)) return G + WALL.height * 200;
    return G + rampHeight(mx, my) * 200;
  }

  function texture(x, y) {
    const mx = x * 2, my = y * 2;
    if (Math.abs(mx - MID) <= 20 && Math.abs(my - MID) <= 20) return TEX.plaza;
    const pad = { x0: POOL.x0 - 3, x1: POOL.x1 + 3, y0: POOL.y0 - 3, y1: POOL.y1 + 3 };
    if (inRect(mx, my, pad)) return TEX.sand;
    if (rampHeight(mx, my) > 0 || inRect(mx, my, WALL)) return TEX.cliff;
    if (mx % 64 < 1 || my % 64 < 1) return TEX.sector;
    if (mx % 10 < 1 || my % 10 < 1) return TEX.line;
    return TEX.grass;
  }

  const water = {
    level: G - 60,                                   // 0.3 m under the ground: the pool is 2.2 m deep
    covers: (x, y) => inRect(x * 2, y * 2, POOL)
  };

  function attr(x, y) {                               // x, y in cells like height(); 1 m attribute pixels
    const mx = x * 2, my = y * 2, out = [];
    if (Math.abs(mx - MID) <= 20 && Math.abs(my - MID) <= 20) out.push("banpk");        // spawn plaza
    if (inRect(mx, my, POOL)) out.push("water");
    for (const [x0, w] of STRIPS.xs) if (mx >= x0 && mx < x0 + w && my >= STRIPS.y0 && my < STRIPS.y0 + STRIPS.length) out.push("block");
    if (inRect(mx, my, WALL)) out.push("block");
    if (mx < 2 || my < 2 || mx >= SIZE * 256 - 2 || my >= SIZE * 256 - 2) out.push("block");   // map border
    return out;
  }

  function objects() {
    // west test line, 8 m apart, at y = 512 m (cells are 2 m)
    const line = ["pillar", "tent", "statue", "lamp", "brazier", "pine", "campfire", "light", "fire"];
    return line.map((k, i) => ({ crc: CRC[k], cx: (440 - i * 8) / 2, cy: MID / 2, yaw: 0 }));
  }

  return {
    name, sizeX: SIZE, sizeY: SIZE, height, texture, water, attr, objects,
    textures: [
      { file: "d:/ymir work/terrainmaps/a/grass/grass 01.dds" },
      { file: "d:/ymir work/terrainmaps/a/field/field 02.dds" },
      { file: "d:/ymir work/terrainmaps/12temple/stone_02.dds" },
      { file: "d:/ymir work/terrainmaps/12temple/stone_tile_001.dds" },
      { file: "d:/ymir work/terrainmaps/a/beach/beach sand 01.dds" },
      { file: "d:/ymir work/terrainmaps/12temple/5st_cliff_001.dds" }
    ],
    environment: "a1.msenv",
    town: { x: MID, y: MID + 10 }
  };
}

module.exports = { ...create(), create };
