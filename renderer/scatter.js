// Biome scatter: places objects in layers the way natural maps are built - clustered groves (Thomas cluster process),
// patches from a noise mask with thinning edges, undergrowth near the trees of another layer, rocks sunk into the ground.
// Every candidate is tested against slope, height, textures, water, blocked attribute, roads / reserved areas and the
// footprints of everything already on the map (sizes from the asset catalog).
import { fbm, rng, smoothstep, polylineDistance } from "./noise.js";

/**
 * model: TerrainModel; existing: [{ x, y, r }] m; info(crc) -> { size: [w, d, h] m, tree: bool }
 * opts: { area [x0, y0, x1, y1], seed, avoid: [{ x, y, r }], avoidLines: [{ points, radius }], avoidWater m (3), avoidBlocked (true),
 *   layers: [{ name, items: [{ crc, weight }], density (per ha of area, before masks) or count (exact number, landmarks),
 *     blocked: "avoid" | "only" (forest on blocked hills) | "any", cluster: { radius m, size },
 *     near: { layer, radius m, chance }, spacing m (same layer), clearance m (1, to other objects), slope [min, max] deg,
 *     height [min, max] m, onTextures [idx], avoidTextures [idx], mask: { scale m, min (-1..1), fade, seed },
 *     sink 0..1 (share of the height sunk), maxGroundRange m (1.5), yaw (number = fixed, default random) }] }
 * returns { items: [{ crc, x, y, z, yaw, layer }], stats: { layer: { candidates, placed, rejected: {...} } } }
 */
export function scatter(model, existing, info, opts) {
  const seed = opts.seed ?? 1, r = rng(seed * 7 + 3);
  const W = model.widthCells * 2, D = model.depthCells * 2;
  const [x0, y0, x1, y1] = opts.area || [0, 0, W, D];
  const ha = ((x1 - x0) * (y1 - y0)) / 10000;
  const G = 8, grid = new Map(), key = (x, y) => `${Math.floor(x / G)},${Math.floor(y / G)}`;
  const put = (o) => { const k = key(o.x, o.y); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(o); };
  let maxR = 2;
  for (const o of existing) { put({ ...o, layer: null }); maxR = Math.max(maxR, o.r); }
  const avoid = opts.avoid || [], lines = opts.avoidLines || [];
  const avoidWater = opts.avoidWater ?? 3, avoidBlocked = opts.avoidBlocked ?? true;
  const gauss = () => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  const items = [], stats = {}, byLayer = {};
  const slopeAt = (x, y) => Math.atan(Math.hypot(model.at(x + 1, y) - model.at(x - 1, y), model.at(x, y + 1) - model.at(x, y - 1)) / 2) * 180 / Math.PI;
  const wet = (x, y, rad) => {
    for (const [dx, dy] of [[0, 0], [rad, 0], [-rad, 0], [0, rad], [0, -rad]]) {
      const cx = Math.floor((x + dx) / 2), cy = Math.floor((y + dy) / 2), w = model.waterLevel(cx, cy);
      if (w !== null && w / 200 > model.at(x + dx, y + dy) - 0.3) return true;
    }
    return false;
  };
  for (const L of opts.layers) {
    const st = (stats[L.name] = { candidates: 0, placed: 0, rejected: {} });
    const rej = (why) => { st.rejected[why] = (st.rejected[why] || 0) + 1; return false; };
    const wsum = L.items.reduce((s, i) => s + (i.weight ?? 1), 0);
    const pick = () => { let t = r() * wsum; for (const i of L.items) { t -= i.weight ?? 1; if (t <= 0) return i.crc; } return L.items[0].crc; };
    const mask = L.mask && { fade: 0.15, ...L.mask, f: fbm(L.mask.seed ?? seed + 101, { octaves: 4 }) };
    // candidates
    const cand = [];
    const n = L.count ? L.count * 80 : Math.round((L.density || 0) * ha);
    if (L.near) {
      for (const ref of byLayer[L.near.layer] || []) {
        if (r() > (L.near.chance ?? 0.6)) continue;
        const k = 1 + Math.floor(r() * 3);
        for (let i = 0; i < k; i++) { const a = r() * 6.283, d = ref.r + 0.6 + r() * (L.near.radius - ref.r); cand.push([ref.x + Math.cos(a) * d, ref.y + Math.sin(a) * d]); }
      }
    } else if (L.cluster) {
      const parents = Math.max(1, Math.round(n / L.cluster.size));
      for (let p = 0; p < parents; p++) {
        const px = x0 + r() * (x1 - x0), py = y0 + r() * (y1 - y0), k = Math.max(1, Math.round(L.cluster.size * (0.4 + r() * 1.2)));
        for (let i = 0; i < k; i++) cand.push([px + gauss() * L.cluster.radius, py + gauss() * L.cluster.radius]);
      }
    } else for (let i = 0; i < n; i++) cand.push([x0 + r() * (x1 - x0), y0 + r() * (y1 - y0)]);
    st.candidates = cand.length;
    const placedHere = (byLayer[L.name] = []);
    const blockedMode = L.blocked ?? (avoidBlocked ? "avoid" : "any");
    for (const [x, y] of cand) {
      if (L.count && st.placed >= L.count) break;
      if (x < x0 || y < y0 || x >= x1 || y >= y1 || x < 2 || y < 2 || x > W - 2 || y > D - 2) { rej("area"); continue; }
      if (mask) { const v = mask.f(x / mask.scale, y / mask.scale); if (v < mask.min) { rej("mask"); continue; } if (r() > smoothstep((v - mask.min) / mask.fade)) { rej("mask-edge"); continue; } }
      const crc = pick(), inf = info(crc) || {}, size = inf.size || [2, 2, 2];
      const rad = inf.tree ? Math.min(2, Math.max(0.6, size[0] * 0.18)) : Math.max(0.5, Math.max(size[0], size[1]) / 2);
      if (avoid.some((a) => Math.hypot(a.x - x, a.y - y) < a.r + rad)) { rej("reserved"); continue; }
      if (lines.some((l) => polylineDistance(l.points, x, y) < l.radius + rad)) { rej("road"); continue; }
      const s = slopeAt(x, y);
      if (L.slope && (s < L.slope[0] || s > L.slope[1])) { rej("slope"); continue; }
      const h = model.at(x, y);
      if (L.height && (h < L.height[0] || h > L.height[1])) { rej("height"); continue; }
      const t = model.tile(Math.floor(x), Math.floor(y));
      if (L.onTextures && !L.onTextures.includes(t)) { rej("texture"); continue; }
      if (L.avoidTextures && L.avoidTextures.includes(t)) { rej("texture"); continue; }
      const isBlocked = model.attr(Math.floor(x), Math.floor(y)) & 1;
      if (blockedMode === "avoid" && isBlocked) { rej("blocked"); continue; }
      if (blockedMode === "only" && !isBlocked) { rej("not-blocked"); continue; }
      if (avoidWater >= 0 && wet(x, y, Math.max(rad, avoidWater))) { rej("water"); continue; }
      // footprint spacing
      const clear = L.clearance ?? 1, reach = Math.ceil((rad + maxR + Math.max(clear, L.spacing || 0)) / G);
      let ok = true;
      for (let dy = -reach; dy <= reach && ok; dy++) for (let dx = -reach; dx <= reach && ok; dx++) for (const o of grid.get(`${Math.floor(x / G) + dx},${Math.floor(y / G) + dy}`) || []) {
        const d = Math.hypot(o.x - x, o.y - y);
        if (d < o.r + rad + clear || (o.layer === L.name && d < (L.spacing || 0))) { ok = false; break; }
      }
      if (!ok) { rej("spacing"); continue; }
      // ground: lowest point under the footprint so no edge floats; reject steps larger than maxGroundRange
      const pts = [[x, y], [x + rad * 0.7, y], [x - rad * 0.7, y], [x, y + rad * 0.7], [x, y - rad * 0.7]].map(([a, b]) => model.at(a, b));
      const lo = Math.min(...pts), range = Math.max(...pts) - lo;
      if (!inf.tree && range > (L.maxGroundRange ?? 1.5)) { rej("uneven"); continue; }
      const z = (inf.tree ? lo : lo) - (L.sink ?? 0) * size[2];
      const o = { crc, x, y, z, yaw: L.yaw ?? Math.floor(r() * 360), layer: L.name, r: rad };
      put(o); placedHere.push(o); items.push(o); maxR = Math.max(maxR, rad); st.placed++;
    }
  }
  return { items: items.map(({ r: _r, ...o }) => o), stats };
}
