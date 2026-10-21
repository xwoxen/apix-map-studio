// Spawns test (run on a copy of apix_pvp_arena): a click in spawn mode places the chosen monster, the API adds
// a group and an NPC, undo/redo work, and Ctrl+S writes <map>/_studio/spawns.json.
(async () => {
  const s = window.__studio, api = s.api;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const canvas = document.querySelector("#viewport canvas");
  const at = (x, y, type) => canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
  const click = (x, y) => { at(x, y, "pointermove"); at(x, y, "pointerdown"); at(x, y, "pointerup"); };
  s.setMainMode("spawns");
  await wait(1500);
  const out = { mobsListed: document.querySelectorAll("#sp-mobs li[data-vnum]").length };
  document.querySelector('#sp-mobs li[data-vnum="101"]') ? document.querySelector('#sp-mobs li[data-vnum="101"]').click() : (document.getElementById("sp-vnum").value = 101);
  document.getElementById("sp-count").value = 7; document.getElementById("sp-radius").value = 12;
  await api("camera", { x: 60, y: 200, distance: 60, pitch: 70 });
  await wait(300);
  const r = canvas.getBoundingClientRect();
  click(r.left + r.width / 2, r.top + r.height / 2);
  const first = (await api("list_spawns")).spawns[0];
  out.clicked = first && { vnum: first.vnum, count: first.count, radius: first.radius, x: Math.round(first.x), y: Math.round(first.y), name: first.name };
  await api("add_spawns", { items: [{ type: "g", vnum: 101, x: 200, y: 200, radius: 15 }, { type: "npc", vnum: 20016, x: 128, y: 188 }] });
  out.afterAdd = (await api("list_spawns")).spawns.length;
  await api("undo"); out.afterUndo = (await api("list_spawns")).spawns.length;
  await api("redo"); out.afterRedo = (await api("list_spawns")).spawns.length;
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
  await wait(1500);
  out.unsavedAfterSave = (await api("status")).unsaved;
  await api("camera", { x: 100, y: 190, distance: 90, pitch: 55 });
  return out;
})();
