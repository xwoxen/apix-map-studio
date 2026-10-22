// Run on a blank 2x1 map: node test/run-eval.js <blank map> test/import-demo.js <out> --inplace
// Imports the same 200 m piece of metin2_map_a1 (village with the guest house) twice: unrotated on the left, rotated
// 90 degrees clockwise on the right. Buildings, paths and terrain must turn together (checked on the top-down shot).
(async () => {
  const api = window.__studio.api, out = {};
  const area = [500, 520, 700, 720];
  out.left = await api("import_region", { source: "metin2_map_a1", area, to: [20, 30], rotate: 0, blend: 12 });
  out.right = await api("import_region", { source: "metin2_map_a1", area, to: [280, 30], rotate: 1, blend: 12 });
  const shot = async (cam) => (await api("screenshot", cam)).png;
  out.shots = { top: await shot({ x: 256, y: 128, distance: 330, yaw: 0, pitch: 89 }), left: await shot({ x: 120, y: 130, distance: 70, yaw: 0, pitch: 35 }), right: await shot({ x: 380, y: 130, distance: 70, yaw: 90, pitch: 35 }) };
  for (const k of ["left", "right"]) delete out[k].ids;
  out.check = await (async () => {
  const api = window.__studio.api;
  const objs = (await api("list_objects", { limit: 10000 })).objects;
  const L = objs.filter((o) => o.x < 256), Rt = objs.filter((o) => o.x >= 256);
  let matched = 0, yawOk = 0, worst = 0;
  for (const o of L) {
    const a = o.x - 20, b = o.y - 30, ex = 280 + (200 - b), ey = 30 + a;
    const hit = Rt.filter((p) => p.crc === o.crc).sort((p, q) => Math.hypot(p.x - ex, p.y - ey) - Math.hypot(q.x - ex, q.y - ey))[0];
    if (!hit) continue;
    const d = Math.hypot(hit.x - ex, hit.y - ey);
    if (d < 0.6) { matched++; worst = Math.max(worst, d); const dy = ((hit.yaw - (o.yaw - 90)) % 360 + 360) % 360; if (dy < 1 || dy > 359) yawOk++; }
  }
  const pairs = [[60, 80], [150, 40], [100, 170]].map(([a, b]) => [[20 + a, 30 + b], [280 + 200 - b, 30 + a]]);
  const h = await api("terrain_height", { points: pairs.flat() });
  const dh = pairs.map((_, i) => +(h.heights[2 * i].z - h.heights[2 * i + 1].z).toFixed(2));
  return { left: L.length, right: Rt.length, matched, yawOk, worstDist: +worst.toFixed(2), terrainDiff: dh };
})();
  return out;
})();

