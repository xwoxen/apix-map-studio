// SpeedTree test (copy of apix_pvp_arena): trees use real SpeedTree geometry from tools/spt2json (bark, fronds,
// camera-facing leaf cards) and the library shows them in the thumbnails.
(async () => {
  const s = window.__studio, api = s.api;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && s.model && (await api("status")).modelsLoading > 0; i++) await wait(500);
  let leafClouds = 0, barkMeshes = 0, verts = 0;
  s.layer.root.traverse((o) => { if (o.isPoints) leafClouds++; if (o.isMesh && o.geometry.index) { barkMeshes++; verts += o.geometry.attributes.position.count; } });
  await api("camera", { x: 128, y: 40, distance: 30, yaw: 0, pitch: 8 });
  document.querySelector('#lib-types [data-type="Tree"]').click();
  await wait(8000);
  const thumbs = [...document.querySelectorAll("#lib-list img.thumb")].slice(0, 6).map((i) => Boolean(i.getAttribute("src")));
  return { leafClouds, barkMeshes, verts, thumbs };
})();
