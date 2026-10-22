// Forest framing the way the official maps do it: a closed wall of trees on the blocked ground right along every
// walkable valley, rock outcrops in it on steep spots, and the remaining bare blocked slopes filled where no tree
// stands nearby; above a tree line nothing grows. Works on the blocked (non-walkable) cells only.
import { rng, polylineDistance } from "./noise.js";
import { distanceToWalkable } from "./reach.js";

/**
 * model: terrain model; existing: [{ x, y }] objects already placed (kept apart)
 * opts: items [{ crc, weight }] trees, rocks [{ crc }] (optional), area [x0, y0, x1, y1],
 *   edge: { from (0.5), to (16) m from walkable ground, chance (0.7), spacing (5.5) },
 *   fill: { radius (15) m without a tree, chance (0.4), spacing (7) } | false,
 *   rockChance (0.05, on slopes over 26 degrees in the edge band), maxHeight (tree line m), maxSlope (50),
 *   avoid [{ x, y, r }], avoidLines [{ points, radius }], sink (0.3), step (3), seed
 * returns { items: [{ crc, x, y, z, yaw, kind }], stats }
 */
export function forestEdge(model, existing, opts = {}) {
  const r = rng(opts.seed ?? 1), step = opts.step ?? 3;
  const edge = { from: 0.5, to: 16, chance: 0.7, spacing: 5.5, ...(opts.edge || {}) };
  const fill = opts.fill === false ? null : { radius: 15, chance: 0.4, spacing: 7, ...(opts.fill || {}) };
  const W = model.widthCells * 2, H = model.depthCells * 2;
  const [ax0, ay0, ax1, ay1] = opts.area || [0, 0, W, H];
  const dist = distanceToWalkable(model, 1 | 2);
  const G = 6, grid = new Map(), key = (x, y) => `${Math.floor(x / G)},${Math.floor(y / G)}`;
  const add = (x, y) => { const k = key(x, y); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([x, y]); };
  for (const o of existing) add(o.x, o.y);
  const near = (x, y, rad) => { const n = Math.ceil(rad / G); for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) for (const [px, py] of grid.get(`${Math.floor(x / G) + dx},${Math.floor(y / G) + dy}`) || []) if (Math.hypot(px - x, py - y) < rad) return true; return false; };
  const slopeAt = (x, y) => Math.atan(Math.hypot((model.at(x + 1, y) - model.at(x - 1, y)) / 2, (model.at(x, y + 1) - model.at(x, y - 1)) / 2)) * 57.3;
  const items = opts.items || [], total = items.reduce((s, i) => s + (i.weight ?? 1), 0);
  const pick = () => { let t = r() * total; for (const i of items) { t -= i.weight ?? 1; if (t <= 0) return i.crc; } return items[items.length - 1].crc; };
  const out = [], stats = { edge: 0, fill: 0, rocks: 0 };
  if (!items.length) return { items: out, stats };
  for (let y = ay0 + step / 2; y < ay1; y += step) for (let x = ax0 + step / 2; x < ax1; x += step) {
    const px = Math.min(W - 0.5, Math.max(0.5, x + (r() - 0.5) * step)), py = Math.min(H - 0.5, Math.max(0.5, y + (r() - 0.5) * step));
    const a = model.attr(Math.floor(px), Math.floor(py));
    if (!(a & 1) || a & 2) continue;                                            // blocked dry ground only
    if ((opts.avoid || []).some((v) => Math.hypot(px - v.x, py - v.y) < v.r) || (opts.avoidLines || []).some((l) => polylineDistance(l.points, px, py) < l.radius)) continue;
    const d = dist.at(px, py), sl = slopeAt(px, py), h = model.at(px, py);
    if (sl > (opts.maxSlope ?? 50) || (opts.maxHeight !== undefined && h > opts.maxHeight)) continue;
    const inEdge = d >= edge.from && d <= edge.to;
    if (inEdge && opts.rocks && opts.rocks.length && sl > 26 && r() < (opts.rockChance ?? 0.05) && !near(px, py, 7)) {
      for (let i = 0; i < 3; i++) {
        const t = r() * 6.283, rr = i ? 2.5 + r() * 2 : 0, x2 = px + Math.cos(t) * rr, y2 = py + Math.sin(t) * rr;
        out.push({ crc: opts.rocks[Math.floor(r() * opts.rocks.length)].crc, x: x2, y: y2, z: model.at(x2, y2) - 0.5, yaw: Math.floor(r() * 360), kind: "rock" });
      }
      add(px, py); stats.rocks++; continue;
    }
    const chance = inEdge ? edge.chance : fill && !near(px, py, fill.radius) ? fill.chance : 0;
    if (r() >= chance || near(px, py, inEdge ? edge.spacing : fill.spacing)) continue;
    out.push({ crc: pick(), x: px, y: py, z: h - (opts.sink ?? 0.3), yaw: Math.floor(r() * 360), kind: inEdge ? "edge" : "fill" });
    add(px, py); stats[inEdge ? "edge" : "fill"]++;
  }
  return { items: out, stats };
}
