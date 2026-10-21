// Terrain and water meshes from WorldEditor map files. Scene units are meters:
// scene x = cell x * 2, scene z = cell y * 2, scene y = raw height / 200 (raw 32767 = flat, 1 m = 200).
import * as THREE from "three";
import { DDSLoader } from "three/addons/loaders/DDSLoader.js";

const CELLS = 128, RAW = 131;
const MAX_TEX = 8;

function u16(buf) { return new Uint16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)); }

export function createHeightField(map) {
  const fields = new Map();
  for (const t of map.terrains) if (t.height) fields.set(t.tx + "," + t.ty, u16(t.height));
  const raw = (cx, cy) => {                                     // raw height at integer global cell
    const tx = Math.min(map.size[0] - 1, Math.max(0, Math.floor(cx / CELLS)));
    const ty = Math.min(map.size[1] - 1, Math.max(0, Math.floor(cy / CELLS)));
    const f = fields.get(tx + "," + ty);
    if (!f) return 32767;
    const i = Math.min(RAW - 1, Math.max(0, cx - tx * CELLS + 1)), j = Math.min(RAW - 1, Math.max(0, cy - ty * CELLS + 1));
    return f[j * RAW + i];
  };
  // height in meters at a scene position, bilinear between cells
  const at = (x, z) => {
    const cx = x / 2, cy = z / 2, x0 = Math.floor(cx), y0 = Math.floor(cy), fx = cx - x0, fy = cy - y0;
    const h = raw(x0, y0) * (1 - fx) * (1 - fy) + raw(x0 + 1, y0) * fx * (1 - fy) + raw(x0, y0 + 1) * (1 - fx) * fy + raw(x0 + 1, y0 + 1) * fx * fy;
    return h / 200;
  };
  return { raw, at };
}

const fallback = new THREE.DataTexture(new Uint8Array([110, 120, 90, 255]), 1, 1);
fallback.needsUpdate = true;

function loadTextures(map) {
  const loader = new DDSLoader();
  const slots = map.textures.slice(0, MAX_TEX);
  return slots.map((t) => {
    if (!t.url) return { index: t.index, tex: fallback, scale: 8 };
    const tex = loader.load(t.url);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    return { index: t.index, tex, scale: Math.max(1, (t.uScale || 4) * 2) };
  });
}

const vertexShader = `
  varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUv;
  void main() {
    vUv = uv; vNormal = normalize(normal);
    vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const fragmentShader = `
  uniform sampler2D tex[${MAX_TEX}]; uniform float scale[${MAX_TEX}];
  uniform sampler2D maskA; uniform sampler2D maskB; uniform vec3 sunDir;
  varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUv;
  void main() {
    vec4 a = texture2D(maskA, vUv), b = texture2D(maskB, vUv);
    float w[${MAX_TEX}]; w[0]=a.r; w[1]=a.g; w[2]=a.b; w[3]=a.a; w[4]=b.r; w[5]=b.g; w[6]=b.b; w[7]=b.a;
    vec3 col = vec3(0.0); float sum = 0.0;
    ${Array.from({ length: MAX_TEX }, (_, i) => `if (w[${i}] > 0.001) { col += texture2D(tex[${i}], vWorld.xz / scale[${i}]).rgb * w[${i}]; sum += w[${i}]; }`).join("\n    ")}
    col = sum > 0.0 ? col / sum : vec3(0.42, 0.47, 0.35);
    float light = 0.45 + 0.65 * max(dot(normalize(vNormal), normalize(sunDir)), 0.0);
    gl_FragColor = vec4(col * light, 1.0);
  }`;

export function buildTerrain(map, heights) {
  const group = new THREE.Group();
  group.name = "terrain";
  const textures = loadTextures(map);
  const slotOf = new Map(textures.map((t, i) => [t.index, i]));
  for (const t of map.terrains) {
    const ox = t.tx * CELLS, oy = t.ty * CELLS, n = CELLS + 1;
    const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      pos[k * 3] = (ox + i) * 2; pos[k * 3 + 1] = heights.raw(ox + i, oy + j) / 200; pos[k * 3 + 2] = (oy + j) * 2;
      uv[k * 2] = i / CELLS; uv[k * 2 + 1] = j / CELLS;
    }
    const index = [];
    for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();

    // tile.raw: 258x258, texture number per half cell with a 1-tile border -> two RGBA weight masks
    const ma = new Uint8Array(256 * 256 * 4), mb = new Uint8Array(256 * 256 * 4);
    if (t.tile) for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) {
      const slot = slotOf.get(t.tile[(r + 1) * 258 + (c + 1)]);
      if (slot === undefined) continue;
      (slot < 4 ? ma : mb)[(r * 256 + c) * 4 + (slot % 4)] = 255;
    }
    const mask = (data) => { const m = new THREE.DataTexture(data, 256, 256); m.magFilter = m.minFilter = THREE.LinearFilter; m.flipY = false; m.needsUpdate = true; return m; };
    const mat = new THREE.ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: {
        tex: { value: Array.from({ length: MAX_TEX }, (_, i) => (textures[i] ? textures[i].tex : fallback)) },
        scale: { value: Array.from({ length: MAX_TEX }, (_, i) => (textures[i] ? textures[i].scale : 8)) },
        maskA: { value: mask(ma) }, maskB: { value: mask(mb) },
        sunDir: { value: new THREE.Vector3(0.4, 1.0, 0.3) }
      }
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "terrain-" + t.key;
    group.add(mesh);
  }
  return group;
}

// water.wtr: u16 magic, u16 128, u16 128, u8 count, 128x128 index bytes (255 = dry), count x int32 raw heights
export function buildWater(map) {
  const pos = [];
  for (const t of map.terrains) {
    if (!t.water || t.water.length < 7 + 128 * 128) continue;
    const view = new DataView(t.water.buffer, t.water.byteOffset, t.water.byteLength);
    const count = t.water[6];
    const levels = Array.from({ length: count }, (_, i) => view.getInt32(7 + 128 * 128 + i * 4, true) / 200);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const idx = t.water[7 + y * 128 + x];
      if (idx === 255 || idx >= count) continue;
      const h = levels[idx], x0 = (t.tx * 128 + x) * 2, z0 = (t.ty * 128 + y) * 2;
      pos.push(x0, h, z0, x0, h, z0 + 2, x0 + 2, h, z0, x0 + 2, h, z0, x0, h, z0 + 2, x0 + 2, h, z0 + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x3f7f98, transparent: true, opacity: 0.62, depthWrite: false, shininess: 80 }));
  mesh.name = "water";
  mesh.renderOrder = 2;
  return mesh;
}
