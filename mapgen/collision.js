// Object footprints for server_attr OBJECT (128): the client's collision shapes from <model>.mdatr, placed like
// Map Studio places the model (model cm z-up -> rotate yaw -> AreaData position), sampled onto 0.5 m cells.
// Only the parts a character can bump into count (from the ground up to REACH above the object's base).
// Trees have no .mdatr: their trunk counts. Models without collision data are reported, not guessed.

const fs = require("fs");
const { getLibrary, resolveAsset } = require("../assets");
const { parseMdatr } = require("./mdatr");

const CELL = 0.5;          // m, server attribute cell
const REACH = 2.2;         // m above the object's base that still blocks walking
const STEP = 0.2;          // m, sampling step over shape surfaces and areas

// model space (cm, z up) -> map meters (x east, y south, h up) for an AreaData object
function placer(o) {
  const yaw = (o.yaw || 0) * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw);
  const ox = o.x / 100, oy = -o.y / 100, oh = o.z / 100;
  return ([x, y, z]) => {
    // three.js chain used by the renderer: (x, z, -y) * 0.01, then rotation about the up axis by yaw
    const sx = x / 100, sz = -y / 100;
    return [ox + sx * c + sz * s, oy - sx * s + sz * c, oh + z / 100];
  };
}

function rotate(q, [x, y, z]) {
  const [qx, qy, qz, qw] = q;
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}

// points (model cm) covering a shape's surface or volume, dense enough for 0.5 m cells
function shapePoints(sh) {
  const pts = [], st = STEP * 100, [px, py, pz] = sh.position;
  const range = (a, b) => { const out = []; for (let v = a; v <= b + 1e-6; v += st) out.push(v); if (out[out.length - 1] < b) out.push(b); return out; };
  if (sh.type === "plane") {
    const [w, l] = sh.dims;
    for (const u of range(-w / 2, w / 2)) for (const v of range(-l / 2, l / 2)) {
      const r = rotate(sh.quat, [u, v, 0]);
      pts.push([px + r[0], py + r[1], pz + r[2]]);
    }
  } else if (sh.type === "cylinder" || sh.type === "sphere") {
    const r = sh.dims[0], z0 = sh.type === "sphere" ? pz - r : pz;
    for (const u of range(-r, r)) for (const v of range(-r, r)) if (u * u + v * v <= r * r) pts.push([px + u, py + v, z0]);
  } else {                                                           // box / aabb / obb: half extents
    const [hx, hy, hz] = sh.dims;
    for (const u of range(-hx, hx)) for (const v of range(-hy, hy)) {
      const r = sh.type === "aabb" ? [u, v, -hz] : rotate(sh.quat, [u, v, -hz]);
      pts.push([px + r[0], py + r[1], pz + r[2]]);
    }
  }
  return pts;
}

const shapeCache = new Map();
function collisionFor(crc) {
  if (shapeCache.has(crc)) return shapeCache.get(crc);
  const p = getLibrary().get(crc >>> 0);
  let out;
  if (!p) out = { kind: "unknown" };
  else if (/^tree$/i.test(p.type)) out = { kind: "tree", radius: Math.max(0.3, (p.treeSize || 1000) / 100 * 0.025) };
  else if (!/\.gr2$/i.test(p.model)) out = { kind: "none" };          // effects, ambience
  else {
    const f = resolveAsset(p.model.replace(/\.gr2$/i, ".mdatr"));
    const data = f && parseMdatr(fs.readFileSync(f));
    out = !f ? { kind: "missing", name: p.name } : !data ? { kind: "bad", name: p.name } : { kind: "shapes", name: p.name, points: data.shapes.flatMap(shapePoints) };
  }
  shapeCache.set(crc, out);
  return out;
}

// cells: Set of "cx,cy" (0.5 m cells from the map's NW corner); report counts what each object contributed
function objectCells(objects, widthM, heightM) {
  const cells = new Set(), report = { objects: objects.length, withShapes: 0, trees: 0, noCollision: 0, missingData: {} };
  const mark = (x, y) => { if (x >= 0 && y >= 0 && x < widthM && y < heightM) cells.add(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`); };
  for (const o of objects) {
    const c = collisionFor(o.crc);
    const place = placer(o), base = o.z / 100;
    if (c.kind === "tree") {
      report.trees++;
      const [x, y] = place([0, 0, 0]);
      for (let u = -c.radius; u <= c.radius + 1e-6; u += CELL / 2) for (let v = -c.radius; v <= c.radius + 1e-6; v += CELL / 2) if (u * u + v * v <= c.radius * c.radius) mark(x + u, y + v);
    } else if (c.kind === "shapes" && c.points.length) {
      report.withShapes++;
      for (const pt of c.points) { const [x, y, h] = place(pt); if (h <= base + REACH) mark(x, y); }
    } else {
      report.noCollision++;
      if (c.kind === "missing" || c.kind === "bad") report.missingData[c.name] = (report.missingData[c.name] || 0) + 1;
    }
  }
  return { cells, report };
}

module.exports = { objectCells, placer, shapePoints, REACH, CELL };
