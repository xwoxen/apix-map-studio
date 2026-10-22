// SpeedTree trees from tools/spt2json (the client's SpeedTreeRT computes the geometry): bark branch strips,
// fronds and leaf cards that always face the camera like the client's CPU leaf placement. Units: cm z up -> m y up.
import * as THREE from "three";
import { effectTexture, assetPath, POINT_SCALE } from "./effects.js";

function stripsToTriangles(strips) {
  const out = [];
  for (const s of strips) {
    for (let i = 2; i < s.length; i++) {
      const a = s[i - 2], b = s[i - 1], c = s[i];
      if (a === b || b === c || a === c) continue;                 // degenerate joints between strips
      if (i % 2) out.push(b, a, c); else out.push(a, b, c);
    }
  }
  return out;
}

function indexedMesh(g, material) {
  if (!g || !g.count) return null;
  const pos = new Float32Array(g.count * 3), nrm = new Float32Array(g.count * 3);
  for (let i = 0; i < g.count; i++) {
    pos[i * 3] = g.coords[i * 3] / 100; pos[i * 3 + 1] = g.coords[i * 3 + 2] / 100; pos[i * 3 + 2] = -g.coords[i * 3 + 1] / 100;
    nrm[i * 3] = g.normals[i * 3]; nrm[i * 3 + 1] = g.normals[i * 3 + 2]; nrm[i * 3 + 2] = -g.normals[i * 3 + 1];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.uv), 2));
  geo.setIndex(stripsToTriangles(g.strips));
  // with static lighting SpeedTreeRT hands out lighting colours instead of normals: rebuild them from the faces
  if (!nrm.some((v) => v !== 0)) geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return new THREE.Mesh(geo, material);
}

const leafShader = {
  vertexShader: `
    attribute vec2 aSize; attribute vec4 aUv;
    uniform float scale;
    varying vec4 vUv; varying vec2 vAspect;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float s = max(aSize.x, aSize.y);
      gl_PointSize = s * scale / max(0.1, -mv.z);
      vUv = aUv; vAspect = vec2(s / max(aSize.x, 1e-4), s / max(aSize.y, 1e-4));
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform sampler2D map; uniform vec3 tint;
    varying vec4 vUv; varying vec2 vAspect;
    void main() {
      vec2 p = (gl_PointCoord - 0.5) * vAspect + 0.5;
      if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) discard;
      vec4 t = texture2D(map, vec2(mix(vUv.x, vUv.y, p.x), mix(vUv.z, vUv.w, p.y)));
      if (t.a < 0.33) discard;                                   // SpeedTree's default leaf alpha mask 0x54
      gl_FragColor = vec4(t.rgb * tint, 1.0);
    }`
};

function leafPoints(leaves, texture) {
  const n = leaves.length;
  const pos = new Float32Array(n * 3), size = new Float32Array(n * 2), uv = new Float32Array(n * 4);
  const d = (k, a, b) => Math.hypot(k[a * 3] - k[b * 3], k[a * 3 + 1] - k[b * 3 + 1], k[a * 3 + 2] - k[b * 3 + 2]) / 100;
  leaves.forEach((l, i) => {
    pos[i * 3] = l.c[0] / 100; pos[i * 3 + 1] = l.c[2] / 100; pos[i * 3 + 2] = -l.c[1] / 100;
    size[i * 2] = d(l.k, 0, 1); size[i * 2 + 1] = d(l.k, 1, 2);
    // corner 0 is the card's top left, 1 top right, 3 bottom left
    uv[i * 4] = l.t[0]; uv[i * 4 + 1] = l.t[2]; uv[i * 4 + 2] = l.t[1]; uv[i * 4 + 3] = l.t[7];
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 2));
  geo.setAttribute("aUv", new THREE.BufferAttribute(uv, 4));
  geo.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: texture }, scale: POINT_SCALE, tint: { value: new THREE.Color(0.85, 0.9, 0.85) } }, ...leafShader });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

// Leaf shadows: point sprites cast none, so each leaf also gets two crossed cards that never draw (no colour,
// no depth) but cast alpha-tested shadows (terrain shadow export, castShadow is turned on there).
function leafShadowCasters(leaves, texture) {
  const pos = [], uv = [], idx = [];
  for (const l of leaves) {
    const cx = l.c[0] / 100, cy = l.c[2] / 100, cz = -l.c[1] / 100;
    const w = Math.hypot(l.k[0] - l.k[3], l.k[1] - l.k[4], l.k[2] - l.k[5]) / 200, h = Math.hypot(l.k[3] - l.k[6], l.k[4] - l.k[7], l.k[5] - l.k[8]) / 200;
    const [u0, u1, v0, v1] = [l.t[0], l.t[2], l.t[1], l.t[7]];
    for (const [ax, az] of [[1, 0], [0, 1]]) {
      const b = pos.length / 3;
      for (const [sx, sy, u, v] of [[-1, 1, u0, v0], [1, 1, u1, v0], [1, -1, u1, v1], [-1, -1, u0, v1]]) {
        pos.push(cx + sx * w * ax, cy + sy * h, cz + sx * w * az); uv.push(u, v);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.33, side: THREE.DoubleSide, colorWrite: false, depthWrite: false }));
  m.userData.shadowOnly = true;
  m.raycast = () => {};                                              // never picked
  return m;
}

async function texture(dir, name, repeat) {
  if (!name) return null;
  // many .spt files name the composite map without an extension (CompositeMapB2, taoshuleaves); the client loads <name>.dds
  const file = /\.[a-z0-9]{2,4}$/i.test(name) ? name : `${name}.dds`;
  const t = await effectTexture(assetPath(dir, file));
  if (!t) return null;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

export async function speedTreeNode(info) {
  const d = await (await fetch(info.url)).json();
  const holder = new THREE.Group();
  const [bark, frond, leaf] = await Promise.all([
    texture(info.dir, d.textures.branch, true),
    texture(info.dir, d.textures.composite || d.textures.fronds[0], true),
    texture(info.dir, d.textures.composite || d.textures.leaves[0], true)
  ]);
  const branches = indexedMesh(d.branches, new THREE.MeshLambertMaterial({ map: bark, color: bark ? 0xffffff : 0x6b5238 }));
  if (branches) holder.add(branches);
  const fronds = indexedMesh(d.fronds, new THREE.MeshLambertMaterial({ map: frond, alphaTest: 0.33, side: THREE.DoubleSide, color: frond ? 0xffffff : 0x4f7a3a }));
  if (fronds) holder.add(fronds);
  if (d.leaves.length && leaf) holder.add(leafPoints(d.leaves, leaf), leafShadowCasters(d.leaves, leaf));
  holder.userData.points = d.leaves.length > 0;
  return holder;
}
