// "Do hry…" test (copy of apix_pvp_arena): the dialog suggests the arena's existing slot, and the export renders
// minimap/atlas/shadows and stages server + client files with the town and spawns from the Spawns tab.
(async () => {
  const s = window.__studio, api = s.api;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById("btn-game").click();
  await wait(800);
  const out = { dialogOpen: document.getElementById("game-dlg").open, index: Number(document.getElementById("gx-index").value), base: [Number(document.getElementById("gx-x").value), Number(document.getElementById("gx-y").value)] };
  document.getElementById("game-dlg").close();
  const r = await api("game_export", { index: out.index, base: out.base, goto: "arena" });
  Object.assign(out, { staged: r.out, files: r.files, town: r.town, shadows: r.shadows, spawns: r.spawns, objectCells: r.serverAttr.cells.object, steps: r.deploy.server.length + r.deploy.client.length });
  // the dialog's own submit shows the report
  document.getElementById("btn-game").click(); await wait(800);
  document.getElementById("game-form").requestSubmit();
  for (let i = 0; i < 60 && !document.getElementById("report").open; i++) await wait(500);
  out.report = document.getElementById("report-body").innerText.slice(0, 400);
  return out;
})();
