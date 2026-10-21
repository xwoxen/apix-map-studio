// Free placement test: an object goes onto another object's top, lifts with PageUp, and lands in the air
// over the map when the cursor points at the sky.
(async () => {
  const s = window.__studio, api = s.api;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const canvas = document.querySelector("#viewport canvas");
  const at = (x, y, type) => canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
  const click = (x, y) => { at(x, y, "pointermove"); at(x, y, "pointerdown"); at(x, y, "pointerup"); };
  const key = (k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k }));
  const tent = s.objects.find((o) => o.crc === 68844411);
  await api("camera", { x: tent.x / 100, y: -tent.y / 100, distance: 40, yaw: 0, pitch: 60 });
  await wait(500);
  const lamp = 3979323067, out = {};
  const tp = s.screenPos(tent.id);
  await s.startPlacing(lamp);
  click(tp.x, tp.y);
  const onTent = s.objects.at(-1);
  out.onTentZ = +(onTent.z / 100).toFixed(2); out.groundThere = +s.groundAt(onTent.x / 100, -onTent.y / 100).toFixed(2);
  out.sitsOnObject = out.onTentZ - out.groundThere > 1;
  await s.startPlacing(lamp);
  key("PageUp"); key("PageUp"); key("PageUp"); key("PageUp");
  const r = canvas.getBoundingClientRect();
  click(r.left + r.width * 0.15, r.top + r.height * 0.8);
  const lifted = s.objects.at(-1);
  out.liftedBy = +(lifted.z / 100 - s.groundAt(lifted.x / 100, -lifted.y / 100)).toFixed(2);
  await api("camera", { x: 128, y: 128, distance: 60, yaw: 0, pitch: 5 });
  await wait(300);
  await s.startPlacing(lamp);
  click(r.left + r.width * 0.5, r.top + r.height * 0.05);       // sky
  const air = s.objects.at(-1);
  out.airPlaced = air !== lifted;
  out.airInsideMap = air.x >= 0 && air.x <= 25600 && -air.y >= 0 && -air.y <= 25600;
  key("Escape");
  out.issues = (await api("check_map", {})).issues.map((i) => i.kind);
  return out;
})();
