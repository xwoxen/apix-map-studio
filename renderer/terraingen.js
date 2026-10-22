// Terrain generator: fractal noise relief, raised rim mountains around a playable box, calm corridors (roads, plazas),
// hydraulic (droplet) and thermal erosion, then flat pads. Works on the 2 m height grid of the model inside an area and
// blends into the untouched ground at the area border. Heights in metres; the model stores raw (1 m = 200).
import { fbm, rng, smoothstep, polylineDistance } from "./noise.js";

/**
 * opts:
 *  area [x0, y0, x1, y1] m (default whole map), blend m (border blend into the old ground, default 0 for the whole map)
 *  base m (default: current mean height of the area)
 *  hills: { amplitude m (8), scale m feature size (140), octaves (5), ridged 0..1 (0.15), warp m (25) }
 *  rim: { box [x0, y0, x1, y1] playable area, width m (60), height m (30), ridged (0.6), scale (90) }   mountains outside the box
 *  calm: [{ points [[x, y], ...], radius m, factor 0..1 }]   noise multiplied by factor near the polylines (roads, valleys)
 *  flats: [{ x, y, r, blend (12), height? }]                 level pads after erosion (towns, plazas)
 *  erosion: { droplets (30000), strength (1), thermal iterations (20), talus deg (35) }
 *  seed
 * returns { keys, parts, stats }
 */
export function generateTerrain(model, opts = {}) {
  const seed = opts.seed ?? 1, W = model.widthCells, D = model.depthCells;
  const [ax0, ay0, ax1, ay1] = opts.area || [0, 0, W * 2, D * 2];
  const cx0 = Math.max(0, Math.floor(ax0 / 2)), cy0 = Math.max(0, Math.floor(ay0 / 2)), cx1 = Math.min(W, Math.ceil(ax1 / 2)), cy1 = Math.min(D, Math.ceil(ay1 / 2));
  const nx = cx1 - cx0 + 1, ny = cy1 - cy0 + 1, N = nx * ny;
  const old = new Float64Array(N);
  let mean = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { old[j * nx + i] = model.raw(cx0 + i, cy0 + j) / 200; mean += old[j * nx + i]; }
  mean /= N;
  const base = opts.base ?? mean;
  const hills = { amplitude: 8, scale: 140, octaves: 5, ridged: 0.15, warp: 25, ...(opts.hills || {}) };
  const relief = fbm(seed, { octaves: hills.octaves, ridged: hills.ridged });
  const warpX = fbm(seed + 31, { octaves: 3 }), warpY = fbm(seed + 47, { octaves: 3 });
  const rim = opts.rim && { width: 60, height: 30, ridged: 0.6, scale: 90, ...opts.rim };
  const rimNoise = rim && fbm(seed + 7, { octaves: 5, ridged: rim.ridged });
  const calm = opts.calm || [];
  const H = new Float64Array(N);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = (cx0 + i) * 2, y = (cy0 + j) * 2;
    const wx = x + warpX(x / 200, y / 200) * hills.warp, wy = y + warpY(x / 200, y / 200) * hills.warp;
    let f = 1;
    for (const c of calm) { const d = polylineDistance(c.points, x, y); f = Math.min(f, c.factor + (1 - c.factor) * smoothstep(d / c.radius)); }
    let h = base + hills.amplitude * relief(wx / hills.scale, wy / hills.scale) * f;
    if (rim) {
      const [bx0, by0, bx1, by1] = rim.box;
      const out = Math.max(bx0 - x, x - bx1, by0 - y, y - by1);           // > 0 outside the playable box
      if (out > -rim.width * 0.15) {
        const t = smoothstep((out + rim.width * 0.15) / rim.width);
        h += t * rim.height * (0.65 + 0.35 * rimNoise(wx / rim.scale, wy / rim.scale)) + t * t * rim.height * 0.4;
      }
    }
    H[j * nx + i] = h;
  }
  const er = { droplets: 30000, strength: 1, thermal: 20, talus: 35, ...(opts.erosion || {}) };
  if (er.droplets > 0) hydraulic(H, nx, ny, er, seed);
  if (er.thermal > 0) thermal(H, nx, ny, er.thermal, Math.tan((er.talus * Math.PI) / 180) * 2);
  for (const fl of opts.flats || []) {
    const blend = fl.blend ?? 12, gx = fl.x / 2 - cx0, gy = fl.y / 2 - cy0;
    const target = fl.height ?? H[Math.round(Math.max(0, Math.min(ny - 1, gy))) * nx + Math.round(Math.max(0, Math.min(nx - 1, gx)))];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const d = Math.hypot((i - gx) * 2, (j - gy) * 2);
      if (d > fl.r + blend) continue;
      const w = d <= fl.r ? 1 : 1 - smoothstep((d - fl.r) / blend);
      H[j * nx + i] += (target - H[j * nx + i]) * w;
    }
  }
  // blend into the old ground at the area border (when the area is not the whole map)
  const blend = opts.blend ?? (opts.area ? 20 : 0);
  const keys = new Set();
  let changed = 0, lo = Infinity, hi = -Infinity;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = (cx0 + i) * 2, y = (cy0 + j) * 2;
    const edge = Math.min(x - ax0, ax1 - x, y - ay0, ay1 - y);
    const w = blend > 0 ? smoothstep(edge / blend) : 1;
    const v = old[j * nx + i] + (H[j * nx + i] - old[j * nx + i]) * w;
    lo = Math.min(lo, v); hi = Math.max(hi, v);
    if (Math.abs(v - old[j * nx + i]) > 0.003) { model.setRaw(cx0 + i, cy0 + j, v * 200, keys); changed++; }
  }
  return { keys, parts: new Set(changed ? ["height"] : []), stats: { cells: N, changed, min: +lo.toFixed(2), max: +hi.toFixed(2), base: +base.toFixed(2) } };
}

// Droplet erosion (after S. Lague): water picks up sediment on steep fast flow and drops it where it slows, carving
// gullies and smoothing slopes. Runs on normalised heights so parameters behave the same for any relief.
function hydraulic(H, nx, ny, er, seed) {
  let lo = Infinity, hi = -Infinity;
  for (const v of H) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const range = hi - lo || 1;
  const h = Float64Array.from(H, (v) => (v - lo) / range);
  const r = rng(seed + 991);
  const P = { inertia: 0.05, capacity: 4, minCapacity: 0.01, erode: 0.3 * er.strength, deposit: 0.3, evaporate: 0.01, gravity: 4, life: 30, radius: 3 };
  // brush offsets and weights
  const brush = [];
  let wsum = 0;
  for (let y = -P.radius; y <= P.radius; y++) for (let x = -P.radius; x <= P.radius; x++) { const d = Math.hypot(x, y); if (d < P.radius) { const w = 1 - d / P.radius; brush.push([x, y, w]); wsum += w; } }
  for (const b of brush) b[2] /= wsum;
  const at = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, k = iy * nx + ix;
    const a = h[k], b = h[k + 1], c = h[k + nx], d = h[k + nx + 1];
    return { h: a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy, gx: (b - a) * (1 - fy) + (d - c) * fy, gy: (c - a) * (1 - fx) + (d - b) * fx };
  };
  for (let n = 0; n < er.droplets; n++) {
    let x = r() * (nx - 2), y = r() * (ny - 2), dx = 0, dy = 0, speed = 1, water = 1, sediment = 0;
    for (let life = 0; life < P.life; life++) {
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, k = iy * nx + ix;
      const g = at(x, y);
      dx = dx * P.inertia - g.gx * (1 - P.inertia); dy = dy * P.inertia - g.gy * (1 - P.inertia);
      const len = Math.hypot(dx, dy);
      if (len === 0) break;
      dx /= len; dy /= len; x += dx; y += dy;
      if (x < 0 || y < 0 || x >= nx - 1 || y >= ny - 1) break;
      const dh = at(x, y).h - g.h;
      const cap = Math.max(-dh * speed * water * P.capacity, P.minCapacity);
      if (sediment > cap || dh > 0) {
        const amt = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * P.deposit;
        sediment -= amt;
        h[k] += amt * (1 - fx) * (1 - fy); h[k + 1] += amt * fx * (1 - fy); h[k + nx] += amt * (1 - fx) * fy; h[k + nx + 1] += amt * fx * fy;
      } else {
        const amt = Math.min((cap - sediment) * P.erode, -dh);
        for (const [bx, by, w] of brush) {
          const tx = ix + bx, ty = iy + by;
          if (tx < 0 || ty < 0 || tx >= nx || ty >= ny) continue;
          const t = ty * nx + tx, d = Math.min(h[t], amt * w);
          h[t] -= d; sediment += d;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * P.gravity));
      water *= 1 - P.evaporate;
    }
  }
  for (let i = 0; i < H.length; i++) H[i] = lo + h[i] * range;
}

// Thermal erosion: material slides down where a slope is steeper than the talus angle (maxDiff m per 2 m cell).
function thermal(H, nx, ny, iterations, maxDiff) {
  const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let it = 0; it < iterations; it++) {
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      for (const [dx, dy] of nb) {
        const t = (j + dy) * nx + i + dx, diff = H[k] - H[t];
        if (diff > maxDiff) { const m = (diff - maxDiff) * 0.25; H[k] -= m; H[t] += m; }
      }
    }
  }
}
