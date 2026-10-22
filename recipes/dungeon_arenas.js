// apix_dungeon_01 "Ľadová jaskyňa Bieleho vlka": one arena design in five variants on one 2x2 map, one per stage; the
// quest moves the party from arena to arena (d.jump_all). Each arena: round floor, raised altar dais, five alcoves in a
// pentagon (seals, spawn mouths; the north one holds the exit portal), entry alcove south, ice cave walls round it.
//   node apix-map-studio/test/run-eval.js <map dir> build.js <out dir> --inplace
// Writes _export/dungeon/{arenas.json, stage1..5.txt} into the map folder (regen lines in local metres).
(async () => {
  const s = window.__studio, api = s.api, M = s.model, log = [];
  const DIR = "C:/Users/micha/Documents/we_remix_v59__20260716-1745/apix_dungeon_01";
  const t0 = performance.now();
  const step = (m) => { log.push(`${((performance.now() - t0) / 1000).toFixed(1)}s ${m}`); window.studio.exportWrite(DIR, [{ rel: "_export/build-progress.txt", text: log.join("\r\n") }]); };
  if ((await api("status")).map !== "apix_dungeon_01") throw new Error("wrong map");
  const SEED = 9191, FLOOR = 170;
  const T = (n) => `d:/ymir work/terrainmaps/n/snow.m/${n}.dds`;
  const SNOW1 = T("snow01"), SNOW2 = T("snow02"), SNOW3 = T("snow03"), PATH = T("field 01"), DIRT = T("field 03"), ICE = T("ice_quest"), PAVE = T("tile04"), ROCK = T("stone01"), ROCK3 = T("stone03");
  const rad = (d) => (d * Math.PI) / 180;
  const ARENAS = [
    { stage: 1, name: "Vstupná sieň", x: 128, y: 400, R: 46 },
    { stage: 2, name: "Rozbité pečate", x: 400, y: 400, R: 46 },
    { stage: 3, name: "Zamrznuté jazero", x: 400, y: 112, R: 46 },
    { stage: 4, name: "Vlčí brloh", x: 112, y: 112, R: 46 },
    { stage: 5, name: "Trón Bieleho vlka", x: 256, y: 256, R: 62 },
  ];
  for (const A of ARENAS) {
    A.alcoves = [-90, -18, 54, 126, 198].map((a) => ({ x: +(A.x + Math.cos(rad(a)) * (A.R + 3)).toFixed(1), y: +(A.y + Math.sin(rad(a)) * (A.R + 3)).toFixed(1), a }));
    A.entry = { x: A.x, y: A.y + A.R + 5 };
    A.portal = { x: A.x, y: A.y - A.R - 9 };
    A.dais = { x: A.x, y: A.stage === 5 ? A.y - 18 : A.y, r: A.stage === 5 ? 15 : 7, h: A.stage === 5 ? 2.4 : 0.8 };
  }
  const OPEN = ARENAS.flatMap((A) => [{ x: A.x, y: A.y, r: A.R }, { x: A.entry.x, y: A.entry.y, r: 9 }, { points: [[A.x, A.y], [A.entry.x, A.entry.y]], radius: 7 },
    ...A.alcoves.map((c) => ({ x: c.x, y: c.y, r: c.a === -90 ? 11 : 8 })), { x: A.portal.x, y: A.portal.y, r: 9 }]);
  const outside = (x, y) => Math.min(...OPEN.map((o) => (o.points ? polyDist(o.points, x, y) - o.radius : Math.hypot(o.x - x, o.y - y) - o.r)));
  function polyDist(pts, x, y) { let b = Infinity; for (let i = 0; i + 1 < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)); b = Math.min(b, Math.hypot(ax + t * dx - x, ay + t * dy - y)); } return b; }
  const disc = (cx, cy, r, st = 1) => { const o = []; for (let y = -r; y <= r; y += st) for (let x = -r; x <= r; x += st) if (x * x + y * y <= r * r) o.push([cx + x, cy + y]); return o; };
  const ring = (cx, cy, r, n, a0 = 0) => Array.from({ length: n }, (_, i) => [+(cx + Math.cos(rad(a0) + (i * 2 * Math.PI) / n) * r).toFixed(1), +(cy + Math.sin(rad(a0) + (i * 2 * Math.PI) / n) * r).toFixed(1)]);

  // ---- 0) clean slate
  const ids = (await api("list_objects", { limit: 100000 })).objects.map((o) => o.id);
  if (ids.length) await api("delete_objects", { ids });
  const sp = (await api("list_spawns")).spawns.map((x) => x.id);
  if (sp.length) await api("delete_spawns", { ids: sp });
  const all = []; for (let y = 1; y < 512; y += 2) for (let x = 1; x < 512; x += 2) all.push([x, y]);
  await api("paint", { tool: "water", points: all, radius: 1.5, invert: true });
  await api("paint", { tool: "attr", attr: { block: true, water: true, banpk: true }, points: all, radius: 1.6, invert: true });
  step("cleared");

  // ---- 1) terrain: ice cave chambers in solid rock; floor with slight swell, raised daises, frozen lake in arena 3
  const g = await api("terrain_generate", { seed: SEED, base: FLOOR, hills: { amplitude: 1.4, scale: 28, octaves: 3, ridged: 0, warp: 6 },
    rim: { open: OPEN, width: 16, height: 30, ridged: 0.7, scale: 30 }, erosion: { droplets: 12000, strength: 0.6, thermal: 6, talus: 55 },
    flats: ARENAS.map((A) => ({ x: A.dais.x, y: A.dais.y, r: A.dais.r, blend: A.stage === 5 ? 9 : 4, height: FLOOR + A.dais.h })) });
  step("terrain " + JSON.stringify(g));
  const A3 = ARENAS[2];
  await api("paint", { tool: "flatten", points: disc(A3.x, A3.y + 10, 16, 2), radius: 3, strength: 10, flattenTo: FLOOR - 0.7 });
  for (const A of ARENAS) await api("paint", { tool: "flatten", points: disc(A.entry.x, A.entry.y, 7, 2), radius: 3, strength: 8, flattenTo: FLOOR });

  // ---- 2) textures: rock walls everywhere, a floor palette per arena
  const walls = [{ texture: ROCK, slope: [32, 90], jitter: 3 }, { texture: ROCK3, slope: [22, 32], jitter: 3 }];
  const floors = {
    1: [{ texture: SNOW2, noise: { scale: 18, min: 0.25 } }, { texture: SNOW1 }],
    2: [{ texture: ROCK3, noise: { scale: 9, min: 0.35 } }, { texture: SNOW3, noise: { scale: 20, min: -0.1 } }, { texture: PATH }],
    3: [{ texture: SNOW2, noise: { scale: 14, min: 0.1 } }, { texture: SNOW1 }],
    4: [{ texture: DIRT, noise: { scale: 12, min: 0.3 } }, { texture: PATH, noise: { scale: 16, min: -0.15 } }, { texture: SNOW3 }],
    5: [{ texture: SNOW2, noise: { scale: 22, min: 0.3 } }, { texture: SNOW1 }],
  };
  await api("auto_texture", { seed: SEED, rules: [...walls, { texture: SNOW3 }] });
  for (const A of ARENAS) {
    const pad = A.R + 22;
    await api("auto_texture", { seed: SEED + A.stage, area: [A.x - pad, A.y - pad, A.x + pad, A.y + pad], rules: [...walls, ...floors[A.stage]] });
  }
  const paint = async (texture, pts) => api("paint", { tool: "texture", texture, points: pts, radius: 1 });
  await paint(PAVE, disc(ARENAS[0].x, ARENAS[0].y, 9));
  await paint(PATH, disc(ARENAS[0].x, ARENAS[0].y, 12).filter(([x, y]) => Math.hypot(x - ARENAS[0].x, y - ARENAS[0].y) > 9));
  for (const A of ARENAS) await paint(PATH, disc(A.entry.x, A.entry.y, 6));
  await paint(ICE, disc(A3.x, A3.y + 10, 17));
  await paint(PAVE, disc(ARENAS[4].dais.x, ARENAS[4].dais.y, 16));
  await paint(PATH, disc(ARENAS[4].x, ARENAS[4].y + 14, 26).filter(([x, y]) => Math.hypot(x - ARENAS[4].dais.x, y - ARENAS[4].dais.y) > 16 && Math.abs(x - ARENAS[4].x) < 5));
  await paint(PAVE, disc(ARENAS[1].x, ARENAS[1].y, 6));
  step("textures");

  // ---- 3) attributes: only the chambers are walkable, everything is a no-PvP dungeon floor
  const block = [];
  for (let y = 0.5; y < 512; y += 1) for (let x = 0.5; x < 512; x += 1) {
    if (outside(x, y) > -1) { block.push([x, y]); continue; }
    const gx = (M.at(x + 1, y) - M.at(x - 1, y)) / 2, gy = (M.at(x, y + 1) - M.at(x, y - 1)) / 2;
    if (Math.atan(Math.hypot(gx, gy)) * 57.3 > 34) block.push([x, y]);
  }
  for (let i = 0; i < block.length; i += 40000) await api("paint", { tool: "attr", attr: { block: true }, points: block.slice(i, i + 40000), radius: 0.5 });
  // the whole dungeon is a no-PvP zone (party members fight side by side; the map check wants the town no-PvP)
  const safe = [];
  for (let y = 0.5; y < 512; y += 1) for (let x = 0.5; x < 512; x += 1) if (outside(x, y) < 0) safe.push([x, y]);
  for (let i = 0; i < safe.length; i += 40000) await api("paint", { tool: "attr", attr: { banpk: true }, points: safe.slice(i, i + 40000), radius: 0.5 });
  step("attributes, blocked " + block.length);

  // ---- 4) objects: shared skeleton + variant dressing (assets checked in ../assets_structures.png)
  const add = async (list) => (await api("add_objects", { items: list.map(([name, x, y, o = {}]) => ({ name, x, y, ground: "min", sink: 0.1, ...o })) })).added.length;
  const fx = (name, x, y, h) => [name, x, y, { z: M.at(x, y) + h, sink: 0 }];
  const placed = {};
  for (const A of ARENAS) {
    const L = [];
    // shared: entry pad, exit portal facing the arena, a lion pair at the entry
    L.push(["warpgate02_01", A.entry.x, A.entry.y], ["warpgate01", A.portal.x, A.portal.y - 2, { yaw: 0 }]);
    L.push(["general_obj_lionstoneimage", A.entry.x - 7, A.entry.y - 4, { face: [A.x, A.y] }], ["general_obj_lionstoneimage", A.entry.x + 7, A.entry.y - 4, { face: [A.x, A.y] }]);
    const cols = ring(A.x, A.y, A.R * 0.66, 8, 22.5);
    const side = A.alcoves.filter((c) => c.a !== -90);
    if (A.stage === 1) {
      cols.forEach(([x, y]) => L.push(["column01b", x, y, { face: [A.x, A.y] }]));
      A.alcoves.forEach((c) => L.push(["snow_brazier", c.x, c.y], fx("fire_camp1", c.x, c.y, 3.9)));
      L.push(["snow_brazier", A.x, A.y], fx("fire_camp1", A.x, A.y, 4.7));
      L.push(["wolf_statue", A.x - 12, A.y - A.R + 6, { face: [A.x, A.y] }], ["wolf_statue", A.x + 12, A.y - A.R + 6, { face: [A.x, A.y] }]);
    } else if (A.stage === 2) {
      cols.forEach(([x, y], i) => L.push([i % 3 === 0 ? "column00e" : i % 3 === 1 ? "column00b" : "column01b", x, y, { yaw: (i * 47) % 360 }]));
      A.alcoves.forEach((c) => L.push(["warpgate03_01", c.x, c.y, { sink: 0.3 }]));
      L.push(["general_obj_bigtower05", A.x, A.y, { sink: 0.2 }]);
      ring(A.x, A.y, 20, 3, 40).forEach(([x, y]) => L.push(fx("ground_smoke", x, y, 0.3)));
      ring(A.x, A.y, 30, 6, 10).forEach(([x, y], i) => L.push([["general_obj_stone13", "general_obj_stone14", "general_obj_stone07"][i % 3], x, y, { yaw: i * 61, sink: 0.4 }]));
    } else if (A.stage === 3) {
      ring(A.x, A.y + 10, 21, 10, 9).forEach(([x, y], i) => L.push(["ice_pillar_s05", x, y, { yaw: i * 36 + 90, sink: 0.6 }]));
      A.alcoves.forEach((c) => L.push(["snow_brazier", c.x, c.y], fx("fire_blue1", c.x, c.y, 3.9)));
      L.push(["ice_pillar_s01", A.portal.x + 16, A.portal.y + 2, { sink: 3 }], ["ice_pillar_s01", A.portal.x - 18, A.portal.y + 4, { yaw: 140, sink: 3 }]);
    } else if (A.stage === 4) {
      cols.filter((_, i) => i % 2 === 0).forEach(([x, y], i) => L.push(["column00b", x, y, { yaw: i * 77 }]));
      side.forEach((c, i) => L.push([["bone00g", "bone00f", "bone_whale_rib_up01", "bone00a"][i], c.x + (A.x - c.x) * 0.18, c.y + (A.y - c.y) * 0.18, { face: [A.x, A.y], sink: 0.4 }]));
      L.push(["deadwood_05", A.x - 24, A.y - 22, { yaw: 30 }], ["deadwood_07", A.x + 26, A.y + 18, { yaw: 200 }], ["stone_grave_001", A.x, A.y, { yaw: 15 }], ["snow_brazier", A.alcoves[0].x, A.alcoves[0].y]);
      ring(A.x, A.y, 16, 4, 0).forEach(([x, y]) => L.push(fx("ground_smoke", x, y, 0.3)));
      L.push(["SpearRock_004", A.x - 38, A.y - 22, { sink: 1 }], ["SpearRock_004", A.x + 36, A.y - 26, { sink: 1 }]);
    } else {
      const D = A.dais;
      L.push(["boss_gate_001", D.x, D.y - 10, { yaw: 0 }], ["ice_pillar_s01", D.x, A.y - A.R - 2, { sink: 3 }]);
      L.push(["wolf_statue", D.x - 11, D.y + 15, { face: [D.x, A.y + A.R] }], ["wolf_statue", D.x + 11, D.y + 15, { face: [D.x, A.y + A.R] }]);
      L.push(["general_obj_bigtower05", D.x - 15, D.y - 4], ["general_obj_bigtower05", D.x + 15, D.y - 4]);
      ring(A.x, A.y, A.R * 0.7, 8, 22.5).filter(([x, y]) => Math.hypot(x - D.x, y - D.y) > D.r + 8).forEach(([x, y]) => L.push(["column01b", x, y, { face: [A.x, A.y] }]));
      A.alcoves.forEach((c) => L.push(["snow_brazier", c.x, c.y], fx("fire_blue1", c.x, c.y, 3.9)));
      ring(D.x, D.y, 10, 4, 45).forEach(([x, y]) => L.push(["snow_brazier", x, y], fx("fire_blue1", x, y, 3.9)));
    }
    placed[A.stage] = await add(L);
  }
  // cave ceilings (tools/make_dome.py): an inward-facing rock dome with stalactites over every chamber, base on the floor
  placed.ceilings = (await api("add_objects", { items: ARENAS.map((A) => ({ name: A.R > 50 ? "apix_cave_ceiling_84" : "apix_cave_ceiling_66", x: A.x, y: A.y, z: FLOOR, yaw: A.stage * 47 })) })).added.length;
  // cave walls: icicles hanging over the chamber edges, conifer-free (underground); rock outcrops on the wall foot
  const icicles = [];
  for (const A of ARENAS) for (let a = 0; a < 360; a += A.stage === 5 ? 20 : 26) {
    const x = A.x + Math.cos(rad(a)) * (A.R + 7), y = A.y + Math.sin(rad(a)) * (A.R + 7);
    if (outside(x, y) < 2) continue;
    icicles.push([a % 52 ? "icicle_up_01" : "icicle_up_05", x, y, { face: [A.x, A.y], z: M.at(x, y) - 2, sink: 0 }]);
  }
  placed.icicles = await add(icicles);
  const fe = await api("forest_edge", { seed: SEED, items: [{ name: "general_obj_stone13" }, { name: "general_obj_stone14" }, { name: "general_obj_stone10" }], edge: { from: 0.5, to: 6, chance: 0.18, spacing: 6 }, fill: false, maxSlope: 60, sink: 0.6 });
  step("objects " + JSON.stringify(placed) + " rocks " + JSON.stringify(fe.stats));

  // ---- 5) stage packs: flat, reachable spots per arena (planner), written as regen files; town = arena 1 entry
  await api("set_town", { x: ARENAS[0].entry.x, y: ARENAS[0].entry.y });
  const PACKS = { 1: [1131, 1133, 1131, 1133, 1132, 1134], 2: [1133, 1134, 1135, 1132, 1134, 1135], 3: [1131, 1131, 1132, 1132, 1133, 1131], 4: [1135, 1136, 1135, 1136, 1134, 1136], 5: [] };
  const regen = {}, packs = {};
  for (const A of ARENAS) {
    const avoid = [{ x: A.dais.x, y: A.dais.y, r: A.dais.r + 3 }, { x: A.entry.x, y: A.entry.y, r: 14 }, ...A.alcoves.map((c) => ({ x: c.x, y: c.y, r: 6 }))];
    if (A.stage === 3) avoid.push({ x: A.x, y: A.y + 10, r: 17 });
    const plan = await api("plan_spawns", { from: [A.entry.x, A.entry.y], seed: SEED + A.stage, avoid, groupSpacing: 13, groupRough: 3, probe: 4, step: 3,
      zones: [{ name: String(A.stage), circles: [[A.x, A.y, A.R - 2]], groups: PACKS[A.stage], groupType: "m" }] });
    packs[A.stage] = plan.items.map((i) => ({ vnum: i.vnum, x: i.x, y: i.y }));
    regen[A.stage] = plan.items.map((i) => ["m", Math.round(i.x), Math.round(i.y), 5, 5, 0, 0, "0s", 100, 3, i.vnum].join("\t")).join("\r\n");
  }
  // reachability inside each arena from its entry
  const reach = {};
  for (const A of ARENAS) {
    const r = await api("reachability", { from: [A.entry.x, A.entry.y] });
    // alcoves, dais front and pack spots must lie on walkable ground of this chamber (spawn points of the quest)
    const pts = [...A.alcoves.map((c) => [c.x, c.y]), [A.dais.x, A.dais.y + A.dais.r - 2], ...packs[A.stage].map((p) => [p.x, p.y])];
    const at = (await api("terrain_height", { points: pts })).heights;
    reach[A.stage] = { ha: r.reachableHa, blockedSpawnPoints: at.filter((h) => h.attr & 3).map((h) => [h.x, h.y]) };
  }
  // arenas.json in ASCII: exportWrite does not keep UTF-8
  const ascii = (t) => [...t].map((c) => (c.charCodeAt(0) > 126 ? String.fromCharCode(92) + "u" + c.charCodeAt(0).toString(16).padStart(4, "0") : c)).join("");
  const files = [{ rel: "_export/dungeon/arenas.json", text: ascii(JSON.stringify({ map: "apix_dungeon_01", floor: FLOOR, arenas: ARENAS, packs }, null, 1)) },
    ...Object.entries(regen).map(([k, v]) => ({ rel: `_export/dungeon/stage${k}.txt`, text: v + (v ? "\r\n" : "") }))];
  window.studio.exportWrite(DIR, files);
  await api("set_environment", { name: "metin2_map_n_snow_dungeon_01.msenv" }).catch((e) => step("env " + e.message));
  await api("save");
  step(`saved, objects ${(await api("status")).objects}, packs ${JSON.stringify(Object.fromEntries(Object.entries(packs).map(([k, v]) => [k, v.length])))}, reach ${JSON.stringify(reach)}`);

  const shot = async (cam) => (await api("screenshot", cam)).png;
  const shots = { top: await shot({ x: 256, y: 256, distance: 470, yaw: 0, pitch: 89 }) };
  for (const A of ARENAS) shots["arena" + A.stage] = await shot({ x: A.x, y: A.y - 6, distance: A.R * 2.1, yaw: 0, pitch: 38 });
  // player's view: camera inside the dome (~20 m behind and 11 m above the player), the ceiling shows
  for (const A of ARENAS) shots["inside" + A.stage] = await shot({ x: A.x, y: A.y - 8, distance: 30, yaw: 0, pitch: 20 });
  return { log, arenas: ARENAS.map(({ stage, name, x, y, R, alcoves, entry, portal, dais }) => ({ stage, name, x, y, R, alcoves, entry, portal, dais })), packs, reach, shots };
})();
