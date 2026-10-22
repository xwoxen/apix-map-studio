// Walkability on the 1 m attribute grid: what a player can reach on foot from a point (the town), the walkable
// patches, and the distance of every cell to the nearest walkable one (for framing valleys with forest).
// Walkable = neither block nor water attribute. Positions are scene metres (x east, y = map y south).

const BLOCK = 1, WATER = 2;

export function walkGrid(model, flags = BLOCK | WATER) {
  const W = model.widthCells * 2, H = model.depthCells * 2, g = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = model.attr(x, y) & flags ? 0 : 1;
  return { W, H, g };
}

// flood fill from a point; returns the reached cells (1 = reached) and their count
export function reachable(model, from, flags) {
  const { W, H, g } = walkGrid(model, flags);
  const seen = new Uint8Array(W * H), sx = Math.floor(from.x), sy = Math.floor(from.y);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H || !g[sy * W + sx]) return { W, H, seen, count: 0, walkable: g.reduce((a, b) => a + b, 0) };
  const q = new Int32Array(W * H);
  let head = 0, tail = 0;
  q[tail++] = sy * W + sx; seen[sy * W + sx] = 1;
  while (head < tail) {
    const k = q[head++], x = k % W, y = (k / W) | 0;
    if (x > 0 && !seen[k - 1] && g[k - 1]) { seen[k - 1] = 1; q[tail++] = k - 1; }
    if (x < W - 1 && !seen[k + 1] && g[k + 1]) { seen[k + 1] = 1; q[tail++] = k + 1; }
    if (y > 0 && !seen[k - W] && g[k - W]) { seen[k - W] = 1; q[tail++] = k - W; }
    if (y < H - 1 && !seen[k + W] && g[k + W]) { seen[k + W] = 1; q[tail++] = k + W; }
  }
  return { W, H, seen, count: tail, walkable: g.reduce((a, b) => a + b, 0), at: (x, y) => x >= 0 && y >= 0 && x < W && y < H && seen[Math.floor(y) * W + Math.floor(x)] === 1 };
}

// sizes of the separate walkable patches (m², largest first)
export function patches(model, flags) {
  const { W, H, g } = walkGrid(model, flags);
  const lab = new Int32Array(W * H).fill(-1), sizes = [], q = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!g[s] || lab[s] >= 0) continue;
    const id = sizes.length; let head = 0, tail = 0; q[tail++] = s; lab[s] = id;
    while (head < tail) {
      const k = q[head++], x = k % W, y = (k / W) | 0;
      for (const n of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, y > 0 ? k - W : -1, y < H - 1 ? k + W : -1]) if (n >= 0 && g[n] && lab[n] < 0) { lab[n] = id; q[tail++] = n; }
    }
    sizes.push(tail);
  }
  return sizes.sort((a, b) => b - a);
}

// chamfer distance (m) of every cell to the nearest walkable cell (0 on walkable ground)
export function distanceToWalkable(model, flags) {
  const { W, H, g } = walkGrid(model, flags);
  const d = new Float32Array(W * H).fill(1e9), D = 1.4142;
  for (let k = 0; k < W * H; k++) if (g[k]) d[k] = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x; let v = d[k];
    if (x > 0) v = Math.min(v, d[k - 1] + 1);
    if (y > 0) { v = Math.min(v, d[k - W] + 1); if (x > 0) v = Math.min(v, d[k - W - 1] + D); if (x < W - 1) v = Math.min(v, d[k - W + 1] + D); }
    d[k] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const k = y * W + x; let v = d[k];
    if (x < W - 1) v = Math.min(v, d[k + 1] + 1);
    if (y < H - 1) { v = Math.min(v, d[k + W] + 1); if (x < W - 1) v = Math.min(v, d[k + W + 1] + D); if (x > 0) v = Math.min(v, d[k + W - 1] + D); }
    d[k] = v;
  }
  return { W, H, d, at: (x, y) => d[Math.max(0, Math.min(H - 1, Math.floor(y))) * W + Math.max(0, Math.min(W - 1, Math.floor(x)))] };
}
