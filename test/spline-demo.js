// Run on a COPY of a map (apix_farm_01 layout): electron . --open <copy> --eval test/spline-demo.js
// Raises a ridge, runs a road over it and a river beside it, places trees whose leaf maps have no file extension,
// checks the catalog data on library rows and returns screenshots as data URLs plus the measured profile.
(async () => {
  const s = window.__studio, api = s.api, out = {};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // clear the test area so the shapes are visible (the copy only)
  const inArea = (o) => o.x >= 90 && o.x <= 250 && o.y >= 320 && o.y <= 450;
  const clear = (await api("list_objects", { limit: 10000 })).objects.filter(inArea).map((o) => o.id);
  if (clear.length) await api("delete_objects", { ids: clear });
  // a ridge across the meadow west of the road (x 150-230, y 330-400)
  const ridge = []; for (let x = 150; x <= 230; x += 3) for (let y = 345; y <= 385; y += 3) ridge.push([x, y]);
  // an ~8 m hill (flatten to a fixed height, then smooth the flanks)
  await api("paint", { tool: "flatten", points: ridge.filter(([x, y]) => Math.hypot((x - 190) / 34, (y - 365) / 16) < 1), radius: 6, strength: 10, flattenTo: 172 });
  for (let k = 0; k < 3; k++) await api("paint", { tool: "smooth", points: ridge, radius: 10, strength: 10 });
  const before = (await api("terrain_height", { points: [[190, 365], [150, 365], [230, 365]] })).heights.map((h) => h.z);
  out.road = await api("spline", { kind: "road", points: [[140, 330], [165, 352], [190, 365], [215, 380], [240, 398]], width: 5, edge: 3, edgeTexture: "d:/ymir work/terrainmaps/a/grass/grass 02.dds", maxGrade: 0.12 });
  // grade along the road (control polyline, 4 m steps) after shaping
  const ctrl = [[140, 330], [165, 352], [190, 365], [215, 380], [240, 398]], pts = [];
  for (let i = 0; i + 1 < ctrl.length; i++) { const [a, b] = [ctrl[i], ctrl[i + 1]], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4); for (let k = 0; k < n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
  const hs = (await api("terrain_height", { points: pts })).heights.map((h) => h.z);
  let maxRise = 0; for (let i = 1; i < hs.length; i++) maxRise = Math.max(maxRise, Math.abs(hs[i] - hs[i - 1]) / Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  out.roadMaxGradeMeasured = +maxRise.toFixed(3);
  out.ridgeBefore = before;
  out.river = await api("spline", { kind: "river", points: [[100, 420], [130, 405], [160, 415], [190, 405], [220, 420]], width: 6, edge: 4, depth: 2 });
  const rv = (await api("terrain_height", { points: [[160, 415], [160, 420], [160, 425]] })).heights;
  out.riverCentre = rv.map((h) => ({ z: h.z, water: h.water, attr: h.attr }));
  // trees whose leaf map has no extension (render fix): Beech1, JapaneseMaple_Fall1, Pagoda2, MontereyCypress4, taoshu4
  out.trees = (await api("add_objects", { items: [[1353164984, 170], [4274493413, 178], [2376089798, 186], [1289994135, 194], [1732315986, 202]].map(([crc, x]) => ({ crc, x, y: 438 })) })).added.map((a) => a.name);
  await wait(9000);
  const lib = await window.studio.library();
  const well = lib.find((p) => p.crc === 1234504715), oak = lib.find((p) => p.crc === 78);
  out.libraryRow = { well: well && { size: well.size, warnings: well.warnings, usable: well.usable }, oak: oak && { size: oak.size, usable: oak.usable } };
  out.catalogQuery = (await api("catalog", { category: "tree", usable: true, limit: 3 })).total;
  const shot = async (cam) => (await api("screenshot", cam)).png;
  out.shots = {
    road: await shot({ x: 190, y: 365, distance: 45, yaw: 300, pitch: 22 }),
    roadLow: await shot({ x: 165, y: 352, distance: 16, yaw: 230, pitch: 12 }),
    river: await shot({ x: 160, y: 412, distance: 40, yaw: 20, pitch: 30 }),
    trees: await shot({ x: 186, y: 438, distance: 28, yaw: 0, pitch: 12 }),
    top: await shot({ x: 175, y: 385, distance: 120, yaw: 0, pitch: 85 }),
  };
  return out;
})();
