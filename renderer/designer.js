// Designer helpers shared by the API (place_near), build scripts (window.__studio.kit) and tests. Plain functions over
// the terrain model: nothing here touches the scene. Positions are scene metres (x east, y = map y south).
import { polylineDistance } from "./noise.js";

export const disc = (cx, cy, r, step = 1) => { const o = []; for (let y = -r; y <= r; y += step) for (let x = -r; x <= r; x += step) if (x * x + y * y <= r * r) o.push([cx + x, cy + y]); return o; };
export const ring = (cx, cy, r, n, startDeg = 0) => Array.from({ length: n }, (_, i) => { const a = ((startDeg + (i * 360) / n) * Math.PI) / 180; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
// points along a polyline every `step` m, with offsets across it from -half to +half
export function along(points, half = 0, step = 1) {
  const o = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = points[i], [bx, by] = points[i + 1], L = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / L, ny = (bx - ax) / L;
    for (let t = 0; t <= L; t += step) for (let w = -half; w <= half; w += step) o.push([ax + ((bx - ax) * t) / L + nx * w, ay + ((by - ay) * t) / L + ny * w]);
  }
  return o;
}
export const polyDist = polylineDistance;
export const slopeAt = (model, x, y) => (Math.atan(Math.hypot((model.at(x + 1, y) - model.at(x - 1, y)) / 2, (model.at(x, y + 1) - model.at(x, y - 1)) / 2)) * 180) / Math.PI;
export const walkable = (model, x, y) => x >= 0 && y >= 0 && !(model.attr(Math.floor(x), Math.floor(y)) & 3);
// rough terrain under a footprint: max height difference over a circle (m)
export function roughness(model, x, y, r) {
  let lo = model.at(x, y), hi = lo;
  for (let a = 0; a < 8; a++) for (const f of [0.5, 1]) { const h = model.at(x + Math.cos(a * 0.785) * r * f, y + Math.sin(a * 0.785) * r * f); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  return hi - lo;
}
// path textures of a map: field / road / path / dirt / tile / pave in the file name (Yongan paths are "field")
export const pathTextureIndices = (textures) => new Set(textures.filter((t) => /field|road|path|dirt|tile|pave|street/i.test(t.file)).map((t) => t.index));

/**
 * Nearest good spot to `near`, spiralling out to `radius` m:
 *   walkable (unless onBlocked), slope <= maxSlope, roughness over the footprint <= maxRough, at least `clearance` m (plus the
 *   other object's own radius) from every taken spot, not on path textures (offPath), not within avoid circles / lines,
 *   onTextures / avoidTextures (texture indices), notWater.
 * taken: [{ x, y, r }] is extended with the chosen spot, so consecutive calls keep apart.
 */
export function findSpot(model, taken, { near, radius = 4, step = 0.5, footprint = 1, clearance = 0.5, maxSlope = 16, maxRough = 1.2,
  offPath = false, pathTextures = null, onTextures = null, avoidTextures = null, avoid = [], avoidLines = [], onBlocked = false } = {}) {
  const [x0, y0] = near;
  const tex = (x, y) => model.tile(Math.floor(x), Math.floor(y));
  const ok = (x, y) => {
    if (onBlocked ? !(model.attr(Math.floor(x), Math.floor(y)) & 1) : !walkable(model, x, y)) return false;
    if (slopeAt(model, x, y) > maxSlope || roughness(model, x, y, footprint) > maxRough) return false;
    if (offPath && pathTextures) for (const [dx, dy] of [[0, 0], [footprint, 0], [-footprint, 0], [0, footprint], [0, -footprint]]) if (pathTextures.has(tex(x + dx, y + dy))) return false;
    if (onTextures && !onTextures.includes(tex(x, y))) return false;
    if (avoidTextures && avoidTextures.includes(tex(x, y))) return false;
    if (avoid.some((a) => Math.hypot(a.x - x, a.y - y) < a.r) || avoidLines.some((l) => polylineDistance(l.points, x, y) < l.radius)) return false;
    return taken.every((t) => Math.hypot(t.x - x, t.y - y) >= footprint + clearance + (t.r || 0));
  };
  for (let d = 0; d <= radius + 1e-9; d += step) {
    const n = d === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * d) / step));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI, x = x0 + Math.cos(a) * d, y = y0 + Math.sin(a) * d;
      if (ok(x, y)) { const spot = { x: +x.toFixed(2), y: +y.toFixed(2), r: footprint, moved: +d.toFixed(2) }; taken.push(spot); return spot; }
    }
  }
  return null;
}
