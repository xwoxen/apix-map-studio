// Zones and town test (copy of apix_pvp_arena): Z shows the server attribute overlay with its legend, the town is
// set by a click in the Spawns tab, and the map check warns about a town in a PvP zone and spawns on blocked cells.
(async () => {
  const s = window.__studio, api = s.api;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const canvas = document.querySelector("#viewport canvas"), r = canvas.getBoundingClientRect();
  const at = (x, y, type) => canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
  const click = (x, y) => { at(x, y, "pointermove"); at(x, y, "pointerdown"); at(x, y, "pointerup"); };
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "z" }));
  const out = { legend: !document.getElementById("zones-legend").hidden, overlay: s.model && true };
  s.setMainMode("spawns"); await wait(800);
  await api("camera", { x: 128, y: 182, distance: 40, pitch: 89 });
  document.getElementById("sp-town").click();
  click(r.left + r.width / 2, r.top + r.height / 2);
  out.town = (await api("list_spawns")).town;
  let kinds = (await api("check_map")).issues.map((i) => i.kind);
  out.townSafe = !kinds.includes("town_pvp") && !kinds.includes("town_blocked");
  await api("set_town", { x: 30, y: 30 });                       // meadow: PvP
  await api("add_spawns", { items: [{ vnum: 101, x: 128, y: 128 - 23, radius: 3 }] });   // on the blocked wall ring
  kinds = (await api("check_map")).issues.map((i) => i.kind);
  out.warnsTownPvp = kinds.includes("town_pvp");
  out.warnsSpawnBlocked = kinds.includes("spawn_blocked");
  await api("undo"); await api("undo");
  await api("camera", { x: 128, y: 150, distance: 160, pitch: 60 });
  return out;
})();
