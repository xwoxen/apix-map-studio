// apix_farm_01c: farm map kitbashed from official maps instead of generated terrain. Each zone is a 256 m meadow
// pocket cut out of a real map (terrain, textures, attributes, water, the designers' objects), turned so its natural
// exit faces the hub, height-matched by its floor. Wooded blocked ridges hide the seams, roads cut passes from the hub,
// the hub town takes the building composition of the metin2_map_a1 village. Runs inside Map Studio:
//   node apix-map-studio/test/run-eval.js <map dir> build.js <out dir> --inplace
(async () => {
  const s = window.__studio, api = s.api, M = s.model, log = [];
  const t0 = performance.now();
  const step = (m) => { log.push(`${((performance.now() - t0) / 1000).toFixed(1)}s ${m}`); window.studio.exportWrite("C:/Users/micha/Documents/we_remix_v59__20260716-1745/apix_farm_01c", [{ rel: "_export/build-progress.txt", text: log.join("\r\n") }]); };
  step("start");
  const st = await api("status");
  if (st.map !== "apix_farm_01c") throw new Error("wrong map " + st.map);
  const SEED = 5151, HUB = { x: 256, y: 256, r: 42, h: 171 };
  const GRASS = "d:/ymir work/terrainmaps/a/grass/grass 01.dds", PATH = "d:/ymir work/terrainmaps/a/field/field 02.dds", PAVE = "d:/ymir work/terrainmaps/12temple/stone_tile_001.dds";
  const RIDGE = "d:/ymir work/terrainmaps/a/grass/grass 02.dds", ROCK = "d:/ymir work/terrainmaps/a/stone/stone01.dds";
  // zone templates (find_pockets.js, exits.js, floors.js): source window, quadrant, clockwise turns, source floor height
  const ZONES = {
    1: { src: "metin2_map_a3", area: [192, 736, 448, 992], to: [0, 256], rotate: 0, floor: 125.9, lv: "40-45", metin: [8008, 8008, 8008, 8009, 8009], groups: [610, 611, 613, 615, 653, 654, 655, 610], type: "g", respawn: 60 },
    2: { src: "metin2_map_b3", area: [96, 672, 352, 928], to: [256, 256], rotate: 3, floor: 190.1, lv: "45-50", metin: [8009, 8009, 8009, 8010, 8010], groups: [5023, 617, 6066, 616, 656, 657, 2004, 2006], type: "g", respawn: 80 },
    3: { src: "metin2_map_milgyo", area: [32, 736, 288, 992], to: [256, 0], rotate: 0, floor: 39.7, lv: "50-55", metin: [8010, 8010, 8010, 8011, 8011], groups: [714, 715, 717, 718, 719, 720, 2008, 2013], type: "ga", respawn: 100 },
    4: { src: "metin2_map_mt_thunder", area: [32, 32, 288, 288], to: [0, 0], rotate: 0, floor: 260.4, lv: "55-60", metin: [8011, 8011, 8011, 8012, 8012], groups: [2369, 2372, 2374, 724, 725, 1001, 1003, 1005], type: "ga", respawn: 120 },
  };
  const FLOOR = { 1: 170, 2: 172, 3: 174, 4: 176 };
  const TOWN_SRC = { src: "metin2_map_a1", area: [580, 410, 690, 520] };
  const disc = (cx, cy, r, st = 1) => { const o = []; for (let y = -r; y <= r; y += st) for (let x = -r; x <= r; x += st) if (x * x + y * y <= r * r) o.push([cx + x, cy + y]); return o; };
  const polyDist = (pts, x, y) => { let b = Infinity; for (let i = 0; i + 1 < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)); b = Math.min(b, Math.hypot(ax + t * dx - x, ay + t * dy - y)); } return b; };
  let rs = SEED; const rnd = () => ((rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296);

  // 0) clean slate: objects, spawns, water, attributes, flat ground, one texture
  const objs = (await api("list_objects", { limit: 100000 })).objects.map((o) => o.id);
  if (objs.length) await api("delete_objects", { ids: objs });
  const sp = (await api("list_spawns")).spawns.map((x) => x.id);
  if (sp.length) await api("delete_spawns", { ids: sp });
  const all = []; for (let y = 1; y < 512; y += 2) for (let x = 1; x < 512; x += 2) all.push([x, y]);
  await api("paint", { tool: "water", points: all, radius: 1.5, invert: true });
  await api("paint", { tool: "attr", attr: { block: true, water: true, banpk: true }, points: all, radius: 1.6, invert: true });
  await api("terrain_generate", { base: 170, hills: { amplitude: 0 }, erosion: { droplets: 0, thermal: 0 } });
  await api("auto_texture", { rules: [{ texture: GRASS }] });
  step("cleared");

  // 1) zone templates
  const imp = {};
  for (const [z, Z] of Object.entries(ZONES)) {
    const r = await api("import_region", { source: Z.src, area: Z.area, to: Z.to, rotate: Z.rotate, blend: 16, heightOffset: +(FLOOR[z] - Z.floor).toFixed(2), seed: SEED + +z });
    imp[z] = { objects: r.objects, skipped: r.skipped, textures: r.texturesPerTerrain };
  }
  step("imports " + JSON.stringify(imp));

  // 2) ridges: the cross between the quadrants (stops short of the hub) and the outer rim
  const wobble = (pts, amp) => pts.map(([x, y], i) => (i === 0 || i === pts.length - 1 ? [x, y] : [x + (rnd() - 0.5) * 2 * amp, y + (rnd() - 0.5) * 2 * amp]));
  const line = (x0, y0, x1, y1, n) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  const ARMS = [line(256, -10, 256, 192, 7), line(256, 522, 256, 320, 7), line(-10, 256, 192, 256, 7), line(522, 256, 320, 256, 7)].map((p) => wobble(p, 7));
  const RIM = wobble([[10, 10], [130, 6], [256, 12], [380, 6], [502, 10], [506, 130], [500, 256], [506, 380], [502, 502], [380, 506], [256, 500], [130, 506], [10, 502], [6, 380], [12, 256], [6, 130], [10, 10]], 4);
  RIM[RIM.length - 1] = RIM[0];
  for (let i = 0; i < ARMS.length; i++) await api("spline", { kind: "ridge", points: ARMS[i], width: 30, edge: 26, height: 13, texture: RIDGE, steepTexture: ROCK, seed: SEED + 20 + i });
  await api("spline", { kind: "ridge", points: RIM, width: 26, edge: 22, height: 15, texture: RIDGE, steepTexture: ROCK, seed: SEED + 30 });
  step("ridges");

  // 3) hub clearing
  await api("terrain_generate", { area: [180, 180, 332, 332], mode: "add", hills: { amplitude: 0 }, flats: [{ x: HUB.x, y: HUB.y, r: HUB.r, blend: 22, height: HUB.h }], blend: 0 });
  await api("paint", { tool: "attr", attr: { block: true, water: true }, points: disc(HUB.x, HUB.y, HUB.r + 14, 1), radius: 1, invert: true });
  await api("paint", { tool: "texture", texture: GRASS, points: disc(HUB.x, HUB.y, HUB.r + 10, 1), radius: 1 });
  await api("paint", { tool: "texture", texture: PAVE, points: disc(HUB.x, HUB.y, 26, 1), radius: 1 });
  step("hub");

  // 4) roads hub -> each zone: the walkable cell beyond the ridge nearest to the hub, then on into the pocket
  const walk = (x, y) => x > 2 && y > 2 && x < 510 && y < 510 && !(M.attr(Math.floor(x), Math.floor(y)) & 3);
  const ROADS = {};
  // largest walkable patch of a quadrant (4-connected, 1 m): the road must lead into it, not onto a strip cut off by water
  const largest = (qx, qy) => {
    const lab = new Int32Array(256 * 256).fill(-1), sizes = [];
    for (let k0 = 0; k0 < 256 * 256; k0++) {
      if (lab[k0] >= 0 || !walk(qx + (k0 % 256) + 0.5, qy + ((k0 / 256) | 0) + 0.5)) continue;
      const id = sizes.length, q = [k0]; lab[k0] = id;
      for (let h = 0; h < q.length; h++) { const x = q[h] % 256, y = (q[h] / 256) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = ny * 256 + nx; if (nx < 0 || ny < 0 || nx > 255 || ny > 255 || lab[k] >= 0 || !walk(qx + nx + 0.5, qy + ny + 0.5)) continue; lab[k] = id; q.push(k); } }
      sizes.push(q.length);
    }
    const big = sizes.indexOf(Math.max(...sizes));
    return (x, y) => { const lx = Math.floor(x - qx), ly = Math.floor(y - qy); return lx >= 0 && ly >= 0 && lx < 256 && ly < 256 && lab[ly * 256 + lx] === big; };
  };
  for (const [z, Z] of Object.entries(ZONES)) {
    const [qx, qy] = Z.to, cx = qx + 128, cy = qy + 128, inBig = largest(qx, qy);
    let best = null;
    for (let y = qy + 8; y < qy + 248; y += 4) for (let x = qx + 8; x < qx + 248; x += 4) {
      if (Math.abs(x - 256) < 42 || Math.abs(y - 256) < 42) continue;           // beyond the ridge
      let ok = true; for (let a = 0; a < 6.283 && ok; a += 0.785) ok = walk(x + Math.cos(a) * 7, y + Math.sin(a) * 7);
      if (!ok || !inBig(x, y)) continue;
      const d = Math.hypot(x - HUB.x, y - HUB.y);
      if (!best || d < best.d) best = { x, y, d };
    }
    if (!best) { step(`zone ${z}: no entry`); continue; }
    const ux = (cx - best.x), uy = (cy - best.y), ul = Math.hypot(ux, uy) || 1;
    const start = [HUB.x + ((best.x - HUB.x) / best.d) * (HUB.r - 6), HUB.y + ((best.y - HUB.y) / best.d) * (HUB.r - 6)];
    const mid = [(start[0] + best.x) / 2 + (rnd() - 0.5) * 8, (start[1] + best.y) / 2 + (rnd() - 0.5) * 8];
    ROADS[z] = [start, mid, [best.x, best.y], [best.x + (ux / ul) * 18, best.y + (uy / ul) * 18]];
    await api("spline", { kind: "road", points: ROADS[z], width: 6, edge: 9, maxGrade: 0.16, smooth: 16, seed: SEED + 40 + +z, texture: PATH });
    const pts = []; for (const [x, y] of disc(0, 0, 5, 1)) for (let i = 0; i <= 60; i++) { const t = i / 60, k = Math.min(2, Math.floor(t * 3)), f = t * 3 - k, [ax, ay] = ROADS[z][k], [bx, by] = ROADS[z][k + 1]; pts.push([ax + (bx - ax) * f + x, ay + (by - ay) * f + y]); }
    await api("paint", { tool: "attr", attr: { block: true, water: true }, points: pts, radius: 1, invert: true });
  }
  step("roads " + JSON.stringify(ROADS));

  // 5) attributes: hub no-PvP; steep slopes blocked where the templates left them open (ridge flanks)
  await api("paint", { tool: "attr", attr: { banpk: true }, points: disc(HUB.x, HUB.y, HUB.r + 6, 2), radius: 1.6 });
  const steep = [];
  for (let y = 0.5; y < 512; y += 1) for (let x = 0.5; x < 512; x += 1) {
    if (Object.values(ROADS).some((r) => polyDist(r, x, y) < 6) || Math.hypot(x - HUB.x, y - HUB.y) < HUB.r + 12) continue;
    const gx = (M.at(x + 1, y) - M.at(x - 1, y)) / 2, gy = (M.at(x, y + 1) - M.at(x, y - 1)) / 2;
    if (Math.atan(Math.hypot(gx, gy)) * 57.3 > 38 && walk(x, y)) steep.push([x, y]);
  }
  for (let i = 0; i < steep.length; i += 40000) await api("paint", { tool: "attr", attr: { block: true }, points: steep.slice(i, i + 40000), radius: 0.5 });
  step("steep cells blocked " + steep.length);

  // 6) objects: clear the hub and the road corridors, town from the a1 village, forest on the ridges
  let list = (await api("list_objects", { limit: 100000 })).objects;
  const del = list.filter((o) => Math.hypot(o.x - HUB.x, o.y - HUB.y) < HUB.r + 14 || Object.values(ROADS).some((r) => polyDist(r, o.x, o.y) < 6)).map((o) => o.id);
  if (del.length) await api("delete_objects", { ids: del });
  const town = await api("import_region", { source: TOWN_SRC.src, area: TOWN_SRC.area, to: [HUB.x - 55, HUB.y - 55], rotate: 0, blend: 2, parts: { heights: false, textures: false, attributes: false, water: false, objects: true } });
  // keep the town compact: drop what landed outside the clearing
  list = (await api("list_objects", { limit: 100000 })).objects;
  const outTown = list.filter((o) => town.ids.includes(o.id) && (Math.hypot(o.x - HUB.x, o.y - HUB.y) > HUB.r + 4 || Object.values(ROADS).some((r) => polyDist(r, o.x, o.y) < 7))).map((o) => o.id);
  if (outTown.length) await api("delete_objects", { ids: outTown });
  step(`objects: removed ${del.length} from hub/roads, town ${town.objects - outTown.length} (${outTown.length} outside dropped)`);
  const cat = async (q) => (await api("catalog", { ...q, usable: true, source: "client", limit: 400 })).items;
  const byName = async (n) => { const it = (await cat({ query: n })).find((e) => e.name.toLowerCase() === n.toLowerCase()); if (!it) throw new Error("not usable: " + n); return it.crc; };
  const C = {};
  for (const n of ["treescotchpineforest4", "treescotchpineforest5", "treedeodar", "MontereyCypress4", "CedarOfLebanon1", "Beech3", "RedOak1", "plant_bush", "plant_bush2"]) C[n] = await byName(n);
  const stones = (await cat({ query: "general_obj_stone" })).filter((e) => /^general_obj_stone\d+$/.test(e.name) && e.folder === "13").map((e) => ({ crc: e.crc }));
  const it = (...names) => names.map((n) => ({ crc: C[n] }));
  const res = {};
  const lines = Object.values(ROADS).map((points) => ({ points, radius: 6 }));
  const bands = [[220, 0, 292, 206], [220, 306, 292, 512], [0, 220, 206, 292], [306, 220, 512, 292], [0, 0, 512, 40], [0, 472, 512, 512], [0, 40, 40, 472], [472, 40, 512, 472]];
  for (let i = 0; i < bands.length; i++) {
    const r = await api("scatter", { seed: SEED + 60 + i, area: bands[i], avoidBlocked: false, avoidLines: lines, avoid: [{ x: HUB.x, y: HUB.y, r: HUB.r + 10 }], layers: [
      { name: "forest", items: it("treescotchpineforest4", "treescotchpineforest5", "treedeodar", "MontereyCypress4", "CedarOfLebanon1", "Beech3", "RedOak1"), density: 34, cluster: { radius: 14, size: 7 }, spacing: 6, blocked: "only", slope: [0, 45] },
      { name: "under", items: it("plant_bush", "plant_bush2"), near: { layer: "forest", radius: 7, chance: 0.4 }, blocked: "only", clearance: 0.5 },
      { name: "cliff", items: stones, density: 6, blocked: "only", slope: [26, 80], sink: 0.35, maxGroundRange: 8, clearance: 0.5 }] });
    res["band" + i] = Object.fromEntries(Object.entries(r.stats).map(([k, v]) => [k, v.placed]));
  }
  step("ridge forest " + JSON.stringify(res));

  // 7) metin plazas and monster groups: flat, walkable, clear of objects, roads and the hub
  list = (await api("list_objects", { limit: 100000 })).objects;
  const G = 8, grid = new Map();
  for (const o of list) { const k = `${Math.floor(o.x / G)},${Math.floor(o.y / G)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(o); }
  const objNear = (x, y, r) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) for (const o of grid.get(`${Math.floor(x / G) + dx},${Math.floor(y / G) + dy}`) || []) if (Math.hypot(o.x - x, o.y - y) < r) return true; return false; };
  const rough = (x, y, r) => { let lo = Infinity, hi = -Infinity; for (let a = 0; a < 6.283; a += 0.785) for (const d of [r * 0.5, r]) { const h = M.at(x + Math.cos(a) * d, y + Math.sin(a) * d); lo = Math.min(lo, h); hi = Math.max(hi, h); } return hi - lo; };
  const open = (x, y, r) => { for (let a = 0; a < 6.283; a += 0.785) for (const d of [r * 0.5, r]) if (!walk(x + Math.cos(a) * d, y + Math.sin(a) * d)) return false; return walk(x, y); };
  const roadD = (x, y) => Math.min(...Object.values(ROADS).map((r) => polyDist(r, x, y)));
  const seen = new Uint8Array(512 * 512), q = [HUB.y * 512 + HUB.x];
  seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) { const x = q[h] % 512, y = (q[h] / 512) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = ny * 512 + nx; if (nx < 0 || ny < 0 || nx > 511 || ny > 511 || seen[k] || !walk(nx + 0.5, ny + 0.5)) continue; seen[k] = 1; q.push(k); } }
  const reach = (x, y) => !!seen[Math.floor(y) * 512 + Math.floor(x)];
  const metins = [], groups = [];
  for (const [z, Z] of Object.entries(ZONES)) {
    const [qx, qy] = Z.to, cands = [];
    for (let y = qy + 16; y <= qy + 240; y += 4) for (let x = qx + 16; x <= qx + 240; x += 4) {
      if (Math.hypot(x - HUB.x, y - HUB.y) < 70 || roadD(x, y) < 10 || !reach(x, y) || !open(x, y, 9)) continue;
      cands.push({ x, y, r: rough(x, y, 9), clear: !objNear(x, y, 7) });
    }
    cands.sort((a, b) => a.r - b.r);
    for (const c of cands) { if (metins.filter((m) => m.zone == z).length >= 5) break; if (c.clear && c.r < 3 && metins.every((m) => Math.hypot(m.x - c.x, m.y - c.y) > 36)) metins.push({ zone: +z, x: c.x, y: c.y, rough: +c.r.toFixed(2) }); }
    for (const c of cands.slice().sort(() => rnd() - 0.5)) {
      if (groups.filter((m) => m.zone == z).length >= 8) break;
      if (c.r > 5 || metins.some((m) => Math.hypot(m.x - c.x, m.y - c.y) < 18) || groups.some((m) => Math.hypot(m.x - c.x, m.y - c.y) < 24)) continue;
      groups.push({ zone: +z, x: c.x, y: c.y });
    }
  }
  step(`metins ${metins.length} groups ${groups.length}`);

  // 8) spawns, town, environment
  const items = [];
  for (const [vnum, x, y] of [[9012, 250, 246], [9003, 264, 252], [9005, 248, 262]]) items.push({ type: "npc", vnum, x, y, radius: 1, count: 1, respawn: 120 });
  for (const [z, Z] of Object.entries(ZONES)) {
    metins.filter((m) => m.zone == z).forEach((m, i) => items.push({ type: "m", vnum: Z.metin[i], x: m.x, y: m.y, radius: 2, count: 1, respawn: 600 + 75 * (z - 1) }));
    groups.filter((m) => m.zone == z).forEach((m, i) => items.push({ type: Z.type, vnum: Z.groups[i], x: m.x, y: m.y, radius: 5, count: 1, respawn: Z.respawn }));
  }
  await api("add_spawns", { items });
  // every spawn reachable on foot from the town (attribute grid, 1 m)
  const unreachable = items.filter((i) => !reach(i.x, i.y)).map((i) => `${i.type}${i.vnum}@${i.x},${i.y}`);
  step(`reachable area ${(q.length / 10000).toFixed(1)} ha, unreachable spawns ${unreachable.length} ${unreachable.join(" ")}`);
  await api("set_town", { x: HUB.x, y: HUB.y });
  await api("set_environment", { name: "guild_village.msenv" });
  await api("save");
  const fin = await api("status");
  step("saved, spawns " + items.length + ", objects " + fin.objects);

  const shot = async (cam) => (await api("screenshot", cam)).png;
  const shots = {
    top: await shot({ x: 256, y: 256, distance: 470, yaw: 0, pitch: 89 }),
    overview: await shot({ x: 256, y: 300, distance: 330, yaw: 0, pitch: 40 }),
    hub: await shot({ x: 256, y: 262, distance: 60, yaw: 200, pitch: 22 }),
    z1: await shot({ x: 110, y: 390, distance: 80, yaw: 30, pitch: 22 }),
    z2: await shot({ x: 400, y: 390, distance: 80, yaw: 330, pitch: 22 }),
    z3: await shot({ x: 390, y: 130, distance: 90, yaw: 200, pitch: 24 }),
    z4: await shot({ x: 120, y: 120, distance: 80, yaw: 160, pitch: 22 }),
  };
  return { log, unreachable, imports: imp, roads: ROADS, metins, groups, objects: fin.objects, shots };
})();
