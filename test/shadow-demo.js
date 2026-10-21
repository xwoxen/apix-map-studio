// Shadow export test (run on a copy of a map): Export bakes shadowmap.raw/.dds per terrain from the environment's
// sun; part of the ground must end up in shadow and most of it lit.
(async () => {
  const s = window.__studio, api = s.api;
  const r = await api("export", {});
  const light = s.renderShadow(0, 0);
  let dark = 0; for (const v of light) if (v < 0.5) dark++;
  return { shadows: r.shadows, litShare: r.litShare, darkTexels: dark, files: r.files.filter((f) => /shadow/.test(f)) };
})();
