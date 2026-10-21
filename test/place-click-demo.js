// Simulated mouse test: pick an object in the library, place it, click away, then click the new object.
(async () => {
  const s = window.__studio, api = s.api;
  const canvas = document.querySelector("#viewport canvas");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (type, x, y, target = canvas) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 1, pointerType: "mouse" }));
  const click = async (x, y) => { fire("pointermove", x, y); await wait(30); fire("pointerdown", x, y); await wait(30); fire("pointerup", x, y); await wait(80); };
  const out = {};
  await api("camera", { x: 60, y: 200, distance: 60, yaw: 0, pitch: 60 });
  await wait(400);
  const li = [...document.querySelectorAll("#lib-list [data-crc]")].find((el) => /stonelight|lantern|light/i.test(el.textContent)) || document.querySelector("#lib-list [data-crc]");
  out.libraryItem = li.querySelector(".name").textContent;
  li.click();
  await wait(2500);
  const r = canvas.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const before = s.objects.length;
  await click(cx, cy);
  out.placed = s.objects.length - before;
  const placed = s.objects[s.objects.length - 1];
  out.afterPlaceSelected = (await api("status")).selected;
  await click(r.left + 10, r.top + 10);
  out.afterClickAway = (await api("status")).selected;
  await wait(1500);
  const p = s.screenPos(placed.id);
  out.screenPos = p;
  await click(p.x, p.y);
  out.afterClickOnNew = (await api("status")).selected;
  out.pickNew = s.pickAt(p.x, p.y).slice(0, 4);
  out.nodeNew = s.nodeInfo(placed.id);
  out.pickAtBox = s.pickAt(out.nodeNew.boxScreen.x, out.nodeNew.boxScreen.y).slice(0, 3);
  const old = s.objects.find((o) => o.crc === placed.crc && o.id !== placed.id);
  if (old) { const q = s.screenPos(old.id); out.nodeOld = s.nodeInfo(old.id); out.pickOld = q.visible ? s.pickAt(q.x, q.y).slice(0, 3) : "not visible"; }
  out.newId = placed.id;
  return out;
})();
