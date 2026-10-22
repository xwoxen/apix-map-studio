// Run on a COPY of a map: electron . --open <copy> --eval test/lift-demo.js --screenshot <png>
// A lifted object keeps its height above the terrain when dragged by a horizontal gizmo handle;
// PageUp / Ctrl+PageDown / Home lift, nudge and ground the selection.
(async () => {
  const s = window.__studio, out = {};
  const o = s.objects.find((x) => x.crc && s.layer.nodes.get(x.id));
  const ground = () => s.groundAt(o.x / 100, -o.y / 100);
  const key = (key, extra = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...extra }));
  s.select(o.id);
  const z0 = o.z;
  key("PageUp"); key("PageUp");
  out.pageUp = +((o.z - z0) / 100).toFixed(2);                 // expect 1.0
  key("PageDown", { ctrlKey: true });
  out.ctrlPageDown = +((o.z - z0) / 100).toFixed(2);           // expect 0.9
  const liftBefore = o.z / 100 - ground();
  // drag along X like the gizmo does
  const g = s.gizmo, p = s.pivot;
  g.axis = "X";
  g.dispatchEvent({ type: "dragging-changed", value: true });
  p.position.x += 12;
  g.dispatchEvent({ type: "objectChange" });
  g.dispatchEvent({ type: "dragging-changed", value: false });
  out.liftBefore = +liftBefore.toFixed(2);
  out.liftAfterDrag = +(o.z / 100 - ground()).toFixed(2);       // expect == liftBefore (was 0 before the fix)
  key("Home");
  out.afterHome = +(o.z / 100 - ground()).toFixed(2);           // expect 0
  // z is stored in whole centimetres, so allow 1-2 cm of rounding
  const near = (a, b) => Math.abs(a - b) < 0.025;
  out.ok = near(out.pageUp, 1) && near(out.ctrlPageDown, 0.9) && near(out.liftAfterDrag, out.liftBefore) && near(out.afterHome, 0);
  return out;
})();
