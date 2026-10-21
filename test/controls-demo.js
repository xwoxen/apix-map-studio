// Simulated input test: WASD/QE camera movement, left-drag rectangle without Shift, click to select.
(async () => {
  const s = window.__studio, api = s.api;
  const canvas = document.querySelector("#viewport canvas");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const key = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
  const hold = async (k, ms) => { key("keydown", k); await wait(ms); key("keyup", k); await wait(50); };
  const fire = (type, x, y, target = canvas, shift = false) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, shiftKey: shift, pointerId: 1, pointerType: "mouse" }));
  const target = async () => (await api("camera", {})).position;
  const out = {};

  await api("camera", { x: 128, y: 150, distance: 80, yaw: 0, pitch: 50 });
  await wait(300);
  out.start = await target();
  await hold("w", 600); out.afterW = await target();      // north = smaller y (scene z)
  await hold("d", 600); out.afterD = await target();      // east = larger x
  const h0 = (await target())[1];
  await hold("e", 500); out.wentUp = (await target())[1] > h0;
  await hold("q", 500); out.wentDown = (await target())[1] < h0 + 50;
  out.movedNorth = out.afterW[2] < out.start[2];
  out.movedEast = out.afterD[0] > out.afterW[0];

  await api("camera", { x: 128, y: 150, distance: 120, yaw: 0, pitch: 89 });
  await wait(300);
  const r = canvas.getBoundingClientRect();
  const x0 = r.left + r.width * 0.35, y0 = r.top + r.height * 0.35, x1 = r.left + r.width * 0.65, y1 = r.top + r.height * 0.65;
  fire("pointerdown", x0, y0); await wait(30);
  for (let i = 1; i <= 5; i++) { fire("pointermove", x0 + (x1 - x0) * i / 5, y0 + (y1 - y0) * i / 5, window); await wait(20); }
  fire("pointerup", x1, y1); await wait(100);
  out.rectangleNoShift = (await api("status")).selected.length;

  const vis = s.objects.map((o) => ({ id: o.id, ...s.screenPos(o.id) })).filter((p) => p.visible);
  const a = vis[Math.floor(vis.length / 2)];
  fire("pointerdown", a.x, a.y); await wait(30); fire("pointerup", a.x, a.y); await wait(100);
  out.clickSelects = (await api("status")).selected;
  out.clickedId = a.id;
  return out;
})();
