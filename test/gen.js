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
  console.log("ok: ridge crest", crest.toFixed(1), "flank", flank.toFixed(1), rg.parts.size, "parts");
})().catch((e) => { console.error(e); process.exit(1); });
