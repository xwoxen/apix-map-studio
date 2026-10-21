// Terrain brushes. A brush works on the model at a scene position (meters) and reports what it changed.
import * as THREE from "three";
import { ATTR_FLAGS } from "./terrain.js";

export const TOOLS = {
  raise: { label: "Zdvihnúť", hint: "Ctrl = znížiť" },
  lower: { label: "Znížiť", hint: "Ctrl = zdvihnúť" },
  smooth: { label: "Vyhladiť", hint: "" },
  flatten: { label: "Zarovnať", hint: "Alt + klik = vziať výšku" },
  texture: { label: "Textúra", hint: "Alt + klik = vziať textúru" },
  water: { label: "Voda", hint: "Ctrl = zmazať · Alt + klik = výška z terénu" },
  attr: { label: "Atribúty", hint: "Ctrl = zmazať" }
};

const falloff = (d, r) => { const t = 1 - d / r; return t <= 0 ? 0 : t * t * (3 - 2 * t); };

// opts: { tool, radius (m), strength 1..10, invert, flattenTo (raw), texture (index), waterLevel (raw), attrFlags }
export function paint(model, x, z, opts) {
  const changed = { keys: new Set(), parts: new Set() };
  const r = opts.radius;
  if (["raise", "lower", "smooth", "flatten"].includes(opts.tool)) {
    const rc = r / 2, cx = x / 2, cy = z / 2;
    const x0 = Math.max(0, Math.floor(cx - rc)), x1 = Math.min(model.widthCells, Math.ceil(cx + rc));
    const y0 = Math.max(0, Math.floor(cy - rc)), y1 = Math.min(model.depthCells, Math.ceil(cy + rc));
    const updates = [];
    const k = opts.strength / 10;
    for (let y = y0; y <= y1; y++) for (let xx = x0; xx <= x1; xx++) {
      const f = falloff(Math.hypot(xx - cx, y - cy), rc);
      if (!f) continue;
      const h = model.raw(xx, y);
      let v = h;
      if (opts.tool === "raise" || opts.tool === "lower") {
        const up = (opts.tool === "raise") !== Boolean(opts.invert);
        v = h + (up ? 1 : -1) * f * opts.strength * 14;            // up to ~0.7 m per step at full strength
      } else if (opts.tool === "smooth") {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += model.raw(xx + dx, y + dy);
        v = h + (s / 9 - h) * f * k;
      } else if (opts.flattenTo !== undefined) {
        v = h + (opts.flattenTo - h) * f * k;
      }
      if (Math.round(v) !== h) updates.push([xx, y, v]);
    }
    for (const [xx, y, v] of updates) model.setRaw(xx, y, v, changed.keys);
    if (updates.length) changed.parts.add("height");
  } else if (opts.tool === "texture") {
    const cx = x, cy = z;                                            // half cells are 1 m
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let xx = Math.floor(cx - r); xx <= Math.ceil(cx + r); xx++) {
      if (xx < 0 || y < 0 || xx >= model.widthCells * 2 || y >= model.depthCells * 2) continue;
      if (Math.hypot(xx + 0.5 - cx, y + 0.5 - cy) > r) continue;
      model.setTile(xx, y, opts.texture, changed.keys);
    }
    if (changed.keys.size) changed.parts.add("tile");
  } else if (opts.tool === "water") {
    const rc = r / 2, cx = x / 2, cy = z / 2;
    let any = false;
    for (let y = Math.floor(cy - rc); y <= Math.ceil(cy + rc); y++) for (let xx = Math.floor(cx - rc); xx <= Math.ceil(cx + rc); xx++) {
      if (xx < 0 || y < 0 || xx >= model.widthCells || y >= model.depthCells) continue;
      if (Math.hypot(xx + 0.5 - cx, y + 0.5 - cy) > rc) continue;
      if (model.setWater(xx, y, opts.invert ? null : opts.waterLevel)) any = true;
    }
    if (any) changed.parts.add("water");
  } else if (opts.tool === "attr") {
    for (let y = Math.floor(z - r); y <= Math.ceil(z + r); y++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
      if (xx < 0 || y < 0 || xx >= model.widthCells * 2 || y >= model.depthCells * 2) continue;
      if (Math.hypot(xx + 0.5 - x, y + 0.5 - z) > r) continue;
      model.setAttr(xx, y, opts.attrFlags, opts.invert, changed.keys);
    }
    if (changed.keys.size) changed.parts.add("attr");
  }
  return changed;
}

// Alt+click sampling: what a tool would take from the ground under the cursor.
export function sample(model, x, z, tool) {
  if (tool === "flatten") return { flattenTo: model.raw(Math.round(x / 2), Math.round(z / 2)) };
  if (tool === "water") return { waterLevel: Math.round(model.at(x, z) * 200) };
  if (tool === "texture") return { texture: model.tile(Math.floor(x), Math.floor(z)) };
  return {};
}

export const attrMask = (sel) => (sel.block ? ATTR_FLAGS.block : 0) | (sel.water ? ATTR_FLAGS.water : 0) | (sel.banpk ? ATTR_FLAGS.banpk : 0);

// Circle that hugs the terrain under the cursor.
export class BrushCursor {
  constructor() {
    const pts = new Float32Array(65 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd27a, depthTest: false, transparent: true }));
    this.line.renderOrder = 10;
    this.line.visible = false;
    this.line.frustumCulled = false;
  }
  update(model, x, z, radius) {
    const p = this.line.geometry.attributes.position.array;
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2, px = x + Math.cos(a) * radius, pz = z + Math.sin(a) * radius;
      p[i * 3] = px; p[i * 3 + 1] = model.at(px, pz) + 0.25; p[i * 3 + 2] = pz;
    }
    this.line.geometry.attributes.position.needsUpdate = true;
    this.line.visible = true;
  }
}
