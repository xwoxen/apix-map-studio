// Ambience and dungeon blocks (copy of a map): a sound ambience gets range rings and is saved to
// AreaAmbienceData.txt with its range, not to AreaData.txt; a dungeon block loads its real model.
(async () => {
  const s = window.__studio, api = s.api;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const amb = (await api("search_library", { query: "birds", type: "Ambience", limit: 5 })).items[0];
  const block = (await api("search_library", { query: "", type: "DungeonBlock", limit: 5 })).items[0];
  const r = await api("add_objects", { items: [{ crc: amb.crc, x: 60, y: 60 }, { crc: block.crc, x: 90, y: 60 }] });
  await wait(4000);
  const ids = r.added || r.ids || s.objects.slice(-2).map((o) => o.id);
  const ambObj = s.objects.find((o) => o.crc === amb.crc), blockObj = s.objects.find((o) => o.crc === block.crc);
  s.select(ambObj.id); await wait(200);
  const rangeField = document.getElementById("f-range");
  rangeField.value = 35; rangeField.dispatchEvent(new Event("change"));
  await wait(200);
  const node = s.nodeInfo(blockObj.id);
  const ambNode = s.layer.nodes.get(ambObj.id), outer = ambNode.getObjectByName("outer");
  await api("save");
  await api("camera", { x: 75, y: 75, distance: 70, pitch: 55 });
  return { amb: amb.name, block: block.name, outerRadius: outer && +outer.scale.x.toFixed(1), rangeSaved: s.objects.find((o) => o.id === ambObj.id).ambience, blockMeshes: node.meshes, blockBox: node.boxSize };
})();
