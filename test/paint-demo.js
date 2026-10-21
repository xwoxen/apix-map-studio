// Scripted brush test for: electron . --open <copy of a map> --screenshot out.png --eval test/paint-demo.js
// Raises a ridge, paints a road, floods a pond, marks no-PvP, saves, then checks the model state.
(async () => {
  const s = window.__studio;
  const m = s.model;
  s.setMainMode("terrain");
  const line = (x0, z0, x1, z1, n) => Array.from({ length: n }, (_, i) => [x0 + (x1 - x0) * i / (n - 1), z0 + (z1 - z0) * i / (n - 1)]);

  const before = m.raw(40, 100);
  s.stroke(line(60, 200, 110, 200, 30), { tool: "raise", radius: 10, strength: 10 });
  s.stroke(line(60, 200, 110, 200, 30), { tool: "raise", radius: 10, strength: 10 });
  s.stroke(line(60, 200, 110, 200, 30), { tool: "smooth", radius: 12, strength: 8 });
  const after = m.raw(40, 100);

  const road = await s.addTexture("d:/ymir work/terrainmaps/a/field/field 01.dds");
  s.stroke(line(150, 60, 150, 140, 40), { tool: "texture", radius: 3, texture: road });

  const level = m.raw(95, 30) + 300;
  s.stroke([[190, 60], [195, 64]], { tool: "water", radius: 14, waterLevel: level });
  s.stroke([[150, 100]], { tool: "attr", radius: 6, attr: { block: false, water: false, banpk: true } });

  const result = {
    ridgeRaised: after - before,
    roadTile: m.tile(150, 100) === road,
    water: m.waterLevel(95, 31) === level,
    banpk: (m.attr(150, 100) & 4) === 4,
    dirtyChunks: m.dirty.size
  };
  await s.save();
  result.savedClean = !m.isDirty;
  s.setTool("attr");
  return result;
})();
