// Editable terrain: data model (heights, texture tiles, water, server attributes) and its three.js view.
// Scene units are meters: scene x = cell x * 2, scene z = cell y * 2, scene y = raw height / 200.
// Global grids: cells (2 m, heights/water), half cells (1 m, tiles), attr pixels (1 m).
import * as THREE from "three";
import { DDSLoader } from "three/addons/loaders/DDSLoader.js";

const CELLS = 128, RAW = 131, TILES = 258, ATTR = 256;
export const MAX_SLOTS = 12;                // textures per terrain chunk (12 + 3 masks + attr = 16 samplers)
export const ATTR_FLAGS = { block: 1, water: 2, banpk: 4 };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function decodeWater(buf) {
  const idx = new Uint8Array(CELLS * CELLS).fill(255);
  const levels = [];
  if (buf && buf.length >= 7 + CELLS * CELLS) {
    idx.set(buf.subarray(7, 7 + CELLS * CELLS));
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = 0; i < buf[6]; i++) levels.push(view.getInt32(7 + CELLS * CELLS + i * 4, true));
  }
  return { idx, levels };
}

export class TerrainModel {
  constructor(map) {
    this.size = map.size;
    this.textures = map.textures.map((t) => ({ ...t }));
    this.textureSetFile = map.textureSetFile;
    this.textureSetDirty = false;
    this.chunks = new Map();
    for (const t of map.terrains) {
      const height = new Uint16Array(RAW * RAW).fill(32767);
      if (t.height) height.set(new Uint16Array(t.height.buffer.slice(t.height.byteOffset, t.height.byteOffset + t.height.byteLength)));
      const tile = new Uint8Array(TILES * TILES).fill(this.textures[0] ? this.textures[0].index : 1);
      if (t.tile) tile.set(t.tile.subarray(0, TILES * TILES));
      const attr = new Uint8Array(ATTR * ATTR);
      if (t.attr && t.attr.length >= 6 + ATTR * ATTR) attr.set(t.attr.subarray(6, 6 + ATTR * ATTR));
      this.chunks.set(t.key, { key: t.key, tx: t.tx, ty: t.ty, height, tile, water: decodeWater(t.water), attr });
    }
    this.dirty = new Map();     // key -> Set of parts
    this.stroke = null;
  }

  chunkAt(tx, ty) { return this.chunks.get(String(tx).padStart(3, "0") + String(ty).padStart(3, "0")); }
  get widthCells() { return this.size[0] * CELLS; }
  get depthCells() { return this.size[1] * CELLS; }

  /* stroke bookkeeping: snapshot each chunk before its first change, mark parts dirty */
  beginStroke() { this.stroke = new Map(); }
  touch(c, part) {
    if (this.stroke && !this.stroke.has(c.key)) this.stroke.set(c.key, cloneChunk(c));
    if (!this.dirty.has(c.key)) this.dirty.set(c.key, new Set());
    this.dirty.get(c.key).add(part);
  }
  endStroke() { const s = this.stroke; this.stroke = null; return s && s.size ? s : null; }
  // Puts saved chunk states back and returns the states they replaced (for redo).
  restore(snap) {
    const current = new Map();
    for (const [key, state] of snap) {
      const c = this.chunks.get(key);
      current.set(key, cloneChunk(c));
      c.height.set(state.height); c.tile.set(state.tile); c.attr.set(state.attr);
      c.water = { idx: state.water.idx.slice(), levels: state.water.levels.slice() };
      if (!this.dirty.has(key)) this.dirty.set(key, new Set());
      for (const p of ["height", "tile", "water", "attr"]) this.dirty.get(key).add(p);
    }
    return current;
  }

  /* heights (raw, cell grid; a chunk stores cells -1..129 so borders overlap neighbours) */
  raw(cx, cy) {
    const tx = clamp(Math.floor(cx / CELLS), 0, this.size[0] - 1), ty = clamp(Math.floor(cy / CELLS), 0, this.size[1] - 1);
    const c = this.chunkAt(tx, ty);
    if (!c) return 32767;
    const i = clamp(cx - tx * CELLS + 1, 0, RAW - 1), j = clamp(cy - ty * CELLS + 1, 0, RAW - 1);
    return c.height[j * RAW + i];
  }
  setRaw(cx, cy, v, touched) {
    v = clamp(Math.round(v), 0, 65535);
    // at the outer map edge the hidden border follows the edge so no wall forms
    const xs = [cx], ys = [cy];
    if (cx === 0) xs.push(-1); if (cx === this.widthCells) xs.push(cx + 1);
    if (cy === 0) ys.push(-1); if (cy === this.depthCells) ys.push(cy + 1);
    for (const x of xs) for (const y of ys) {
      for (let tx = Math.floor((x - RAW + 2) / CELLS); tx <= Math.floor((x + 1) / CELLS); tx++) {
        for (let ty = Math.floor((y - RAW + 2) / CELLS); ty <= Math.floor((y + 1) / CELLS); ty++) {
          const c = this.chunkAt(tx, ty);
          if (!c) continue;
          const i = x - tx * CELLS + 1, j = y - ty * CELLS + 1;
          if (i < 0 || j < 0 || i >= RAW || j >= RAW) continue;
          this.touch(c, "height");
          c.height[j * RAW + i] = v;
          if (touched) touched.add(c.key);
        }
      }
    }
  }
  // height in meters at a scene position, bilinear
  at(x, z) {
    const cx = x / 2, cy = z / 2, x0 = Math.floor(cx), y0 = Math.floor(cy), fx = cx - x0, fy = cy - y0;
    const h = this.raw(x0, y0) * (1 - fx) * (1 - fy) + this.raw(x0 + 1, y0) * fx * (1 - fy) + this.raw(x0, y0 + 1) * (1 - fx) * fy + this.raw(x0 + 1, y0 + 1) * fx * fy;
    return h / 200;
  }

  /* texture tiles (half-cell grid; a chunk stores half cells -1..256) */
  tile(hx, hy) {
    const c = this.chunkAt(clamp(Math.floor(hx / 256), 0, this.size[0] - 1), clamp(Math.floor(hy / 256), 0, this.size[1] - 1));
    if (!c) return 0;
    return c.tile[clamp(hy - c.ty * 256 + 1, 0, TILES - 1) * TILES + clamp(hx - c.tx * 256 + 1, 0, TILES - 1)];
  }
  setTile(hx, hy, index, touched) {
    for (let tx = Math.floor((hx - TILES + 2) / 256); tx <= Math.floor((hx + 1) / 256); tx++) {
      for (let ty = Math.floor((hy - TILES + 2) / 256); ty <= Math.floor((hy + 1) / 256); ty++) {
        const c = this.chunkAt(tx, ty);
        if (!c) continue;
        const i = hx - tx * 256 + 1, j = hy - ty * 256 + 1;
        if (i < 0 || j < 0 || i >= TILES || j >= TILES) continue;
        if (c.tile[j * TILES + i] === index) continue;
        this.touch(c, "tile");
        c.tile[j * TILES + i] = index;
        touched.add(c.key);
      }
    }
  }

  /* water (cell grid, one level index per cell) */
  waterLevel(cx, cy) {
    const c = this.chunkAt(Math.floor(cx / CELLS), Math.floor(cy / CELLS));
    if (!c) return null;
    const v = c.water.idx[(cy - c.ty * CELLS) * CELLS + (cx - c.tx * CELLS)];
    return v === 255 ? null : c.water.levels[v];
  }
  setWater(cx, cy, level) {
    const c = this.chunkAt(Math.floor(cx / CELLS), Math.floor(cy / CELLS));
    if (!c || cx < 0 || cy < 0) return false;
    let v = 255;
    if (level !== null) {
      v = c.water.levels.indexOf(level);
      if (v < 0) { if (c.water.levels.length >= 254) return false; v = c.water.levels.push(level) - 1; }
    }
    const k = (cy - c.ty * CELLS) * CELLS + (cx - c.tx * CELLS);
    if (c.water.idx[k] === v) return false;
    this.touch(c, "water");
    c.water.idx[k] = v;
    return true;
  }

  /* server attributes (1 m pixels) */
  attr(ax, ay) {
    const c = this.chunkAt(Math.floor(ax / ATTR), Math.floor(ay / ATTR));
    return c ? c.attr[(ay - c.ty * ATTR) * ATTR + (ax - c.tx * ATTR)] : 0;
  }
  setAttr(ax, ay, flags, erase, touched) {
    const c = this.chunkAt(Math.floor(ax / ATTR), Math.floor(ay / ATTR));
    if (!c || ax < 0 || ay < 0) return;
    const k = (ay - c.ty * ATTR) * ATTR + (ax - c.tx * ATTR);
    const v = erase ? c.attr[k] & ~flags : c.attr[k] | flags;
    if (v === c.attr[k]) return;
    this.touch(c, "attr");
    c.attr[k] = v;
    touched.add(c.key);
  }

  addTexture(game, url) {
    const existing = this.textures.find((t) => t.file.toLowerCase() === game.toLowerCase());
    if (existing) return existing;
    const index = this.textures.reduce((m, t) => Math.max(m, t.index), 0) + 1;
    const entry = { index, file: game, uScale: 4, vScale: 4, url };
    this.textures.push(entry);
    this.textureSetDirty = true;
    return entry;
  }

  savePayload() {
    const terrains = [];
    for (const [key, parts] of this.dirty) {
      const c = this.chunks.get(key);
      const t = { key };
      if (parts.has("height")) t.height = c.height;
      if (parts.has("tile")) t.tile = c.tile;
      if (parts.has("water")) t.water = c.water;
      if (parts.has("attr")) t.attr = c.attr;
      terrains.push(t);
    }
    const textureSet = this.textureSetDirty
      ? { file: this.textureSetFile, entries: this.textures.map(({ index, file, uScale, vScale, block }) => ({ index, file, uScale, vScale, block })) }
      : null;
    return { textureSet, terrains };
  }
  get isDirty() { return this.dirty.size > 0 || this.textureSetDirty; }
  markSaved() { this.dirty.clear(); this.textureSetDirty = false; }
}

function cloneChunk(c) {
  return { height: c.height.slice(), tile: c.tile.slice(), attr: c.attr.slice(), water: { idx: c.water.idx.slice(), levels: c.water.levels.slice() } };
}

/* ---------- view ---------- */

const fallback = new THREE.DataTexture(new Uint8Array([110, 120, 90, 255]), 1, 1);
fallback.needsUpdate = true;
const ddsLoader = new DDSLoader();

const vertexShader = `
  varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUv;
  void main() {
    vUv = uv; vNormal = normalize(normal);
    vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const fragmentShader = `
  uniform sampler2D tex[${MAX_SLOTS}]; uniform float scale[${MAX_SLOTS}];
  uniform sampler2D maskA; uniform sampler2D maskB; uniform sampler2D maskC; uniform sampler2D attrTex;
  uniform float showAttr; uniform vec3 sunDir;
  varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUv;
  void main() {
    vec4 a = texture2D(maskA, vUv), b = texture2D(maskB, vUv), c = texture2D(maskC, vUv);
    float w[${MAX_SLOTS}];
    w[0]=a.r; w[1]=a.g; w[2]=a.b; w[3]=a.a; w[4]=b.r; w[5]=b.g; w[6]=b.b; w[7]=b.a; w[8]=c.r; w[9]=c.g; w[10]=c.b; w[11]=c.a;
    vec3 col = vec3(0.0); float sum = 0.0;
    ${Array.from({ length: MAX_SLOTS }, (_, i) => `if (w[${i}] > 0.001) { col += texture2D(tex[${i}], vWorld.xz / scale[${i}]).rgb * w[${i}]; sum += w[${i}]; }`).join("\n    ")}
    col = sum > 0.0 ? col / sum : vec3(0.42, 0.47, 0.35);
    float light = 0.45 + 0.65 * max(dot(normalize(vNormal), normalize(sunDir)), 0.0);
    col *= light;
    if (showAttr > 0.5) { vec4 at = texture2D(attrTex, vUv); col = mix(col, at.rgb, at.a * 0.55); }
    gl_FragColor = vec4(col, 1.0);
  }`;

function dataTex(data, size) {
  const t = new THREE.DataTexture(data, size, size);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.flipY = false; t.needsUpdate = true;
  return t;
}

export class TerrainView {
  constructor(model) {
    this.model = model;
    this.group = new THREE.Group();
    this.group.name = "terrain";
    this.meshes = new Map();
    this.texCache = new Map();
    this.showAttr = false;
    for (const c of model.chunks.values()) this.buildChunk(c);
    this.water = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshPhongMaterial({ color: 0x3f7f98, transparent: true, opacity: 0.62, depthWrite: false, shininess: 80 }));
    this.water.name = "water";
    this.water.renderOrder = 2;
    this.updateWater();
  }

  texture(entry) {
    if (!entry || !entry.url) return fallback;
    if (!this.texCache.has(entry.index)) {
      const t = ddsLoader.load(entry.url);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
      this.texCache.set(entry.index, t);
    }
    return this.texCache.get(entry.index);
  }

  buildChunk(c) {
    const n = CELLS + 1;
    const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), index = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i; uv[k * 2] = i / CELLS; uv[k * 2 + 1] = j / CELLS; }
    for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) { const a = j * n + i, b = a + 1, d = a + n, e = d + 1; index.push(a, d, b, b, d, e); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    const masks = [0, 1, 2].map(() => dataTex(new Uint8Array(256 * 256 * 4), 256));
    const attrTex = dataTex(new Uint8Array(ATTR * ATTR * 4), ATTR);
    const mat = new THREE.ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: {
        tex: { value: Array(MAX_SLOTS).fill(fallback) }, scale: { value: Array(MAX_SLOTS).fill(8) },
        maskA: { value: masks[0] }, maskB: { value: masks[1] }, maskC: { value: masks[2] }, attrTex: { value: attrTex },
        showAttr: { value: 0 }, sunDir: { value: new THREE.Vector3(0.4, 1.0, 0.3) }
      }
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "terrain-" + c.key;
    mesh.userData = { key: c.key, masks, attrTex, slots: [] };
    this.meshes.set(c.key, mesh);
    this.group.add(mesh);
    this.updateHeights(c.key); this.updateTiles(c.key); this.updateAttr(c.key);
  }

  updateHeights(key) {
    const c = this.model.chunks.get(key), mesh = this.meshes.get(key);
    const pos = mesh.geometry.attributes.position.array, n = CELLS + 1;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3;
      pos[k] = (c.tx * CELLS + i) * 2; pos[k + 1] = c.height[(j + 1) * RAW + (i + 1)] / 200; pos[k + 2] = (c.ty * CELLS + j) * 2;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere(); mesh.geometry.computeBoundingBox();
  }

  // Slots = textures used in this chunk (most used first, max 12); masks get one channel per slot.
  updateTiles(key) {
    const c = this.model.chunks.get(key), mesh = this.meshes.get(key), u = mesh.material.uniforms;
    const counts = new Map();
    for (let r = 1; r < 257; r++) for (let q = 1; q < 257; q++) { const v = c.tile[r * TILES + q]; counts.set(v, (counts.get(v) || 0) + 1); }
    const slots = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a)).slice(0, MAX_SLOTS);
    const slotOf = new Map(slots.map((v, i) => [v, i]));
    mesh.userData.slots = slots;
    const data = mesh.userData.masks.map((m) => m.image.data);
    for (const d of data) d.fill(0);
    for (let r = 0; r < 256; r++) for (let q = 0; q < 256; q++) {
      const s = slotOf.get(c.tile[(r + 1) * TILES + (q + 1)]);
      if (s !== undefined) data[s >> 2][(r * 256 + q) * 4 + (s & 3)] = 255;
    }
    for (const m of mesh.userData.masks) m.needsUpdate = true;
    u.tex.value = Array.from({ length: MAX_SLOTS }, (_, i) => this.texture(this.model.textures.find((t) => t.index === slots[i])));
    u.scale.value = Array.from({ length: MAX_SLOTS }, (_, i) => { const t = this.model.textures.find((e) => e.index === slots[i]); return t ? Math.max(1, (t.uScale || 4) * 2) : 8; });
  }

  updateAttr(key) {
    const c = this.model.chunks.get(key), tex = this.meshes.get(key).userData.attrTex, d = tex.image.data;
    for (let k = 0; k < ATTR * ATTR; k++) {
      const f = c.attr[k];
      d[k * 4] = f & 1 ? 230 : 30; d[k * 4 + 1] = f & 4 ? 210 : 40; d[k * 4 + 2] = f & 2 ? 240 : 40;
      d[k * 4 + 3] = f ? 255 : 0;
    }
    tex.needsUpdate = true;
  }

  setAttrVisible(on) {
    this.showAttr = on;
    for (const m of this.meshes.values()) m.material.uniforms.showAttr.value = on ? 1 : 0;
  }

  updateWater() {
    const pos = [];
    for (const c of this.model.chunks.values()) {
      for (let y = 0; y < CELLS; y++) for (let x = 0; x < CELLS; x++) {
        const v = c.water.idx[y * CELLS + x];
        if (v === 255 || v >= c.water.levels.length) continue;
        const h = c.water.levels[v] / 200, x0 = (c.tx * CELLS + x) * 2, z0 = (c.ty * CELLS + y) * 2;
        pos.push(x0, h, z0, x0, h, z0 + 2, x0 + 2, h, z0, x0 + 2, h, z0, x0, h, z0 + 2, x0 + 2, h, z0 + 2);
      }
    }
    this.water.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    this.water.geometry = geo;
  }

  refresh(keys, parts) {
    for (const key of keys) {
      if (!this.meshes.has(key)) continue;
      if (parts.has("height")) this.updateHeights(key);
      if (parts.has("tile")) this.updateTiles(key);
      if (parts.has("attr")) this.updateAttr(key);
    }
    if (parts.has("water")) this.updateWater();
  }
}
