// Effects test (copy of apix_pvp_arena): background effects (.mse) play as particles in the map and their library
// thumbnails show the particles instead of a yellow box.
(async () => {
  const s = window.__studio, api = s.api;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const lib = (await api("search_library", { query: "fire", type: "Effect", limit: 80 })).items;
  const pickName = (re) => { const p = lib.find((x) => re.test(x.name)); return p && p.crc; };
  const all = (await api("search_library", { query: "", type: "Effect", limit: 400 })).items;
  const crcs = [pickName(/fire_camp1/), pickName(/fire_blue1/), pickName(/fire_general_obj_campfire/), ...all.filter((p) => /^(blood00|bluegrass)$/.test(p.name)).map((p) => p.crc)].filter(Boolean);
  const items = crcs.map((crc, i) => ({ crc, x: 120 + i * 5, y: 190 }));
  const r = await api("add_objects", { items });
  await wait(4000);
  let particles = 0, systems = 0;
  s.scene.traverse((o) => { if (o.isPoints) { systems++; particles += o.geometry.drawRange.count; } });
  await api("camera", { x: 130, y: 190, distance: 12, yaw: 0, pitch: 20 });
  document.querySelector('#lib-types [data-type="Effect"]').click();
  await wait(6000);
  const thumbs = [...document.querySelectorAll("#lib-list img.thumb")].slice(0, 8).map((i) => Boolean(i.getAttribute("src")));
  return { placed: (r.added || r.ids || []).length || items.length, crcs, systems, particles, thumbs };
})();
