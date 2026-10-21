// Simulated mouse test for: electron . --open <map> --screenshot out.png --eval test/selection-demo.js
// Click, Shift+click (add, toggle off) and a Shift+drag rectangle; returns the selection after each step.
(async () => {
  const s = window.__studio, api = s.api;
  const canvas = document.querySelector("#viewport canvas");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (type, x, y, shift, target = canvas) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, shiftKey: shift, pointerId: 1, pointerType: "mouse" }));
  const click = async (p, shift) => { fire("pointerdown", p.x, p.y, shift); await wait(30); fire("pointerup", p.x, p.y, shift); await wait(60); };
  const selected = async () => (await api("status")).selected;

  await api("camera", { x: 128, y: 150, distance: 120, yaw: 0, pitch: 89 });
  await wait(400);
  // two objects far enough apart to click separately
  const vis = s.objects.map((o) => ({ id: o.id, ...s.screenPos(o.id) })).filter((p) => p.visible);
  const a = vis[0], b = vis.find((p) => Math.hypot(p.x - a.x, p.y - a.y) > 60);
  const out = {};
  await click(a, false); out.click = await selected();
  await click(b, true); out.shiftClickAdd = await selected();
  await click(a, true); out.shiftClickToggleOff = await selected();
  await click({ x: 5, y: 5 }, false); out.clickEmpty = await selected();
  const r = canvas.getBoundingClientRect();
  const x0 = r.left + r.width * 0.3, y0 = r.top + r.height * 0.3, x1 = r.left + r.width * 0.7, y1 = r.top + r.height * 0.7;
  fire("pointerdown", x0, y0, true); await wait(30);
  for (let i = 1; i <= 5; i++) { fire("pointermove", x0 + (x1 - x0) * i / 5, y0 + (y1 - y0) * i / 5, true, window); await wait(20); }
  fire("pointerup", x1, y1, true); await wait(80);
  out.rectangleCount = (await selected()).length;
  out.expected = { a: a.id, b: b.id };
  return out;
})();
