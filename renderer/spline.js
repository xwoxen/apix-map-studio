// Roads and rivers along a smooth curve. The curve (Catmull-Rom through the given points) is sampled every metre;
// every terrain cell, texture half cell and attribute pixel near it is shaped by its distance to the curve.
//  road:  terrain levelled to a smoothed, grade-limited profile across the core width, blended out over the edge band;
//         core texture with a ragged border, edge texture as a worn shoulder.
//  river: bed carved below a profile that only ever falls along the curve (water flows from the first point), rounded
//         cross-section, banks blended back to the original ground; water surface, water attribute, optional block.
// Positions are scene metres (x east, z = map y south). Heights in the model are raw (1 m = 200).

const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function catmullRom(points, step = 1) {
  const p = [points[0], ...points, points[points.length - 1]], out = [];
  for (let i = 1; i < p.length - 2; i++) {
    const [p0, p1, p2, p3] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
    const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

// deterministic 1D value noise in -1..1 along the curve (ragged edges that do not repeat)
function noise1(s, seed) {
  const h = (n) => { const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };
  const i = Math.floor(s), f = s - i, u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}
const ragged = (s, seed) => 0.6 * noise1(s / 3, seed) + 0.4 * noise1(s / 1.1, seed + 7);

function movingAverage(a, window) {
  const out = new Float64Array(a.length), half = Math.max(1, Math.floor(window / 2));
  for (let i = 0; i < a.length; i++) { let s = 0, n = 0; for (let k = Math.max(0, i - half); k <= Math.min(a.length - 1, i + half); k++) { s += a[k]; n++; } out[i] = s / n; }
  return out;
}

// nearest curve sample for any point, via a 4 m bucket grid over the samples
function nearestIndex(samples) {
  const G = 4, grid = new Map(), key = (x, y) => `${Math.floor(x / G)},${Math.floor(y / G)}`;
  samples.forEach(([x, y], i) => { const k = key(x, y); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  return (x, y, maxD) => {
    let best = -1, bd = maxD;
    const r = Math.ceil(maxD / G), gx = Math.floor(x / G), gy = Math.floor(y / G);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) for (const i of grid.get(`${gx + dx},${gy + dy}`) || []) {
      const d = Math.hypot(samples[i][0] - x, samples[i][1] - y);
      if (d < bd) { bd = d; best = i; }
    }
    return best < 0 ? null : { i: best, d: bd };
  };
}

/**
 * opts: { kind: "road" | "river", points: [[x, y], ...] (m), width (core m), edge (band m), texture, edgeTexture, bedTexture
 *         (texture indices), depth (river m), maxGrade (road, rise per metre), smooth (profile window m), block (river),
 *         seed, attrFlags: { water, block } bit values }
 * returns { keys, parts, length, profile: [min, max] m, waterLevels }
 */
export function applySpline(model, opts) {
  const { kind, width, edge = kind === "river" ? 4 : 2.5, seed = 1 } = opts;
  const half = width / 2, reach = half + edge + 1.5;
  const samples = catmullRom(opts.points, 1);
  const n = samples.length;
  const keys = new Set(), parts = new Set();
  // profile along the curve
  const ground = Float64Array.from(samples, ([x, y]) => model.at(x, y));
  let target = movingAverage(ground, opts.smooth || (kind === "river" ? 30 : 24));
  if (kind === "road") {
    const g = opts.maxGrade ?? 0.12;
    for (let i = 1; i < n; i++) target[i] = Math.min(Math.max(target[i], target[i - 1] - g), target[i - 1] + g);
    for (let i = n - 2; i >= 0; i--) target[i] = Math.min(Math.max(target[i], target[i + 1] - g), target[i + 1] + g);
  } else {
    const depth = opts.depth ?? 2;
    for (let i = 1; i < n; i++) target[i] = Math.min(target[i], target[i - 1]);       // never flows uphill
    target = target.map((h) => h - depth);                                            // bed under the banks
  }
  const nearest = nearestIndex(samples);
  // 1) heights (2 m cells)
  const minCx = Math.floor((Math.min(...samples.map((p) => p[0])) - reach) / 2), maxCx = Math.ceil((Math.max(...samples.map((p) => p[0])) + reach) / 2);
  const minCy = Math.floor((Math.min(...samples.map((p) => p[1])) - reach) / 2), maxCy = Math.ceil((Math.max(...samples.map((p) => p[1])) + reach) / 2);
  const updates = [];
  for (let cy = Math.max(0, minCy); cy <= Math.min(model.depthCells, maxCy); cy++) for (let cx = Math.max(0, minCx); cx <= Math.min(model.widthCells, maxCx); cx++) {
    const hit = nearest(cx * 2, cy * 2, reach);
    if (!hit) continue;
    const h = model.raw(cx, cy) / 200, t = target[hit.i];
    let v = h;
    if (kind === "road") {
      const w = hit.d <= half ? 1 : 1 - smoothstep((hit.d - half) / edge);
      v = h + (t - h) * w;
    } else {
      const depth = opts.depth ?? 2;
      if (hit.d <= half) v = Math.min(h, t + depth * 0.55 * (hit.d / half) ** 2);         // rounded bed
      else { const bankTop = t + depth * 0.55, w = 1 - smoothstep((hit.d - half) / edge); v = Math.min(h, h + (bankTop - h) * w); }
    }
    if (Math.abs(v - h) > 0.004) updates.push([cx, cy, v * 200]);
  }
  for (const [cx, cy, v] of updates) model.setRaw(cx, cy, v, keys);
  if (updates.length) parts.add("height");
  // cumulative length for the ragged edges
  const sAt = new Float64Array(n); for (let i = 1; i < n; i++) sAt[i] = sAt[i - 1] + Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]);
  // 2) textures (1 m half cells) and attributes (1 m pixels)
  const waterLevels = new Set();
  for (let hy = Math.max(0, minCy * 2); hy < Math.min(model.depthCells * 2, maxCy * 2); hy++) for (let hx = Math.max(0, minCx * 2); hx < Math.min(model.widthCells * 2, maxCx * 2); hx++) {
    const hit = nearest(hx + 0.5, hy + 0.5, reach);
    if (!hit) continue;
    const s = sAt[hit.i], jag = ragged(s, seed) * Math.min(0.9, half * 0.25);
    if (kind === "road") {
      if (hit.d <= half + jag) model.setTile(hx, hy, opts.texture, keys);
      else if (opts.edgeTexture && hit.d <= half + edge * 0.7 + jag && noise1(hx * 0.7 + hy * 1.3, seed + 3) > -0.2) model.setTile(hx, hy, opts.edgeTexture, keys);
    } else {
      if (hit.d <= half + 0.5 + jag * 0.5) { if (opts.bedTexture) model.setTile(hx, hy, opts.bedTexture, keys); }
      else if (opts.texture && hit.d <= half + edge * 0.8 + jag) model.setTile(hx, hy, opts.texture, keys);
    }
  }
  if (keys.size) parts.add("tile");
  if (kind === "river") {
    const depth = opts.depth ?? 2;
    const flags = opts.attrFlags || {};
    for (let cy = Math.max(0, minCy); cy < Math.min(model.depthCells, maxCy); cy++) for (let cx = Math.max(0, minCx); cx < Math.min(model.widthCells, maxCx); cx++) {
      const hit = nearest(cx * 2 + 1, cy * 2 + 1, half + edge);
      if (!hit) continue;
      const level = Math.round((target[hit.i] + depth * 0.7) * 4) / 4;              // surface 70 % up the bed, 0.25 m steps
      const ground = model.at(cx * 2 + 1, cy * 2 + 1);
      if (ground >= level) continue;
      if (model.setWater(cx, cy, Math.round(level * 200))) parts.add("water");
      waterLevels.add(level);
      for (let ay = cy * 2; ay < cy * 2 + 2; ay++) for (let ax = cx * 2; ax < cx * 2 + 2; ax++) {
        if (flags.water) model.setAttr(ax, ay, flags.water, false, keys);
        if (opts.block && flags.block) model.setAttr(ax, ay, flags.block, false, keys);
      }
    }
    if (flags.water || (opts.block && flags.block)) parts.add("attr");
  }
  return { keys, parts, length: Math.round(sAt[n - 1]), profile: [Math.min(...target), Math.max(...target)].map((v) => +v.toFixed(2)), waterLevels: [...waterLevels].sort((a, b) => a - b) };
}
