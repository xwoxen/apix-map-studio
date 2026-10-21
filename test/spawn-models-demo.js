// Spawn models test (copy of apix_pvp_arena, meadow west of the arena): spawn markers show the monster's own model playing its wait motion.
(async () => {
  const s = window.__studio, api = s.api;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  s.setMainMode("spawns"); await wait(500);
  const { added } = await api("add_spawns", { items: [{ vnum: 101, x: 40, y: 150, radius: 6, count: 5 }, { vnum: 20016, type: "npc", x: 50, y: 150 }, { vnum: 103, x: 60, y: 150, radius: 6 }] });
  for (let i = 0; i < 60; i++) { await wait(500); if (s.spawnLayer.mixers.size >= 2) break; }
  await api("camera", { x: 50, y: 152, distance: 20, yaw: 0, pitch: 25 });
  await wait(1200);
  return { added: added.length, animated: s.spawnLayer.mixers.size, withModel: [...s.spawnLayer.nodes.values()].filter((g) => g.children.some((c) => c.userData.model)).length };
})();
