// apix_farm_02 "Priesmyk Bieleho vlka": one snowy valley walked from the frozen village at the bottom (south-west) up
// along a mountain stream, over a small bridge, past the watch post, across the suspension bridge over the gorge,
// through the spruce wolf forest to the ice shrine on the crest, whose tower is seen from the village.
// Palette and densities from map_n_snowm_01 / sungzi_snow_pass, village from metin2_map_empirewar01.
//   node apix-map-studio/test/run-eval.js <map dir> build.js <out dir> --inplace
(async () => {
  const STAGE = "all";                                   // "terrain" stops after ground, water and textures
  const s = window.__studio, api = s.api, M = s.model, log = [];
  const t0 = performance.now();
  const step = (m) => { log.push(`${((performance.now() - t0) / 1000).toFixed(1)}s ${m}`); window.studio.exportWrite("C:/Users/micha/Documents/we_remix_v59__20260716-1745/apix_farm_02", [{ rel: "_export/build-progress.txt", text: log.join("\r\n") }]); };
  step("start " + STAGE);
  const st = await api("status");
  if (st.map !== "apix_farm_02") throw new Error("wrong map " + st.map);
  const SEED = 7171;
  const T = (n) => `d:/ymir work/terrainmaps/n/snow.m/${n}.dds`;
  const SNOW1 = T("snow01"), SNOW2 = T("snow02"), SNOW3 = T("snow03"), PATH = T("field 01"), ICE = T("ice_quest"), PAVE = T("tile04"), ROCK = T("stone01"), ROCK3 = T("stone03");

  // ---- design -----------------------------------------------------------------------------------------------------
  const V = { x: 130, y: 430 };                                            // village (spawn town)
  const B1 = { x: 228, y: 433, len: 29 }, B2 = { x: 325, y: 206, len: 39 }; // small bridge, suspension bridge (east-west)
  const R1 = [[118, 432], [150, 428], [180, 430], [B1.x - 15, 433]];
  const R2 = [[B1.x + 15, 433], [272, 440], [312, 444], [360, 434], [412, 412], [448, 370], [452, 330], [438, 292], [420, 262], [392, 228], [B2.x + 21, 206]];
  const R3 = [[B2.x - 21, 206], [278, 203], [236, 210], [196, 220], [158, 218], [122, 196], [112, 160], [128, 126], [168, 100], [222, 88], [268, 82], [300, 78]];
  // frozen stream: springs at the shrine, falls through the gorge under the suspension bridge, then winds down its own
  // little valley between the field and the watch post, under the small bridge and out south
  const STREAM = [[334, 56], [340, 96], [336, 136], [329, 172], [B2.x, B2.y], [323, 232], [318, 262], [300, 304], [276, 346], [250, 388], [B1.x, B1.y], [218, 474], [208, 516]];
  const GORGE = [[338, 128], [329, 172], [B2.x, B2.y], [323, 232], [319, 258]];
  const LOWER = STREAM.slice(6);
  const ZONES = {
    1: { name: "Brezové pole", c: [362, 432], r: 72, more: [[290, 452, 34], [430, 470, 26]], lv: "40-45", metin: [8008, 8008, 8008, 8009, 8009], groups: [610, 611, 613, 615, 653, 654, 655, 610], type: "g", respawn: 60 },
    2: { name: "Strážna hláska", c: [422, 270], r: 66, more: [[452, 340, 32], [400, 330, 26]], lv: "45-50", metin: [8009, 8009, 8009, 8010, 8010], groups: [5023, 617, 6066, 616, 656, 657, 2004, 2006], type: "g", respawn: 80 },
    3: { name: "Vlčí hvozd", c: [162, 226], r: 74, more: [[112, 296, 36], [214, 270, 28]], lv: "50-55", metin: [8010, 8010, 8010, 8011, 8011], groups: [714, 715, 717, 718, 719, 720, 2008, 2013], type: "ga", respawn: 100 },
    4: { name: "Ľadová svätyňa", c: [300, 78], r: 54, more: [[232, 96, 32], [196, 120, 24]], lv: "55-60", metin: [8011, 8011, 8011, 8012, 8012], groups: [2369, 2372, 2374, 724, 725, 1001, 1003, 1005], type: "ga", respawn: 120 },
  };
  const OPEN = [{ x: V.x, y: V.y, r: 50 }, ...Object.values(ZONES).flatMap((z) => [{ x: z.c[0], y: z.c[1], r: z.r }, ...z.more.map(([x, y, r]) => ({ x, y, r }))]),
    ...[R1, R2, R3].map((points) => ({ points, radius: 13 })), { points: [[B1.x - 16, B1.y], [B1.x + 16, B1.y]], radius: 6 }, { points: [[B2.x - 22, B2.y], [B2.x + 22, B2.y]], radius: 6 }, { points: LOWER, radius: 13 }];
  const ANCHORS = [{ x: V.x, y: V.y, h: 170 }, { x: B1.x, y: B1.y, h: 171 }, { x: 360, y: 434, h: 173 }, { x: 452, y: 350, h: 181 }, { x: 425, y: 268, h: 189 }, { x: 304, y: 330, h: 180 },
    { x: B2.x + 21, y: B2.y, h: 196 }, { x: B2.x - 21, y: B2.y, h: 196 }, { x: 160, y: 222, h: 202 }, { x: 118, y: 150, h: 209 }, { x: 300, y: 76, h: 221 }, { x: 236, y: 92, h: 216 }, { x: 250, y: 388, h: 172 }, { x: 208, y: 512, h: 166 }];
  const polyDist = (pts, x, y) => { let b = Infinity; for (let i = 0; i + 1 < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)); b = Math.min(b, Math.hypot(ax + t * dx - x, ay + t * dy - y)); } return b; };
  const outside = (x, y) => Math.min(...OPEN.map((o) => (o.points ? polyDist(o.points, x, y) - o.radius : Math.hypot(o.x - x, o.y - y) - o.r)));
  const disc = (cx, cy, r, st = 1) => { const o = []; for (let y = -r; y <= r; y += st) for (let x = -r; x <= r; x += st) if (x * x + y * y <= r * r) o.push([cx + x, cy + y]); return o; };
  const along = (pts, half, st = 1) => { const o = []; for (let i = 0; i + 1 < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / L, ny = (bx - ax) / L; for (let t = 0; t <= L; t += st) for (let w = -half; w <= half; w += st) o.push([ax + ((bx - ax) * t) / L + nx * w, ay + ((by - ay) * t) / L + ny * w]); } return o; };

  // ---- 0) clean slate -----------------------------------------------------------------------------------------------
  const objs = (await api("list_objects", { limit: 100000 })).objects.map((o) => o.id);
  if (objs.length) await api("delete_objects", { ids: objs });
  const sp = (await api("list_spawns")).spawns.map((x) => x.id);
  if (sp.length) await api("delete_spawns", { ids: sp });
  const all = []; for (let y = 1; y < 512; y += 2) for (let x = 1; x < 512; x += 2) all.push([x, y]);
  await api("paint", { tool: "water", points: all, radius: 1.5, invert: true });
  await api("paint", { tool: "attr", attr: { block: true, water: true, banpk: true }, points: all, radius: 1.6, invert: true });
  step("cleared");

  // ---- 1) terrain: rising valley, mountains around it, eroded ----------------------------------------------------------
  const g = await api("terrain_generate", { seed: SEED, anchors: ANCHORS,
    hills: { amplitude: 9, scale: 85, octaves: 5, ridged: 0.3, warp: 30 },
    rim: { open: OPEN, width: 42, height: 34, ridged: 0.55, scale: 75 },
    calm: [R1, R2, R3].map((points) => ({ points, radius: 16, factor: 0.35 })),
    flats: [{ x: V.x, y: V.y, r: 30, blend: 16, height: 170 }],
    erosion: { droplets: 50000, strength: 1, thermal: 25, talus: 36 } });
  step("terrain " + JSON.stringify(g));

  // ---- 2) stream, gorge, roads ------------------------------------------------------------------------------------------
  const stream = await api("spline", { kind: "river", points: STREAM, width: 5, edge: 6, depth: 1.6, water: false, block: false, seed: SEED, texture: SNOW3, bedTexture: ICE });
  const gorge = await api("spline", { kind: "river", points: GORGE, width: 7, edge: 3, depth: 11, smooth: 10, water: false, block: true, seed: SEED + 1, texture: ROCK, bedTexture: ICE });
  step("stream " + JSON.stringify(stream) + " gorge " + JSON.stringify(gorge));
  const roads = [R1, R2, R3];
  for (let i = 0; i < roads.length; i++) await api("spline", { kind: "road", points: roads[i], width: 5, edge: 6, maxGrade: 0.13, smooth: 26, seed: SEED + 10 + i, texture: PATH });
  // village ground
  await api("paint", { tool: "flatten", points: disc(V.x, V.y, 26, 2), radius: 3, strength: 10, flattenTo: 170 });

  // ---- 3) textures by rule (snow palette of map_n_snowm_01) ---------------------------------------------------------------
  const tex = await api("auto_texture", { seed: SEED, keep: [PATH, ICE], rules: [
    { texture: ROCK, slope: [34, 90], jitter: 3 },
    { texture: ROCK3, slope: [27, 34], jitter: 3 },
    { texture: SNOW3, slope: [12, 27], jitter: 4 },
    { texture: SNOW2, noise: { scale: 55, min: 0.18 } },
    { texture: SNOW1 },
  ] });
  for (let i = 0; i < roads.length; i++) await api("spline", { kind: "road", points: roads[i], width: 5, edge: 6, maxGrade: 0.13, smooth: 26, seed: SEED + 10 + i, texture: PATH, edgeTexture: SNOW3 });
  await api("paint", { tool: "texture", texture: PATH, points: disc(V.x, V.y, 17, 1), radius: 1 });
  await api("paint", { tool: "texture", texture: PAVE, points: disc(V.x, V.y, 5, 1), radius: 1 });
  step("textures " + JSON.stringify(tex.counts));

  // ---- 4) attributes: only the valley is walkable; stream blocked except under the bridges ---------------------------------
  const block = [];
  for (let y = 0.5; y < 512; y += 1) for (let x = 0.5; x < 512; x += 1) {
    if (outside(x, y) > -1.5) { block.push([x, y]); continue; }
    const gx = (M.at(x + 1, y) - M.at(x - 1, y)) / 2, gy = (M.at(x, y + 1) - M.at(x, y - 1)) / 2;
    if (Math.atan(Math.hypot(gx, gy)) * 57.3 > 33) block.push([x, y]);
  }
  for (let i = 0; i < block.length; i += 40000) await api("paint", { tool: "attr", attr: { block: true }, points: block.slice(i, i + 40000), radius: 0.5 });
  for (const r of roads) await api("paint", { tool: "attr", attr: { block: true }, points: along(r, 3), radius: 1, invert: true });
  for (const b of [B1, B2]) await api("paint", { tool: "attr", attr: { block: true, water: true }, points: along([[b.x - b.len / 2, b.y], [b.x + b.len / 2, b.y]], 2.5), radius: 1, invert: true });
  await api("paint", { tool: "attr", attr: { banpk: true }, points: disc(V.x, V.y, 44, 2), radius: 1.6 });
  step("attributes, blocked cells " + block.length);

  const shot = async (cam) => (await api("screenshot", cam)).png;
  await api("set_environment", { name: "N-snowm01.msenv" }).catch((e) => step("environment: " + e.message));
  if (STAGE === "terrain") {
    return { log, shots: { top: await shot({ x: 256, y: 256, distance: 470, yaw: 0, pitch: 89 }), overview: await shot({ x: 256, y: 300, distance: 330, yaw: 0, pitch: 38 }), gorge: await shot({ x: 325, y: 215, distance: 60, yaw: 20, pitch: 25 }) } };
  }

  // ---- 5) objects --------------------------------------------------------------------------------------------------------
  const CAT = {};
  const crcOf = async (n) => { if (CAT[n]) return CAT[n]; const it = (await api("catalog", { query: n, usable: true, limit: 50 })).items.find((e) => e.name === n); if (!it) throw new Error("not usable: " + n); CAT[n] = it; return it; };
  // Map Studio puts the base on the lowest ground under the footprint (ground: "min"), sink m into the snow
  const put = async (list) => {
    const items = [];
    for (const [n, x, y, yaw = 0, o = {}] of list) {
      const e = await crcOf(n);
      items.push(o.z !== undefined ? { crc: e.crc, x, y, yaw, z: o.z - (o.sink ?? 0.15) } : { crc: e.crc, x, y, yaw, ground: "min", sink: o.sink ?? 0.15 });
    }
    return (await api("add_objects", { items })).added.length;
  };
  const pad = async (x, y, r, h) => api("paint", { tool: "flatten", points: disc(x, y, r, 2), radius: 3, strength: 10, flattenTo: h ?? M.at(x, y) });
  const placed = {};

  // village: twin hall north and pagoda hall west round the plaza with the brazier, market stalls, houses south,
  // palisade and gate towards the valley (fronts face south at yaw 0 and east at yaw 90: mesh rotation.y = yaw; screenshot camera yaw 90 stands west)
  for (const [x, y, r] of [[130, 396, 20], [158, 404, 7], [112, 460, 8], [132, 462, 7], [150, 458, 5], [86, 432, 15]]) await pad(x, y, r, 170);
  placed.village = await put([
    ["snow_brazier", V.x, V.y],
    ["snow-009-hotel", 130, 396, 0], ["snow-032-shamanhouse", 160, 404, 0], ["snow_4fbuilding", 86, 432, 90],
    ["nsm-016-house9", 112, 460, 180], ["nsm-001-house3", 132, 462, 180], ["nsm-004-house2", 150, 458, 180],
    ["nsm-general_obj_06", 110, 420, 90], ["nsm-general_obj_07", 110, 442, 90], ["nsm-general_obj_03", 148, 446, 200], ["ob-7-02-01", 116, 412, 15],
    ["snow-035-woodgate", 170, 430, 90], ["snow-bigdam-02", 170, 417.8, 90], ["snow-bigdam-02", 170, 407.8, 90], ["snow-bigdam-02", 170, 442.2, 90], ["snow-bigdam-02", 170, 452.2, 90],
    ["nsm-037-tower", 177, 414, 0], ["nsm-037-tower", 177, 446, 0],
    ...[45, 135, 225, 315].map((a) => ["nsm-018-stonelight-1", V.x + Math.cos((a * Math.PI) / 180) * 19, V.y + Math.sin((a * Math.PI) / 180) * 19, 0]),
    ["general_obj_flag", 163, 422, 0], ["general_obj_flag", 163, 438, 0],
  ]);
  step("village " + placed.village);

  // bridges: deck level with the road ends
  const roadLevel = (b) => (M.at(b.x - b.len / 2 - 1, b.y) + M.at(b.x + b.len / 2 + 1, b.y)) / 2;
  placed.bridges = await put([["nsm-022-10m-bridge", B2.x, B2.y, 0, { z: roadLevel(B2) - 10.4, sink: 0 }], ["nsm-10m-bridge02", B1.x, B1.y, 0, { z: roadLevel(B1) - 2.3, sink: 0 }]]);

  // zone landmarks
  for (const [x, y, r] of [[398, 455, 8], [432, 262, 8], [300, 80, 16], [318, 46, 11]]) await pad(x, y, r);
  // Z2 gatehouse across the path where it leaves the watch post for the gorge, walls along its width axis
  const GATE = { x: 406, y: 245, yaw: 39.5 }, gw = [Math.cos((GATE.yaw * Math.PI) / 180), -Math.sin((GATE.yaw * Math.PI) / 180)];
  const gateWalls = [16.5, 26.5, -16.5, -26.5].map((d) => ["snow-bigdam-02", GATE.x + gw[0] * d, GATE.y + gw[1] * d, GATE.yaw]);
  await api("paint", { tool: "texture", texture: PAVE, points: disc(300, 80, 13, 1), radius: 1 });
  await api("paint", { tool: "texture", texture: PATH, points: disc(300, 80, 17, 1).filter(([x, y]) => Math.hypot(x - 300, y - 80) > 13), radius: 1 });
  placed.landmarks = await put([
    // Z1 hunters camp
    ["general_obj_tent01", 400, 457, 200], ["general_obj_tent02", 386, 463, 160], ["general_obj_tent02", 412, 446, 250], ["snow_brazier", 393, 448],
    ["general_obj_fence01", 380, 448, 30], ["general_obj_fence02", 375, 455, 80], ["ob-7-02-01", 405, 466, 10], ["ob-7-02-01", 408, 463, 70], ["general_obj_flag", 389, 444],
    // Z2 watch post on the knoll
    ["snow-middledam-01", GATE.x, GATE.y, GATE.yaw, { z: M.at(GATE.x, GATE.y), sink: 0.2 }], ...gateWalls,
    ["general_obj_tent02", 432, 266, 200], ["general_obj_tent02", 442, 276, 230], ["snow_brazier", 426, 256], ["general_obj_flag", 416, 252], ["general_obj_flag", 398, 236], ["ob-7-02-01", 440, 258, 40],
    // Z3 wolf clearing in front of the ice cave
    ["wolf_statue", 152, 236, 180], ["n_snow_m_resoucegate.GR2", 84, 226, 84, { sink: 1.2 }],
    // Z4 ice shrine: tower over the spring, pillars round the plaza, wolves guarding the approach
    ["snow_tower01", 318, 46, 0],
    ...[0, 60, 120, 180, 240, 300].map((a) => ["ice_pillar_s05", 300 + Math.cos((a * Math.PI) / 180) * 22, 80 + Math.sin((a * Math.PI) / 180) * 22, a + 90, { sink: 0.6 }]),
    ["wolf_statue", 268, 70, 270], ["wolf_statue", 268, 92, 270],
    ["snow_brazier", 288, 70], ["snow_brazier", 312, 70], ["snow_brazier", 288, 90], ["snow_brazier", 312, 90],
    ["ice_pillar_s01", 362, 30, 20, { sink: 2 }],
  ]);
  // lights along the path (every ~42 m, alternating sides)
  const lights = [];
  for (const r of roads) {
    let side = 1, next = 20, run = 0;
    for (let i = 0; i + 1 < r.length; i++) {
      const [ax, ay] = r[i], [bx, by] = r[i + 1], L = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / L, ny = (bx - ax) / L;
      while (next <= run + L) {
        const t = next - run, x = ax + ((bx - ax) * t) / L + nx * 4.5 * side, y = ay + ((by - ay) * t) / L + ny * 4.5 * side;
        if (Math.hypot(x - V.x, y - V.y) > 50 && Math.hypot(x - B1.x, y - B1.y) > 20 && Math.hypot(x - B2.x, y - B2.y) > 26) lights.push(["nsm-018-stonelight", x, y, 0]);
        side = -side; next += 42;
      }
      run += L;
    }
  }
  placed.lights = await put(lights);
  step("landmarks " + placed.landmarks + " lights " + placed.lights);

  // ---- 5b) art pass: small stories along the walk (props checked in probe/props_sheet.png, effects in probe/fx_sheet.png) --
  const fxAt = (n, x, y, h) => [n, x, y, 0, { z: M.at(x, y) + h, sink: 0 }];
  const ring = (cx, cy, r, n, a0 = 0) => Array.from({ length: n }, (_, i) => [cx + Math.cos(a0 + (i * 2 * Math.PI) / n) * r, cy + Math.sin(a0 + (i * 2 * Math.PI) / n) * r]);
  placed.art = await put([
    // village life: fire on the plaza brazier, lanterns at the gate, crates and barrels by the stalls, a cart by the hall,
    // garden fences behind the south houses, signpost outside the gate
    fxAt("fire_camp1", V.x, V.y, 3.9),
    ["tent_01_lamp", 181, 424, 0], ["tent_01_lamp", 181, 436, 0],
    ["ob-b1-005-woodbarrel", 106, 426, 0], ["ob-b1-006-woodbarrel", 107.5, 427.5, 40], ["ob-b1-001-box01", 106, 436, 15], ["ob-b1-001-box02", 107, 438, 70], ["ob-b1-005-woodbarrel", 152, 441, 0],
    ["desert_cart01", 156, 390, 70], ["ob-b1-001-box03", 152, 386, 30],
    ["general_obj_fence01", 104, 468, 0], ["general_obj_fence01", 108, 468, 0], ["general_obj_fence02", 124, 470, 0], ["general_obj_fence01", 140, 470, 0], ["general_obj_fence03", 146, 468, 0],
    ["sign_01", 186, 420, 300],
    // Z1: the White Beast - a giant frozen skeleton in the field, spine pointing to the shrine; hunters' hut and fire
    ["bone_whale_vertebra00", 296, 458, 25], ["bone_whale_rib_up01", 292, 452, 25, { sink: 0.6 }], ["bone_whale_rib_up01", 302, 462, 25, { sink: 0.6 }], ["bone00a", 286, 468, 205],
    ["camp_woodhut_01", 414, 468, 200], ["general_obj_campfire", 396, 452, 0], fxAt("fire_camp1", 396, 452, 0.4), ["torch_2", 384, 444, 0], ["deadwood_01", 422, 456, 80], ["bone00a", 404, 470, 170],
    // the road between field and watch post: a cart the wolves got, logs along the path, signpost at the bridge
    ["desert_cart01", 436, 312, 140], ["ob-b1-001-box02", 432, 316, 10], ["ob-b1-001-box01", 439, 317, 50], ["general_obj_breakenbox02", 434, 309, 0], ["bone00f", 431, 304, 300],
    ["deadwood_08", 462, 380, 20], ["sign_01", 352, 214, 90],
    // Z2: torches at the gate, guards' fire
    ["torch_2", 398, 252, 0], ["torch_2", 414, 238, 0], ["general_obj_campfire", 430, 280, 0], fxAt("fire_camp1", 430, 280, 0.4),
    // gorge: mist rising from the ice under the bridge, broken rocks on the rims
    fxAt("fall_smoke", B2.x, B2.y + 14, -9),
    ["5st_cliff_hom05", 342, 186, 30, { sink: 2 }], ["5st_cliff_hom03", 306, 228, 200, { sink: 1.5 }], ["5st_cliff_hom05", 312, 168, 110, { sink: 2 }],
    // Z3: wolf den - fallen wood and a grave before the ice cave (small bones read as wooden blocks), gnarled dead trees on the clearing edge, mist in the mouth
    ["deadwood_01", 110, 214, 70], ["deadwood_08", 112, 240, 160], ["stone_grave_001", 118, 252, 30],
    ["deadwood_05", 124, 264, 40], ["deadwood_07", 204, 262, 300], ["deadwood_05", 196, 180, 160], fxAt("ground_smoke", 94, 226, 0.5),
    ["deadwood_01", 132, 176, 30], ["deadwood_08", 178, 112, 70],
    // Z4: blue fire on the shrine braziers, dark rock spears framing the tower, a toppled statue on the approach
    ...[[288, 70], [312, 70], [288, 90], [312, 90]].map(([x, y]) => fxAt("fire_blue1", x, y, 3.9)),
    ["SpearRock_004", 296, 30, 0, { sink: 1 }], ["SpearRock_004", 344, 36, 40, { sink: 1.5 }], ["SpearRock_004", 280, 46, 80, { sink: 1 }], ["SpearRock_004", 352, 70, 10, { sink: 2 }],
    ["statue00c", 246, 106, 30, { sink: 0.5 }], fxAt("ground_smoke", 300, 80, 0.3),
  ]);
  step("art props " + placed.art);

  // vegetation: dense conifers on the mountains thinning towards the crests, groves per zone, shrubs along the path
  const it = async (...names) => Promise.all(names.map(async (n) => ({ crc: (await crcOf(n)).crc })));
  const stones = await it("general_obj_stone10", "general_obj_stone13", "general_obj_stone07", "general_obj_stone14");
  const lines = roads.map((points) => ({ points, radius: 6 }));
  const keepClear = [{ x: V.x, y: V.y, r: 42 }, { x: 300, y: 80, r: 26 }, { x: 318, y: 46, r: 12 }, { x: 398, y: 455, r: 18 }, { x: 406, y: 245, r: 20 }, { x: 434, y: 264, r: 14 }, { x: 152, y: 236, r: 12 }, { x: 90, y: 226, r: 18 }, { x: B1.x, y: B1.y, r: 18 }, { x: B2.x, y: B2.y, r: 24 }, { x: 296, y: 456, r: 20 }, { x: 412, y: 464, r: 12 }, { x: 436, y: 311, r: 9 }, { x: 110, y: 234, r: 20 }, { x: 246, y: 106, r: 8 }];
  const res = {};
  const run = async (name, opts) => { const r = await api("scatter", { seed: SEED + Object.keys(res).length * 13, avoid: keepClear, avoidLines: lines, ...opts }); res[name] = Object.fromEntries(Object.entries(r.stats).map(([k, v]) => [k, v.placed])); };
  // palette checked in probe/tree_sheet.png: treewhitepinesnow renders green, snowpinebig3 brown -> left out
  const conifers = await it("WhitePine1", "WhitePine2", "WhitePine1", "ColoradoBlueSpruce1", "ColoradoBlueSpruce2", "ColoradoBlueSpruce3", "MontereyCypress_Winter1", "MontereyCypress_Winter2");
  await run("mountains", { area: [0, 0, 512, 512], avoidBlocked: false, layers: [
    { name: "forest", items: conifers, density: 150, cluster: { radius: 12, size: 14 }, mask: { scale: 70, min: -0.25, fade: 0.25, seed: SEED + 40 }, spacing: 4.5, blocked: "only", slope: [0, 52], height: [0, 246] },
    { name: "crest", items: conifers.slice(0, 3), density: 10, cluster: { radius: 10, size: 3 }, spacing: 8, blocked: "only", slope: [0, 36], height: [246, 400] },
    { name: "cliff", items: stones, density: 7, blocked: "only", slope: [24, 80], sink: 0.4, maxGroundRange: 8, clearance: 0.5 }] });
  const zoneArea = (z) => [z.c[0] - z.r - 35, z.c[1] - z.r - 35, z.c[0] + z.r + 35, z.c[1] + z.r + 35];
  const groves = {
    1: await it("Beech_Winter1", "Beech_Winter2", "Beech_Winter3", "CommonOlive_Winter"),
    2: await it("ColoradoBlueSpruce1", "ColoradoBlueSpruce2", "Beech_Winter2", "WhitePine1"),
    3: await it("WhitePine2", "WhitePine1", "ColoradoBlueSpruce1", "ColoradoBlueSpruce3", "MontereyCypress_Winter2"),
    4: await it("WhitePine1", "Tulip_Winter1", "MontereyCypress_Winter1"),
  };
  // trees per ha of the zone box, tuned to ~7 trees / ha of walkable ground in tight groves (snowm01: 6.9, Clark-Evans 0.6);
  // only the wolf forest has a patch mask (the scatter dry run showed the mask removing most groves elsewhere)
  const dens = { 1: 8, 2: 9, 3: 16, 4: 5 };
  const shrubs = await it("winter_shrub00a", "winter_shrub01a", "winter_shrub01b", "winter_shrub00b");
  for (const [z, Z] of Object.entries(ZONES)) await run("zone" + z, { area: zoneArea(Z), layers: [
    { name: "grove", items: groves[z], density: dens[z], cluster: { radius: 8, size: z == 3 ? 8 : 5 }, ...(z == 3 ? { mask: { scale: 60, min: -0.35, fade: 0.3, seed: SEED + +z } } : {}), spacing: 7, clearance: 1, slope: [0, 32] },
    { name: "under", items: shrubs, near: { layer: "grove", radius: 8, chance: 0.5 }, clearance: 0.5, slope: [0, 30] },
    { name: "rock", items: stones, density: 2.5, cluster: { radius: 6, size: 3 }, clearance: 0.8, sink: 0.3, maxGroundRange: 3 }] });
  await run("landmark-trees", { area: zoneArea(ZONES[1]), layers: [{ name: "big", items: await it("CommonOlive_Winter"), count: 4, spacing: 40, clearance: 4, slope: [0, 20] }] });
  // the walkable valley between the zones (stream valley, path sides): light groves and shrubs
  await run("valley", { area: [0, 0, 512, 512], layers: [
    { name: "grove", items: conifers, density: 2.5, cluster: { radius: 8, size: 5 }, spacing: 7, clearance: 1, slope: [0, 32] },
    { name: "under", items: shrubs, near: { layer: "grove", radius: 7, chance: 0.5 }, clearance: 0.5, slope: [0, 32] }] });
  step("vegetation " + JSON.stringify(res));

  // ---- 5c) art pass: a closed wall of trees along every valley edge (the official maps frame each pocket this way),
  // rock outcrops in it, and the bare blocked slopes filled where no tree stands within 15 m (Map Studio forest_edge)
  const fe = await api("forest_edge", { seed: SEED + 99, items: conifers, rocks: stones, maxHeight: 250, avoid: keepClear, avoidLines: [{ points: GORGE, radius: 9 }],
    edge: { from: 0.5, to: 16, chance: 0.7, spacing: 5.5 }, fill: { radius: 15, chance: 0.4, spacing: 7 } });
  step("forest edge " + JSON.stringify(fe.stats));

  // ---- 6) metins and monster groups: flat, reachable, clear, off the path (Map Studio plan_spawns) -----------------------------
  await api("set_town", { x: V.x, y: V.y });
  await api("add_spawns", { items: [[9012, 124, 422], [9003, 138, 440], [9005, 120, 438]].map(([vnum, x, y]) => ({ type: "npc", vnum, x, y, radius: 1, count: 1, respawn: 120 })) });
  const plan = await api("plan_spawns", { seed: SEED, apply: true, avoid: keepClear, avoidLines: roads.map((points) => ({ points, radius: 12 })),
    zones: Object.entries(ZONES).map(([z, Z]) => ({ name: Z.name, circles: [[...Z.c, Z.r], ...Z.more], metins: Z.metin, groups: Z.groups, groupType: Z.type, metinRespawn: 600 + 75 * (z - 1), groupRespawn: Z.respawn })) });
  const metins = plan.items.filter((i) => i.type === "m"), groups = plan.items.filter((i) => i.type !== "m");
  const rc = await api("reachability", {});
  const unreachable = rc.unreachableSpawns.map((i) => `${i.type}${i.vnum}@${i.x},${i.y}`);
  step(`spawns ${JSON.stringify(plan.stats)}, reachable ${rc.reachableHa} ha, unreachable ${unreachable.length}`);
  await api("save");
  const fin = await api("status");
  step("saved, objects " + fin.objects);

  const shots = {
    top: await shot({ x: 256, y: 256, distance: 470, yaw: 0, pitch: 89 }),
    overview: await shot({ x: 256, y: 330, distance: 340, yaw: 0, pitch: 36 }),
    village: await shot({ x: 130, y: 432, distance: 62, yaw: 0, pitch: 24 }),
    view_from_village: await shot({ x: 172, y: 352, distance: 95, yaw: 26, pitch: 10 }),
    z1: await shot({ x: 380, y: 450, distance: 60, yaw: 330, pitch: 22 }),
    z2: await shot({ x: 440, y: 262, distance: 55, yaw: 20, pitch: 22 }),
    gorge: await shot({ x: 325, y: 206, distance: 70, yaw: 0, pitch: 30 }),
    z3: await shot({ x: 160, y: 236, distance: 65, yaw: 0, pitch: 22 }),
    z4: await shot({ x: 300, y: 92, distance: 70, yaw: 0, pitch: 18 }),
  };
  return { log, unreachable, metins, groups, objects: fin.objects, shots };
})();
