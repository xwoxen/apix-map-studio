// Seeded 2D gradient noise, fBm and ridged fBm. Values roughly in -1..1. Shared by terrain, texturing and scatter.

export function rng(seed) {
  let s = (Math.floor(seed) % 2147483647 + 2147483647) % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function noise2(seed = 1) {
  const r = rng(seed * 9973 + 17), perm = new Uint16Array(512), p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const G = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const dot = (h, x, y) => { const g = G[h & 7]; return g[0] * x + g[1] * y; };
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1], ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
    const u = fade(xf), v = fade(yf);
    const x1 = dot(aa, xf, yf) + u * (dot(ba, xf - 1, yf) - dot(aa, xf, yf));
    const x2 = dot(ab, xf, yf - 1) + u * (dot(bb, xf - 1, yf - 1) - dot(ab, xf, yf - 1));
    return (x1 + v * (x2 - x1)) * 1.414;
  };
}

// fractal sum; ridged = 1 gives sharp crests (mountains), 0 rolling hills
export function fbm(seed, { octaves = 5, lacunarity = 2, gain = 0.5, ridged = 0 } = {}) {
  const layers = Array.from({ length: octaves }, (_, i) => noise2(seed + i * 101));
  return (x, y) => {
    let a = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = layers[i](x * f, y * f);
      const v = ridged ? (1 - Math.abs(n)) * 2 - 1 : n;
      sum += (ridged ? v * ridged + n * (1 - ridged) : n) * a;
      norm += a; a *= gain; f *= lacunarity;
    }
    return sum / norm;
  };
}

export const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// distance from a point to a polyline (m)
export function polylineDistance(pts, x, y) {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
}
