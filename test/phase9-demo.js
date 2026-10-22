// Run on a finished map (scratch copy): node test/run-eval.js <map> test/phase9-demo.js <out>
// map check with the object budget / reachability rules, the reachability picture, a dry forest edge, face + ground:min placement.
(async () => {
  const api = window.__studio.api;
  const check = await api("check_map");
  const reach = await api("reachability", { png: true });
  const png = reach.png; delete reach.png;
  const fe = await api("forest_edge", { items: [{ name: "WhitePine1" }], dryRun: true });
  const [a] = (await api("add_objects", { items: [{ name: "wolf_statue", x: 140, y: 420, face: [130, 430], ground: "min" }] })).added;
  return { check: check.issues.map((i) => `${i.level} ${i.kind}: ${i.message}`), reach, forestDry: fe, faced: { yaw: a.yaw }, shots: { reach: png } };
})();
