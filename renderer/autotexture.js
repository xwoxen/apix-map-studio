// Rule-based terrain texturing on the 1 m texture grid: the first rule that matches a half cell wins.
// A rule tests slope (deg), height (m), distance to water (m) and a noise mask; boundaries are made ragged with noise
// so slopes, banks and meadows do not end in straight lines. Cells painted with a "keep" texture (roads, plazas) stay.
import { fbm } from "./noise.js";

/**
 * opts: { rules: [{ texture (index), slope: [min, max], height: [min, max], water: max m, noise: { scale m, min, max },
 *                  jitter deg (3, ragged slope boundary) }], keep: [indices], area: [x0, y0, x1, y1] m, seed }
 * returns { keys, parts, counts: { index: half cells } }
 */
export function autoTexture(model, opts) {
  const W = model.widthCells * 2, D = model.depthCells * 2, seed = opts.seed ?? 1;
  const [x0, y0, x1, y1] = (opts.area || [0, 0, W, D]).map((v, i) => Math.max(0, Math.min(i % 2 ? D : W, Math.round(v))));
  const keep = new Set(opts.keep || []);
  const rules = opts.rules.map((r, i) => ({ ...r, jitter: r.jitter ?? 3, n: fbm(seed + 13 * (i + 1), { octaves: 4 }), j: fbm(seed + 29 * (i + 1), { octaves: 3 }) }));
  // distance to water on the 2 m grid (BFS), only as far as any rule asks
  const maxW = Math.max(0, ...rules.map((r) => r.water ?? 0));
  let wdist = null;
  if (maxW > 0) {
    const cw = model.widthCells, cd = model.depthCells, lim = Math.ceil(maxW / 2) + 1;
    wdist = new Uint8Array(cw * cd).fill(255);
    const q = [];
    for (let cy = 0; cy < cd; cy++) for (let cx = 0; cx < cw; cx++) if (model.waterLevel(cx, cy) !== null && model.waterLevel(cx, cy) / 200 > model.at(cx * 2 + 1, cy * 2 + 1)) { wdist[cy * cw + cx] = 0; q.push(cy * cw + cx); }
    for (let h = 0; h < q.length; h++) {
      const c = q[h], d = wdist[c]; if (d >= lim) continue;
      const cx = c % cw, cy = (c / cw) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= cw || y >= cd) continue; const k = y * cw + x; if (wdist[k] > d + 1) { wdist[k] = d + 1; q.push(k); } }
    }
  }
  const keys = new Set(), counts = {};
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (keep.has(model.tile(x, y))) continue;
    const px = x + 0.5, py = y + 0.5, h = model.at(px, py);
    const gx = (model.at(px + 1, py) - model.at(px - 1, py)) / 2, gy = (model.at(px, py + 1) - model.at(px, py - 1)) / 2;
    const slope = Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI;
    const wd = wdist ? wdist[Math.min(model.depthCells - 1, y >> 1) * model.widthCells + Math.min(model.widthCells - 1, x >> 1)] * 2 : Infinity;
    for (const r of rules) {
      const jit = r.j(px / 25, py / 25) * r.jitter;
      if (r.slope && (slope + jit < r.slope[0] || slope + jit > r.slope[1])) continue;
      if (r.height && (h + jit * 0.3 < r.height[0] || h + jit * 0.3 > r.height[1])) continue;
      if (r.water !== undefined && wd + jit > r.water) continue;
      if (r.noise) { const v = r.n(px / r.noise.scale, py / r.noise.scale); if (v < (r.noise.min ?? -2) || v > (r.noise.max ?? 2)) continue; }
      if (model.tile(x, y) !== r.texture) { model.setTile(x, y, r.texture, keys); counts[r.texture] = (counts[r.texture] || 0) + 1; }
      break;
    }
  }
  return { keys, parts: new Set(keys.size ? ["tile"] : []), counts };
}
