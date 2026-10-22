// Yongan spawn square update (metin2_map_a1_live, editor copy of the live map). Runs in Map Studio:
//   node apix-map-studio/test/run-eval.js <map> namestie.js <out> --inplace          (DRY = true: plan + shots, no save)
// Adds only: a paved ring round the existing spawn circle (texture tile02 already in the map's set), lanterns along the
// three paths, two red lantern gates on the path mouths, benches, flower beds and a market stall. Nothing existing moves.
(async () => {
  const DRY = false;
  const s = window.__studio, api = s.api, M = s.model;
  const st = await api("status");
  if (st.map !== "metin2_map_a1_live") throw new Error("wrong map " + st.map);
  const S = { x: 597, y: 682 };                                        // spawn (Town.txt 597,682)
  const PAVE = "d:/ymir work/terrainmaps/b/tile/tile02.dds";
  const PATHS = new Set([1, 2, 3, 4]);                                  // field textures = trodden paths in Yongan
  const walk = (x, y) => !(M.attr(Math.floor(x), Math.floor(y)) & 3);
  const tex = (x, y) => M.tile(Math.floor(x), Math.floor(y));
  const slope = (x, y) => Math.atan(Math.hypot((M.at(x + 1, y) - M.at(x - 1, y)) / 2, (M.at(x, y + 1) - M.at(x, y - 1)) / 2)) * 57.3;
  const before = (await api("list_objects", { limit: 5000 })).objects;
  const taken = before.map((o) => ({ x: o.x, y: o.y, r: 2.5 }));
  const free = (x, y, r) => taken.every((t) => Math.hypot(t.x - x, t.y - y) >= r + t.r * 0.5);
  const okSpot = (x, y, r = 1.5) => walk(x, y) && slope(x, y) < 14 && [0, 1, 2, 3].every((k) => walk(x + Math.cos(k * 1.57) * r, y + Math.sin(k * 1.57) * r)) && free(x, y, r + 1);
  const plan = [];
  const add = (name, x, y, o = {}) => { plan.push({ name, x: +x.toFixed(2), y: +y.toFixed(2), ground: "min", ...o }); taken.push({ x, y, r: o.r || 2 }); };

  // 1) paved ring 7..11.5 m round the spawn circle, walkable flat ground only (not into the ravine)
  const ring = [];
  for (let y = -12; y <= 12; y += 1) for (let x = -12; x <= 12; x += 1) {
    const d = Math.hypot(x, y), px = S.x + x + 0.5, py = S.y + y + 0.5;
    if (d > 6.5 && d <= 11.5 && walk(px, py) && slope(px, py) < 12) ring.push([px, py]);
  }

  // 2) square furniture: tall lanterns on the diagonals, benches facing the spawn, flower beds between them
  for (const a of [45, 135, 225, 315]) {
    const x = S.x + Math.cos((a * Math.PI) / 180) * 12.5, y = S.y + Math.sin((a * Math.PI) / 180) * 12.5;
    if (okSpot(x, y)) add("a1_018-stonelight", x, y, { face: [S.x, S.y], r: 2 });
  }
  for (const a of [0, 90, 180, 270, 20, 160, 200, 340]) {
    if (plan.filter((p) => p.name === "general_obj_woodbed").length >= 3) break;
    const x = S.x + Math.cos((a * Math.PI) / 180) * 10, y = S.y + Math.sin((a * Math.PI) / 180) * 10;
    if (okSpot(x, y, 1.8)) add("general_obj_woodbed", x, y, { face: [S.x, S.y], r: 2.2 });
  }
  const flowers = ["Flowers_pink", "Flowers_yellow", "flowerrosa1", "Flowers_white"];
  let beds = 0;
  for (const a of [0, 90, 180, 270, 22, 68, 112, 158, 202, 248, 292, 338]) {
    if (beds >= 4) break;
    const cx = S.x + Math.cos((a * Math.PI) / 180) * 13.5, cy = S.y + Math.sin((a * Math.PI) / 180) * 13.5;
    if (!okSpot(cx, cy, 1.4) || PATHS.has(tex(cx, cy))) continue;
    for (let k = 0; k < 4; k++) add(flowers[(beds + k) % flowers.length], cx + Math.cos(k * 1.9) * 0.9, cy + Math.sin(k * 1.9) * 0.9, { yaw: k * 70, r: 0.6 });
    beds++;
  }

  // 3) market stall (before the path lanterns, so they keep clear of it) by the square: flat free spot 15..24 m east of the spawn, off the paths
  let stall = null;
  for (let r = 16; r <= 24 && !stall; r += 2) for (let a = -60; a <= 60 && !stall; a += 10) {
    const x = S.x + Math.cos((a * Math.PI) / 180) * r, y = S.y + Math.sin((a * Math.PI) / 180) * r;
    if (okSpot(x, y, 4.5) && !PATHS.has(tex(x, y))) stall = { x, y };
  }
  if (stall) {
    add("thing_market tent_01", stall.x, stall.y, { face: [S.x, S.y], r: 5 });
    const fx = (S.x - stall.x), fy = (S.y - stall.y), fl = Math.hypot(fx, fy), ux = fx / fl, uy = fy / fl;
    add("cart_shop", stall.x - uy * 5.5, stall.y + ux * 5.5, { face: [S.x, S.y], r: 3 });
    add("cart_shopbox01", stall.x + uy * 4.5 + ux * 1, stall.y - ux * 4.5 + uy * 1, { yaw: 20, r: 1.5 });
    add("general_obj_jar_red01", stall.x + ux * 2.5, stall.y + uy * 2.5, { yaw: 0, r: 0.6 });
    add("general_obj_drum", stall.x + ux * 2.5 + uy * 1.2, stall.y + uy * 2.5 - ux * 1.2, { yaw: 30, r: 0.6 });
  }

  // 4) lanterns along the paths: path-edge cells 21..46 m from the spawn (beyond the square), one every ~12 m
  const edges = [];
  for (let y = S.y - 45; y <= S.y + 45; y += 1) for (let x = S.x - 45; x <= S.x + 45; x += 1) {
    const d = Math.hypot(x - S.x, y - S.y);
    if (d < 21 || d > 46 || PATHS.has(tex(x, y)) || !walk(x, y)) continue;
    let nearPath = false;
    for (let k = 0; k < 8 && !nearPath; k++) { const px = x + Math.cos(k * 0.785) * 2.5, py = y + Math.sin(k * 0.785) * 2.5; nearPath = PATHS.has(tex(px, py)); }
    if (nearPath && okSpot(x, y)) edges.push({ x, y, d });
  }
  edges.sort((a, b) => a.d - b.d);
  const lamps = [];
  for (const e of edges) if (lamps.every((l) => Math.hypot(l.x - e.x, l.y - e.y) >= 12) && free(e.x, e.y, 3) && (!stall || Math.hypot(stall.x - e.x, stall.y - e.y) >= 10)) lamps.push(e);
  for (const l of lamps.slice(0, 9)) add("a1_018-stonelight-1", l.x + 0.5, l.y + 0.5, { face: [S.x, S.y], r: 2 });

  // 5) red lantern gates where the north-west and north-east paths reach the square (path cells at 16 m, facing the spawn)
  for (const dir of [-1, 1]) {
    let best = null;
    for (let a = -90 + dir * 25; Math.abs(a + 90) <= 70; a += dir * 3) {
      const x = S.x + Math.cos((a * Math.PI) / 180) * 16, y = S.y + Math.sin((a * Math.PI) / 180) * 16;
      if (PATHS.has(tex(x, y)) && walk(x, y)) { best = { x, y }; break; }
    }
    if (best) {
      const nx = (best.x - S.x) / 16, ny = (best.y - S.y) / 16;       // gate spans the path: posts left and right of it
      const posts = [-1, 1].map((side) => [best.x - ny * 3.2 * side, best.y + nx * 3.2 * side]);
      if (posts.every(([x, y]) => walk(x, y) && free(x, y, 1) && (!stall || Math.hypot(stall.x - x, stall.y - y) >= 8)))   // a gate needs both posts
        for (const [x, y] of posts) add("general_obj_lamp", x, y, { face: [S.x, S.y], r: 1.5 });
    }
  }

  const shot = async (cam) => (await api("screenshot", cam)).png;
  if (!DRY) {
    await api("paint", { tool: "texture", texture: PAVE, points: ring, radius: 0.8 });
    await api("add_objects", { items: plan });
    await api("save");
  }
  return { dry: DRY, before: before.length, after: (await api("status")).objects, ring: ring.length,
    plan: plan.map((p) => [p.name, p.x, p.y]), shots: DRY ? {} : {
      top: await shot({ x: 597, y: 675, distance: 90, yaw: 0, pitch: 89 }),
      square: await shot({ x: 597, y: 684, distance: 38, yaw: 0, pitch: 32 }),
      square_n: await shot({ x: 597, y: 676, distance: 38, yaw: 180, pitch: 32 }),
      stall: stall ? await shot({ x: stall.x, y: stall.y, distance: 22, yaw: 270, pitch: 25 }) : undefined,
      paths: await shot({ x: 600, y: 655, distance: 70, yaw: 180, pitch: 30 }),
    } };
})();
