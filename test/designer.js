// designer helpers on an in-memory terrain: findSpot keeps off blocked / steep / path cells and away from taken spots.
const assert = require("assert");
(async () => {
  const D = await import("../renderer/designer.js");
  const N = 128, h = new Float64Array((N + 1) * (N + 1)).fill(170 * 200), tile = new Uint8Array(256 * 256).fill(5), attr = new Uint8Array(256 * 256);
  for (let y = 0; y < 256; y++) for (let x = 120; x < 136; x++) tile[y * 256 + x] = 1;      // a north-south path (texture 1)
  for (let y = 0; y < 40; y++) for (let x = 0; x < 256; x++) attr[y * 256 + x] = 1;        // blocked strip in the north
  for (let y = 0; y <= N; y++) for (let x = 90; x <= N; x++) if (x < 100) h[y * (N + 1) + x] = (170 + (x - 90) * 2) * 200;   // steep band at x 180..200 m
  const model = { widthCells: N, depthCells: N, raw: (x, y) => h[Math.max(0, Math.min(N, y)) * (N + 1) + Math.max(0, Math.min(N, x))],
    at(x, z) { const cx = x / 2, cy = z / 2, x0 = Math.floor(cx), y0 = Math.floor(cy), fx = cx - x0, fy = cy - y0; return (this.raw(x0, y0) * (1 - fx) * (1 - fy) + this.raw(x0 + 1, y0) * fx * (1 - fy) + this.raw(x0, y0 + 1) * (1 - fx) * fy + this.raw(x0 + 1, y0 + 1) * fx * fy) / 200; },
    tile: (x, y) => tile[Math.max(0, Math.min(255, y)) * 256 + Math.max(0, Math.min(255, x))], attr: (x, y) => attr[Math.max(0, Math.min(255, y)) * 256 + Math.max(0, Math.min(255, x))] };
  const paths = D.pathTextureIndices([{ index: 1, file: "d:/x/field 01.dds" }, { index: 5, file: "d:/x/grass 01.dds" }]);
  assert.deepStrictEqual([...paths], [1]);
  const taken = [];
  const a = D.findSpot(model, taken, { near: [128, 100], radius: 15, offPath: true, pathTextures: paths, footprint: 1 });
  assert.ok(a && (a.x + 1 < 120 || a.x - 1 >= 136), "footprint off the path: " + JSON.stringify(a));
  const b = D.findSpot(model, taken, { near: [a.x, a.y], radius: 6, footprint: 1, clearance: 1 });
  assert.ok(b && Math.hypot(b.x - a.x, b.y - a.y) >= 3 - 1e-6, "kept apart from the first");
  const c = D.findSpot(model, [], { near: [60, 30], radius: 14 });
  assert.ok(c && c.y >= 40, "out of the blocked strip");
  assert.strictEqual(D.findSpot(model, [], { near: [190, 150], radius: 2, maxSlope: 16 }), null, "steep band refused");
  const onBlocked = D.findSpot(model, [], { near: [60, 45], radius: 8, onBlocked: true });
  assert.ok(onBlocked && onBlocked.y < 40, "onBlocked looks for blocked ground");
  console.log("ok: designer findSpot (path, spacing, blocked, slope)");
})().catch((e) => { console.error(e); process.exit(1); });
