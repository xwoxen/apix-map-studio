// Placing extras: the ghost follows once per frame with a footprint outline on the ground, Shift+R turns it by
// 15°, placed objects show up under "Posledné", and Shift+R rounds a selected object's rotation to 15°.
(async () => {
  const s = window.__studio, api = s.api;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const canvas = document.querySelector("#viewport canvas"), r = canvas.getBoundingClientRect();
  const at = (x, y, type) => canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
  const key = (k, shift) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey: !!shift }));
  await api("camera", { x: 128, y: 200, distance: 50, pitch: 60 });
  await s.startPlacing(3979323067);
  for (let i = 0; i < 20; i++) at(r.left + r.width / 2 + i, r.top + r.height / 2, "pointermove");
  await wait(200);
  const out = { footprintVisible: s.scene.children.some((o) => o.isLineLoop && o.visible) };
  key("r", true); key("r", true);
  at(r.left + r.width / 2, r.top + r.height / 2, "pointerdown"); at(r.left + r.width / 2, r.top + r.height / 2, "pointerup");
  const placed = s.objects.at(-1);
  out.placedYaw = placed.yaw;
  document.querySelector('#lib-types [data-type="Posledné"]').click();
  out.recentFirst = Number(document.querySelector("#lib-list li[data-crc]").dataset.crc) === 3979323067;
  await api("update_objects", { items: [{ id: placed.id, yaw: 52 }] });
  s.select(placed.id); key("r", true);
  out.snappedYaw = s.objects.find((o) => o.id === placed.id).yaw;
  return out;
})();
