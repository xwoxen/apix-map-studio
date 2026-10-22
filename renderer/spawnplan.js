// Metin and monster group placement the way a farm map needs it: per zone, on flat ground the player can reach from
// the town, with free space round the stone (no objects), off the roads, spread out. Metins take the flattest spots,
// groups the rest in random order. Positions are scene metres.
import { rng, polylineDistance } from "./noise.js";

/**
 * model: terrain model; reach(x, y) -> bool (reachable() result .at); objects: [{ x, y }]
 * opts: zones: [{ name, circles: [[x, y, r], ...] | box: [x0, y0, x1, y1], metins: [vnum...], groups: [vnum...],
 *         groupType ("g"), metinRespawn (600), groupRespawn (90), groupRadius (5) }],
 *       avoid [{ x, y, r }], avoidLines [{ points, radius }], metinSpacing (30), groupSpacing (22), metinClear (6),
 *       metinRough (3.5) / groupRough (5) m height range over a probe circle, probe (8 m radius, all reachable), step (4), seed
 * returns { items: [{ type, vnum, x, y, radius, count, respawn, zone }], stats: { zone: { candidates, metins, groups } } }
 */
export function planSpawns(model, reach, objects, opts = {}) {
  const step = opts.step ?? 4, probe = opts.probe ?? 8, mSp = opts.metinSpacing ?? 30, gSp = opts.groupSpacing ?? 22;
  const G = 8, grid = new Map();
  for (const o of objects) { const k = `${Math.floor(o.x / G)},${Math.floor(o.y / G)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(o); }
  const objNear = (x, y, r) => { const n = Math.ceil(r / G); for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) for (const o of grid.get(`${Math.floor(x / G) + dx},${Math.floor(y / G) + dy}`) || []) if (Math.hypot(o.x - x, o.y - y) < r) return true; return false; };
  const ring = [];
  for (let a = 0; a < 8; a++) for (const f of [0.5, 1]) ring.push([Math.cos((a * Math.PI) / 4) * probe * f, Math.sin((a * Math.PI) / 4) * probe * f]);
  const rough = (x, y) => { let lo = model.at(x, y), hi = lo; for (const [dx, dy] of ring) { const h = model.at(x + dx, y + dy); lo = Math.min(lo, h); hi = Math.max(hi, h); } return hi - lo; };
  const open = (x, y) => reach(x, y) && ring.every(([dx, dy]) => reach(x + dx, y + dy));
  const avoid = opts.avoid || [], lines = opts.avoidLines || [];
  const items = [], stats = {}, metinsAll = [], groupsAll = [];
  (opts.zones || []).forEach((Z, zi) => {
    const name = Z.name || String(zi + 1);
    const inZone = Z.circles ? (x, y) => Z.circles.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) < r - probe * 0.75) : (x, y) => x > Z.box[0] && y > Z.box[1] && x < Z.box[2] && y < Z.box[3];
    const bb = Z.circles ? Z.circles.reduce((b, [cx, cy, r]) => [Math.min(b[0], cx - r), Math.min(b[1], cy - r), Math.max(b[2], cx + r), Math.max(b[3], cy + r)], [Infinity, Infinity, -Infinity, -Infinity]) : Z.box;
    const cands = [];
    for (let y = Math.ceil(bb[1] / step) * step; y <= bb[3]; y += step) for (let x = Math.ceil(bb[0] / step) * step; x <= bb[2]; x += step) {
      if (!inZone(x, y) || avoid.some((a) => Math.hypot(x - a.x, y - a.y) < a.r) || lines.some((l) => polylineDistance(l.points, x, y) < l.radius) || !open(x, y)) continue;
      cands.push({ x, y, r: rough(x, y), clear: !objNear(x, y, opts.metinClear ?? 6) });
    }
    cands.sort((a, b) => a.r - b.r);
    const metins = [], groups = [];
    for (const c of cands) {
      if (metins.length >= (Z.metins || []).length) break;
      if (c.clear && c.r < (opts.metinRough ?? 3.5) && [...metinsAll, ...metins].every((m) => Math.hypot(m.x - c.x, m.y - c.y) > mSp)) metins.push(c);
    }
    const rnd = rng((opts.seed ?? 1) + zi * 101);
    const shuffled = cands.map((c) => [rnd(), c]).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
    for (const c of shuffled) {
      if (groups.length >= (Z.groups || []).length) break;
      if (c.r > (opts.groupRough ?? 5) || [...metinsAll, ...metins].some((m) => Math.hypot(m.x - c.x, m.y - c.y) < 16) || [...groupsAll, ...groups].some((m) => Math.hypot(m.x - c.x, m.y - c.y) < gSp)) continue;
      groups.push(c);
    }
    metins.forEach((m, i) => items.push({ type: "m", vnum: Z.metins[i], x: m.x, y: m.y, radius: 2, count: 1, respawn: Z.metinRespawn ?? 600, zone: name }));
    groups.forEach((g, i) => items.push({ type: Z.groupType || "g", vnum: Z.groups[i], x: g.x, y: g.y, radius: Z.groupRadius ?? 5, count: 1, respawn: Z.groupRespawn ?? 90, zone: name }));
    metinsAll.push(...metins); groupsAll.push(...groups);
    stats[name] = { candidates: cands.length, metins: `${metins.length}/${(Z.metins || []).length}`, groups: `${groups.length}/${(Z.groups || []).length}` };
  });
  return { items, stats };
}
