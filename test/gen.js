// Node test for the phase-2 generators on an in-memory terrain model (no Electron): terrain relief + flats,
// rule texturing, scatter spacing / mask / reserved areas. Run: node test/gen.js
const assert = require("assert");
(async () => {
  const { generateTerrain } = await import("../renderer/terraingen.js");
  const { autoTexture } = await import("../renderer/autotexture.js");
  const { scatter } = await import("../renderer/scatter.js");
  // minimal model: 1 terrain (128 cells = 256 m)
  const N = 128, h = new Float64Array((N + 1) * (N + 1)).fill(164 * 200), tile = new Uint8Array(256 * 256).fill(1), attr = new Uint8Array(256 * 256);
  const model = {
    widthCells: N, depthCells: N,
    raw: (x, y) => h[Math.max(0, Math.min(N, y)) * (N + 1) + Math.max(0, Math.min(N, x))],
    setRaw: (x, y, v, keys) => { h[y * (N + 1) + x] = v; keys && keys.add("000000"); },
    at(x, z) { const cx = x / 2, cy = z / 2, x0 = Math.floor(cx), y0 = Math.floor(cy), fx = cx - x0, fy = cy - y0; return (this.raw(x0, y0) * (1 - fx) * (1 - fy) + this.raw(x0 + 1, y0) * fx * (1 - fy) + this.raw(x0, y0 + 1) * (1 - fx) * fy + this.raw(x0 + 1, y0 + 1) * fx * fy) / 200; },
    tile: (x, y) => tile[Math.max(0, Math.min(255, y)) * 256 + Math.max(0, Math.min(255, x))],
    setTile: (x, y, i, keys) => { tile[y * 256 + x] = i; keys.add("000000"); },
    waterLevel: () => null, attr: (x, y) => attr[y * 256 + x],
  };
  const { stats: g } = generateTerrain(model, { base: 170, seed: 3, hills: { amplitude: 8, scale: 90 }, rim: { box: [40, 40, 216, 216], width: 30, height: 20 }, flats: [{ x: 128, y: 128, r: 15, blend: 8 }], erosion: { droplets: 4000, thermal: 5 } });
  assert(g.max - g.min > 10, "relief expected, got " + JSON.stringify(g));
  const centre = [[128, 128], [120, 128], [136, 128], [128, 120], [128, 136]].map(([x, y]) => model.at(x, y));
  assert(Math.max(...centre) - Math.min(...centre) < 0.2, "flat pad not flat: " + centre);
  assert(model.at(10, 10) > model.at(128, 128) + 8, "rim should be higher than the centre");
  console.log("ok: terrain relief", g.min, "..", g.max, "flat pad ±", (Math.max(...centre) - Math.min(...centre)).toFixed(3));
  const t = autoTexture(model, { seed: 1, rules: [{ texture: 3, slope: [25, 90] }, { texture: 2, noise: { scale: 40, min: 0.2 } }, { texture: 1 }], keep: [] });
  assert(t.counts[3] > 0 && t.counts[2] > 0, "rock and noise textures expected: " + JSON.stringify(t.counts));
  console.log("ok: auto texture", JSON.stringify(t.counts));
  const info = (crc) => ({ size: crc === 1 ? [10, 10, 15] : [3, 3, 2], tree: crc === 1 });
  const res = scatter(model, [{ x: 60, y: 60, r: 5 }], info, { area: [40, 40, 216, 216], seed: 2, avoid: [{ x: 128, y: 128, r: 20 }], layers: [
    { name: "grove", items: [{ crc: 1 }], density: 8, cluster: { radius: 10, size: 5 }, spacing: 7, mask: { scale: 60, min: -0.1 } },
    { name: "rock", items: [{ crc: 2 }], density: 3, sink: 0.3, maxGroundRange: 3 }] });
  const trees = res.items.filter((i) => i.layer === "grove");
  assert(trees.length > 10, "trees expected: " + JSON.stringify(res.stats));
  for (const a of trees) for (const b of trees) if (a !== b) assert(Math.hypot(a.x - b.x, a.y - b.y) >= 7 - 1e-6, "tree spacing");
  for (const i of res.items) assert(Math.hypot(i.x - 128, i.y - 128) >= 20, "reserved area violated");
  assert(res.items.filter((i) => i.layer === "rock").every((i) => i.z < model.at(i.x, i.y)), "rocks should be sunk");
  console.log("ok: scatter", JSON.stringify(Object.fromEntries(Object.entries(res.stats).map(([k, v]) => [k, v.placed]))));
  const { rotator } = await import("../renderer/importregion.js");
  for (let k = 0; k < 4; k++) {
    const r = rotator(k, 200, 120);
    for (const [u, v] of [[0, 0], [37, 91], [200, 120]]) {
      const [a, b] = r.fwd(u, v), [u2, v2] = r.inv(a, b);
      assert(a >= 0 && b >= 0 && a <= r.W && b <= r.H && Math.abs(u2 - u) + Math.abs(v2 - v) < 1e-9, `rotator ${k} (${u}, ${v})`);
    }
  }
  assert.deepStrictEqual(rotator(1, 200, 120).fwd(0, 0), [120, 0], "clockwise: north-west corner goes to north-east");
  console.log("ok: region rotator");
  const { applySpline } = await import("../renderer/spline.js");
  h.fill(170 * 200); attr.fill(0);
  model.setAttr = (x, y, f, erase, keys) => { attr[y * 256 + x] = erase ? attr[y * 256 + x] & ~f : attr[y * 256 + x] | f; keys.add("000000"); };
  const rg = applySpline(model, { kind: "ridge", points: [[128, 10], [128, 246]], width: 30, height: 12, texture: 4, steepTexture: 5, block: true, seed: 2, attrFlags: { block: 1 } });
  const crest = model.at(128, 128), flank = model.at(128 + 40, 128);
  assert(crest > 178 && crest < 190 && flank < 171, `ridge crest ${crest} flank ${flank}`);
  assert(attr[128 * 256 + 128] & 1 && !(attr[128 * 256 + 200] & 1), "ridge crest blocked, meadow free");
  assert(model.tile(128, 128) === 4 && model.tile(200, 128) !== 4, "ridge texture");
  h.fill(170 * 200);
  generateTerrain(model, { seed: 4, hills: { amplitude: 0 }, erosion: { droplets: 0, thermal: 0 }, anchors: [{ x: 40, y: 220, h: 170 }, { x: 220, y: 40, h: 200 }],
    rim: { open: [{ x: 40, y: 220, r: 25 }, { points: [[40, 220], [220, 40]], radius: 8 }, { x: 220, y: 40, r: 25 }], width: 30, height: 20 } });
  const lo = model.at(40, 220), hi = model.at(220, 40), path = model.at(130, 130), off = model.at(220, 220);
  assert(Math.abs(lo - 170) < 0.5 && Math.abs(hi - 200) < 0.5 && path > lo + 5 && path < hi - 5, `anchors ${lo} ${path} ${hi}`);
  assert(off > model.at(130, 130) + 10, "mountains outside the open shapes: " + off);
  console.log("ok: anchors", lo.toFixed(1), path.toFixed(1), hi.toFixed(1), "open-shape rim", off.toFixed(1));
  console.log("ok: ridge crest", crest.toFixed(1), "flank", flank.toFixed(1), rg.parts.size, "parts");
  // phase 9: reachability, spawn planner, forest edge on a valley (walkable disc r 60 + a separate pocket, rest blocked)
  const { reachable, patches, distanceToWalkable } = await import("../renderer/reach.js");
  const { planSpawns } = await import("../renderer/spawnplan.js");
  const { forestEdge } = await import("../renderer/forestedge.js");
  h.fill(170 * 200);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) attr[y * 256 + x] = Math.hypot(x - 100, y - 128) < 60 || Math.hypot(x - 220, y - 40) < 15 ? 0 : 1;
  const R = reachable(model, { x: 100, y: 128 });
  assert(Math.abs(R.count - Math.PI * 3600) < 300 && R.at(130, 128) && !R.at(220, 40), "reach " + R.count);
  const P = patches(model);
  assert(P.length === 2 && P[0] > P[1], "patches " + P);
  const DT = distanceToWalkable(model);
  assert(Math.abs(DT.at(100 + 70, 128) - 10) < 1.5 && DT.at(100, 128) === 0, "distance " + DT.at(170, 128));
  console.log("ok: reach", (R.count / 10000).toFixed(2), "ha, patches", P.length, "distance", DT.at(170, 128).toFixed(1));
  const plan = planSpawns(model, R.at, [{ x: 100, y: 128 }], { seed: 3, avoid: [{ x: 100, y: 128, r: 15 }], zones: [{ circles: [[100, 128, 60]], metins: [8001, 8002, 8003], groups: [101, 102, 103, 104] }, { circles: [[220, 40, 15]], metins: [9001] }] });
  const ms = plan.items.filter((i) => i.type === "m"), gs = plan.items.filter((i) => i.type === "g");
  assert(ms.length === 3 && gs.length === 4, "plan " + JSON.stringify(plan.stats));
  for (const a of ms) { assert(R.at(a.x, a.y) && Math.hypot(a.x - 100, a.y - 128) >= 15, "metin reachable, out of the reserved area"); for (const b of ms) if (a !== b) assert(Math.hypot(a.x - b.x, a.y - b.y) > 30, "metin spacing"); }
  assert(!plan.items.some((i) => i.vnum === 9001), "the cut-off pocket gets nothing");
  console.log("ok: spawn plan", JSON.stringify(plan.stats));
  const FE = forestEdge(model, [], { seed: 5, items: [{ crc: 1 }], edge: { to: 12 }, fill: { radius: 15, chance: 0.4 } });
  assert(FE.stats.edge > 40 && FE.stats.fill > 10, "forest " + JSON.stringify(FE.stats));
  for (const t of FE.items) assert(attr[Math.floor(t.y) * 256 + Math.floor(t.x)] & 1, "trees on blocked ground only");
  const edgeTrees = FE.items.filter((t) => t.kind === "edge");
  assert(edgeTrees.every((t) => DT.at(t.x, t.y) <= 12.5), "edge trees within the band");
  console.log("ok: forest edge", JSON.stringify(FE.stats));
})().catch((e) => { console.error(e); process.exit(1); });
