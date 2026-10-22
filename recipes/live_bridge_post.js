// Yongan: guard post at the stone bridge over the gorge (b1-022-10m-bridge at 379,499; road east-west, wooden gate at 405).
// Runs on the live working copy metin2_map_a1_live (Map Studio "Z hry…"); saves the copy, the game is not touched.
//   node apix-map-studio/test/run-eval.js <copy> most.js <out> --inplace        (DRY = true: plan + no save)
(async () => {
  const DRY = true;
  const api = window.__studio.api, M = window.__studio.model;
  const st = await api("status");
  if (st.map !== "metin2_map_a1_live") throw new Error("wrong map " + st.map);
  const BR = { x: 379, y: 499 };
  const walk = (x, y) => !(M.attr(Math.floor(x), Math.floor(y)) & 3);
  const slope = (x, y) => Math.atan(Math.hypot((M.at(x + 1, y) - M.at(x - 1, y)) / 2, (M.at(x, y + 1) - M.at(x, y - 1)) / 2)) * 57.3;
  const before = (await api("list_objects", { limit: 5000 })).objects;
  const taken = before.map((o) => ({ x: o.x, y: o.y, r: 1.5 }));
  const plan = [], missed = [];
  // nearest good spot within 3 m of the wanted one: walkable, not water, flat, clear of other objects
  const place = (name, x, y, o = {}, r = 1.2) => {
    for (let d = 0; d <= 3; d += 0.5) for (let a = 0; a < 360; a += d ? 30 : 360) {
      const px = x + Math.cos((a * Math.PI) / 180) * d, py = y + Math.sin((a * Math.PI) / 180) * d;
      if (!walk(px, py) || slope(px, py) > 16 || !taken.every((t) => Math.hypot(t.x - px, t.y - py) >= r + t.r)) continue;
      plan.push({ name, x: +px.toFixed(2), y: +py.toFixed(2), ground: "min", sink: 0.1, ...o });
      taken.push({ x: px, y: py, r });
      return true;
    }
    missed.push(name + "@" + x + "," + y);
    return false;
  };
  // bridge heads: a lantern on each side of the road at both ends, facing the bridge
  for (const [x, y] of [[356, 492.5], [356, 505.5], [401, 492.5], [401, 505.5]]) place("a1_018-stonelight-1", x, y, { face: [BR.x, BR.y] }, 1.3);
  // banners on the west head, facing travellers coming from the west
  for (const [x, y] of [[352, 492], [352, 506]]) place("general_obj_flag", x, y, { face: [330, y] }, 0.6);
  // guard camp north of the west road: tent facing the road, fire, bench, supplies, spear rack
  place("general_obj_tent02", 336, 486.5, { face: [336, 499] }, 3);
  place("general_obj_campfire", 341.5, 486, { yaw: 0 }, 1);
  const fire = plan.find((p) => p.name === "general_obj_campfire");
  if (fire) plan.push({ name: "fire_camp1", x: fire.x, y: fire.y, z: M.at(fire.x, fire.y) + 0.4 });
  place("general_obj_woodbed", 345.5, 488, fire ? { face: [fire.x, fire.y] } : {}, 1.2);
  place("B_general_obj_25", 331.5, 489.5, { face: [336, 499] }, 1.2);
  place("ob-b1-005-woodbarrel", 331.5, 486, { yaw: 30 }, 0.5);
  place("ob-b1-005-woodbarrel", 332.4, 485.2, { yaw: 75 }, 0.5);
  place("ob-b1-001-box02", 333, 484, { yaw: 15 }, 0.5);
  // signpost where the road leaves the bridge to the west
  place("sign_01", 347, 510.5, { face: [347, 499] }, 0.8);

  const shot = async (cam) => (await api("screenshot", cam)).png;
  if (!DRY) { await api("add_objects", { items: plan }); await api("save"); }
  return { dry: DRY, before: before.length, after: (await api("status")).objects, placed: plan.map((p) => [p.name, p.x, p.y]), missed,
    shots: DRY ? {} : {
      top: await shot({ x: 372, y: 497, distance: 90, yaw: 0, pitch: 89 }),
      west: await shot({ x: 350, y: 499, distance: 40, yaw: 250, pitch: 22 }),
      east: await shot({ x: 392, y: 499, distance: 40, yaw: 90, pitch: 22 }),
      camp: await shot({ x: 338, y: 489, distance: 22, yaw: 200, pitch: 25 }),
      bridge: await shot({ x: 379, y: 499, distance: 60, yaw: 200, pitch: 18 }),
    } };
})();
