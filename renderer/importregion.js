// Region import: copies terrain, textures, attributes, water and objects of a rectangle of another map (official client
// maps or WorldEditor maps) into the open map, rotated in 90 degree steps, height-matched to the destination border and
// blended into it over a soft, noise-broken edge. Objects come with their height above the source ground.
import { fbm, smoothstep } from "./noise.js";

// rotate clockwise (seen from above, x east, y south) by k * 90 degrees: region-local (u, v) in a w x h rect
export function rotator(k, w, h) {
  k = ((k % 4) + 4) % 4;
  const W = k % 2 ? h : w, H = k % 2 ? w : h;
  const fwd = [(u, v) => [u, v], (u, v) => [h - v, u], (u, v) => [w - u, h - v], (u, v) => [v, w - u]][k];   // source -> dest
  const inv = [(a, b) => [a, b], (a, b) => [b, h - a], (a, b) => [w - a, h - b], (a, b) => [w - b, a]][k];   // dest -> source
  return { k, W, H, fwd, inv, yaw: -90 * k };
}

/**
 * model: TerrainModel; region: readRegion() result; opts: { to: [x, y] dest top-left m, rotate 0..3 (x 90 deg clockwise),
 *   blend m (16), heightOffset: "match" | number (m), parts: { heights, textures, attributes, water, objects } (all true),
 *   textureIndex(file) -> dest index (async resolved before), seed }
 * returns { keys, parts, offset, objects: [{ crc, x, y, lift, yaw }] (dest metres), area: [x0, y0, x1, y1] }
 */
export function importRegion(model, region, opts) {
  const R = rotator(opts.rotate || 0, region.w, region.h);
  const [tx, ty] = opts.to.map((v) => Math.round(v / 2) * 2);
  const blend = opts.blend ?? 16, parts = { heights: true, textures: true, attributes: true, water: true, objects: true, ...(opts.parts || {}) };
  const keys = new Set(), changed = new Set();
  const nw = region.w / 2 + 1;
  const srcH = (u, v) => {                         // bilinear source height at region-local metres
    const cx = Math.max(0, Math.min(region.w / 2 - 1e-6, u / 2)), cy = Math.max(0, Math.min(region.h / 2 - 1e-6, v / 2));
    const x0 = Math.floor(cx), y0 = Math.floor(cy), fx = cx - x0, fy = cy - y0, H = region.heights;
    return H[y0 * nw + x0] * (1 - fx) * (1 - fy) + H[y0 * nw + x0 + 1] * fx * (1 - fy) + H[(y0 + 1) * nw + x0] * (1 - fx) * fy + H[(y0 + 1) * nw + x0 + 1] * fx * fy;
  };
  const jag = fbm(opts.seed ?? 5, { octaves: 3 });
  // weight of the source at dest-local (a, b): 1 inside, soft noisy falloff over the blend band at the rectangle edge
  const weight = (a, b) => {
    if (blend <= 0) return a >= 0 && b >= 0 && a <= R.W && b <= R.H ? 1 : 0;
    const e = Math.min(a, b, R.W - a, R.H - b) + jag((tx + a) / 30, (ty + b) / 30) * blend * 0.35;
    return smoothstep(e / blend);
  };
  // height offset: match the mean height along the destination border to the source border
  let offset = typeof opts.heightOffset === "number" ? opts.heightOffset : 0;
  if (opts.heightOffset === undefined || opts.heightOffset === "match") {
    let sd = 0, ss = 0, n = 0;
    for (let s = 0; s <= 1; s += 0.02) for (const [a, b] of [[s * R.W, 0], [s * R.W, R.H], [0, s * R.H], [R.W, s * R.H]]) {
      const [u, v] = R.inv(a, b);
      sd += model.at(tx + a, ty + b); ss += srcH(u, v); n++;
    }
    offset = (sd - ss) / n;
  }
  // 1) heights on 2 m nodes
  if (parts.heights) {
    for (let cy = ty / 2; cy <= (ty + R.H) / 2; cy++) for (let cx = tx / 2; cx <= (tx + R.W) / 2; cx++) {
      if (cx < 0 || cy < 0 || cx > model.widthCells || cy > model.depthCells) continue;
      const a = cx * 2 - tx, b = cy * 2 - ty, w = weight(a, b);
      if (w <= 0) continue;
      const [u, v] = R.inv(a, b), old = model.raw(cx, cy) / 200, nv = old + (srcH(u, v) + offset - old) * w;
      if (Math.abs(nv - old) > 0.003) model.setRaw(cx, cy, nv * 200, keys);
    }
    changed.add("height");
  }
  // 2) textures and attributes on 1 m cells
  const tmap = opts.textureMap || {};
  for (let y = Math.max(0, ty); y < Math.min(model.depthCells * 2, ty + R.H); y++) for (let x = Math.max(0, tx); x < Math.min(model.widthCells * 2, tx + R.W); x++) {
    const a = x + 0.5 - tx, b = y + 0.5 - ty, w = weight(a, b);
    if (w <= 0) continue;
    const [u, v] = R.inv(a, b), su = Math.min(region.w - 1, Math.max(0, Math.floor(u))), sv = Math.min(region.h - 1, Math.max(0, Math.floor(v))), k = sv * region.w + su;
    const dither = (jag(x * 0.37, y * 0.37) + 1) / 2;                  // texture edge breaks up instead of a straight seam
    if (parts.textures && w > dither && tmap[region.tiles[k]] !== undefined) model.setTile(x, y, tmap[region.tiles[k]], keys);
    if (parts.attributes && w > 0.5) {
      const f = region.attrs[k], flags = opts.attrFlags;
      model.setAttr(x, y, flags.block | flags.water, true, keys);      // clear then copy block / water
      const set = (f & 1 ? flags.block : 0) | (f & 2 ? flags.water : 0);
      if (set) model.setAttr(x, y, set, false, keys);
    }
  }
  if (parts.textures) changed.add("tile");
  if (parts.attributes) changed.add("attr");
  // 3) water per 2 m cell (level shifted with the terrain)
  if (parts.water) {
    for (let cy = Math.max(0, ty / 2); cy < Math.min(model.depthCells, (ty + R.H) / 2); cy++) for (let cx = Math.max(0, tx / 2); cx < Math.min(model.widthCells, (tx + R.W) / 2); cx++) {
      const a = cx * 2 + 1 - tx, b = cy * 2 + 1 - ty;
      if (weight(a, b) <= 0.5) continue;
      const [u, v] = R.inv(a, b), su = Math.min(region.w / 2 - 1, Math.max(0, Math.floor(u / 2))), sv = Math.min(region.h / 2 - 1, Math.max(0, Math.floor(v / 2)));
      const lv = region.water[sv * (region.w / 2) + su];
      if (model.setWater(cx, cy, lv === null ? null : Math.round(((lv + offset) * 4)) / 4 * 200)) changed.add("water");
    }
  }
  // 4) objects (dest metres, lift above ground kept); only where the source dominates
  const objects = [];
  if (parts.objects) for (const o of region.objects) {
    const [a, b] = R.fwd(o.x, o.y);
    if (weight(a, b) < 0.6) continue;
    objects.push({ crc: o.crc, x: tx + a, y: ty + b, lift: o.lift, yaw: ((o.yaw + R.yaw) % 360 + 360) % 360 });
  }
  return { keys, parts: changed, offset: +offset.toFixed(2), objects, area: [tx, ty, tx + R.W, ty + R.H] };
}
