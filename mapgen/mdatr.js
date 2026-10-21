// Client collision data (<model>.mdatr, EterLib/AttributeData.cpp): static collision shapes in model space
// (centimeters, z up) plus height meshes. The game builds object collision from these shapes.

const TYPES = ["plane", "box", "sphere", "cylinder", "aabb", "obb"];
const DIMS = { plane: 2, box: 3, sphere: 1, cylinder: 2, aabb: 3, obb: 3 };

function parseMdatr(buf) {
  if (buf.toString("latin1", 0, 13) !== "AttributeData" || buf[13] !== 0) return null;
  let p = 14;
  const u32 = () => { const v = buf.readUInt32LE(p); p += 4; return v; };
  const f32 = () => { const v = buf.readFloatLE(p); p += 4; return v; };
  const shapes = [], heights = [];
  const nShapes = u32(), nHeights = u32();
  for (let i = 0; i < nShapes; i++) {
    const type = TYPES[u32()];
    if (!type) return null;
    const name = buf.toString("latin1", p, p + 32).replace(/\0.*$/s, ""); p += 32;
    const position = [f32(), f32(), f32()];
    const dims = Array.from({ length: DIMS[type] }, f32);
    const quat = [f32(), f32(), f32(), f32()];              // x, y, z, w
    shapes.push({ type, name, position, dims, quat });
  }
  for (let i = 0; i < nHeights; i++) {
    const name = buf.toString("latin1", p, p + 32).replace(/\0.*$/s, ""); p += 32;
    const n = u32();
    const vertices = [];
    for (let k = 0; k < n; k++) vertices.push([f32(), f32(), f32()]);
    heights.push({ name, vertices });
  }
  return { shapes, heights };
}

module.exports = { parseMdatr };
