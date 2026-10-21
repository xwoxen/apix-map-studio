// Gizmo drag test: the centre handle (XYZ) lifts an object freely, the X arrow keeps it on the ground.
(async () => {
  const s = window.__studio, api = s.api, g = s.gizmo, pivot = s.pivot;
  const o = s.objects.find((x) => x.crc === 459116056) || s.objects[0];
  s.select(o.id);
  const drag = (axis, move) => {
    g.axis = axis;
    g.dispatchEvent({ type: "dragging-changed", value: true });
    move(pivot.position);
    g.dispatchEvent({ type: "objectChange" });
    g.dispatchEvent({ type: "dragging-changed", value: false });
    g.axis = null;
  };
  const z = () => s.objects.find((x) => x.id === o.id).z / 100;
  const out = { id: o.id, start: +z().toFixed(2) };
  drag("XYZ", (p) => { p.y += 5; });
  out.afterCentreUp5 = +z().toFixed(2);
  drag("X", (p) => { p.x += 3; });
  const info = (await api("list_objects", { limit: 100000 })).objects.find((x) => x.id === o.id);
  out.afterXArrow = +z().toFixed(2);
  out.groundThere = info.ground;
  out.centreIsFree = Math.abs(out.afterCentreUp5 - out.start - 5) < 0.05;
  out.xArrowSnaps = Math.abs(out.afterXArrow - info.ground) < 0.05;
  return out;
})();
