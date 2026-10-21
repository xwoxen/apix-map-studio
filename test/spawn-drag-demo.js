// Spawn drag test (copy of a map): dragging a spawn marker moves the spawn, one undo puts it back.
(async () => {
  const s = window.__studio, api = s.api;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const canvas = document.querySelector("#viewport canvas"), r = canvas.getBoundingClientRect();
  const ev = (x, y, type) => canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
  s.setMainMode("spawns"); await wait(500);
  const { added } = await api("add_spawns", { items: [{ vnum: 101, x: 60, y: 60, radius: 5 }] });
  await api("camera", { x: 60, y: 60, distance: 40, pitch: 89 });
  await wait(300);
  const sx = r.left + r.width / 2, sy = r.top + r.height / 2;      // the marker is under the screen centre
  ev(sx, sy, "pointermove"); ev(sx, sy, "pointerdown");
  for (let i = 1; i <= 10; i++) { ev(sx + i * 12, sy, "pointermove"); await wait(16); }
  window.dispatchEvent(new PointerEvent("pointerup", { clientX: sx + 120, clientY: sy, button: 0 }));
  ev(sx + 120, sy, "pointerup");
  const moved = (await api("list_spawns")).spawns.find((x) => x.id === added[0]);
  await api("undo");
  const back = (await api("list_spawns")).spawns.find((x) => x.id === added[0]);
  return { movedTo: [Math.round(moved.x), Math.round(moved.y)], movedEast: moved.x - 60 > 2, undoBack: [Math.round(back.x), Math.round(back.y)] };
})();
