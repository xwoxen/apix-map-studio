// Map objects: Metin2 AreaData entries <-> three.js nodes. Metin2 position is cm with z up and y pointing north
// (map rows go south, so y is negative); scene is meters with y up: scene = (x/100, z/100, -y/100).
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { DDSLoader } from "three/addons/loaders/DDSLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const templates = new Map();     // crc -> Promise<{ node, info }>

export const toScene = (o) => new THREE.Vector3(o.x / 100, o.z / 100, -o.y / 100);
export function fromScene(v) { return { x: v.x * 100, y: -v.z * 100, z: v.y * 100 }; }

function placeholder(color, w, h) {
  const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.85 }));
  g.position.y = h / 2;
  const holder = new THREE.Group(); holder.add(g); return holder;
}

/* Trees: SpeedTree files can't be rendered here, so each tree is a stand-in built from its own bark and
   leaf textures: a trunk plus alpha-tested leaf cards arranged by shape (conifer, broadleaf, palm, bush). */
const ddsLoader = new DDSLoader();
const texCache = new Map();
function dds(url, repeat) {
  const key = url + (repeat ? "#r" : "");
  if (!texCache.has(key)) {
    const t = ddsLoader.load(url);
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 3); }
    texCache.set(key, t);
  }
  return texCache.get(key);
}

function seeded(text) {
  let s = 0;
  for (const ch of text) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
}

function card(w, h, pos, yaw, tilt) {
  const g = new THREE.PlaneGeometry(w, h);
  g.translate(0, h / 2, 0);
  g.rotateX(tilt);
  g.rotateY(yaw);
  g.translate(pos.x, pos.y, pos.z);
  return g;
}

// A branch: two crossed cards (flat + upright) starting at the trunk and reaching out along +x before yaw.
// half: 0 = whole texture, 1/2 = lower/upper half (SpeedTree leaf maps often hold two branch sprites).
function branch(len, pos, yaw, droop, half) {
  const out = [];
  for (const flat of [true, false]) {
    const g = new THREE.PlaneGeometry(len, len * 0.6);
    if (half) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 0.5 + (half === 2 ? 0.5 : 0));
    }
    g.translate(len / 2, 0, 0);
    if (flat) g.rotateX(-Math.PI / 2 + 0.35);
    g.rotateZ(-droop);
    g.rotateY(yaw);
    g.translate(pos.x, pos.y, pos.z);
    out.push(g);
  }
  return out;
}

function treeNode(info) {
  const h = Math.max(3, (info.size || 1000) / 100);
  const rnd = seeded(info.name || "tree");
  const cards = [];
  let trunkH = h * 0.45, trunkR = h * 0.025;
  if (info.shape === "conifer") {
    trunkH = h * 0.95; trunkR = h * 0.022;
    const tiers = 11;
    for (let t = 0; t < tiers; t++) {
      const f = t / (tiers - 1), y = h * (0.2 + 0.75 * f), len = h * 0.38 * (1 - f * 0.8) + 0.5;
      const n = Math.max(4, Math.round(9 - f * 5));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + t * 0.7 + rnd() * 0.4;
        cards.push(...branch(len, new THREE.Vector3(0, y, 0), a, 0.25 + rnd() * 0.2, 1 + (i % 2)));
      }
    }
    cards.push(card(h * 0.1, h * 0.14, new THREE.Vector3(0, h * 0.9, 0), 0, 0), card(h * 0.1, h * 0.14, new THREE.Vector3(0, h * 0.9, 0), Math.PI / 2, 0));
  } else if (info.shape === "palm") {
    trunkH = h * 0.92; trunkR = h * 0.022;
    for (let i = 0; i < 12; i++) cards.push(...branch(h * 0.45, new THREE.Vector3(0, trunkH, 0), (i / 12) * Math.PI * 2 + rnd() * 0.3, 0.3 + rnd() * 0.4, 0));
  } else {
    const bush = info.shape === "bush";
    if (bush) { trunkH = 0; }
    const cy = bush ? h * 0.35 : h * 0.66, rad = bush ? h * 0.4 : h * 0.32;
    const n = bush ? 16 : 42;
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, rr = rad * (0.35 + 0.65 * Math.cbrt(rnd()));
      const p = new THREE.Vector3(Math.sqrt(1 - u * u) * Math.cos(th) * rr * 0.4, cy + u * rr * 0.6, Math.sqrt(1 - u * u) * Math.sin(th) * rr * 0.4);
      cards.push(...branch(rad * 0.95, p, th, -0.2 + rnd() * 0.5, 0));
    }
  }
  const holder = new THREE.Group();
  if (trunkH > 0) {
    const bark = info.bark ? new THREE.MeshLambertMaterial({ map: dds(info.bark, true) }) : new THREE.MeshLambertMaterial({ color: 0x5b4330 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(trunkR * 0.55, trunkR, trunkH, 7), bark);
    trunk.position.y = trunkH / 2;
    holder.add(trunk);
  }
  const leafMat = info.leaves
    ? new THREE.MeshLambertMaterial({ map: dds(info.leaves), color: 0xb4c4ae, alphaTest: 0.35, side: THREE.DoubleSide })
    : new THREE.MeshLambertMaterial({ color: 0x3b6b3a, side: THREE.DoubleSide });
  holder.add(new THREE.Mesh(mergeGeometries(cards), leafMat));
  return holder;
}

// Granny models arrive as SkinnedMesh. Map objects never animate, so each one is baked into a plain Mesh in
// its posed shape: bounds, picking and the selection box then come from real geometry (a fresh skeleton's
// zero bone matrices otherwise get cached as an empty bounding box and the object can't be clicked).
function bakeSkinned(model) {
  model.updateMatrixWorld(true);
  const skinned = [];
  model.traverse((m) => { if (m.isSkinnedMesh) skinned.push(m); });
  const v = new THREE.Vector3();
  for (const m of skinned) {
    m.skeleton.update();
    const src = m.geometry, pos = src.attributes.position, out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { m.getVertexPosition(i, v); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(out, 3));
    for (const name of ["uv", "uv1", "uv2", "color"]) if (src.attributes[name]) geo.setAttribute(name, src.attributes[name]);
    if (src.index) geo.setIndex(src.index);
    for (const g of src.groups) geo.addGroup(g.start, g.count, g.materialIndex);
    geo.computeVertexNormals();
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, m.material);
    mesh.name = m.name;
    mesh.position.copy(m.position); mesh.quaternion.copy(m.quaternion); mesh.scale.copy(m.scale);
    m.parent.add(mesh);
    m.parent.remove(m);
  }
  return model;
}

// Textures always live next to the cached m.fbx under their bare file name, whatever path the FBX stored.
function loadFbx(url) {
  const base = url.slice(0, url.lastIndexOf("/") + 1);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((u) => (/\.(png|dds|tga|jpg)$/i.test(u) && !u.startsWith(base)
    ? base + encodeURIComponent(decodeURIComponent(u.split(/[\\/]/).pop())) : u));
  return new Promise((resolve, reject) => new FBXLoader(manager).load(url, resolve, undefined, reject));
}

export function template(crc) {
  if (templates.has(crc)) return templates.get(crc);
  const job = window.studio.model(crc).then(async (info) => {
    if (info.kind === "tree") return { node: treeNode(info), info };
    if (info.kind === "fbx") {
      try {
        const model = bakeSkinned(await loadFbx(info.url));
        model.traverse((m) => {
          if (m.isMesh) {
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats) {
              mat.side = THREE.DoubleSide;
              mat.transparent = false; mat.opacity = 1;
              // Alpha-test only textures that really loaded; a missing texture would cut the whole model away.
              if (mat.map) {
                const tex = mat.map;
                mat.alphaTest = 0.4;
                const check = () => { if (!tex.image || !(tex.image.width || tex.image.naturalWidth)) { mat.map = null; mat.alphaTest = 0; mat.color.set(0xb8b0a0); mat.needsUpdate = true; } };
                setTimeout(check, 5000);
              }
            }
          }
        });
        // Granny models are centimeters with z up; FBXLoader keeps the file's axes.
        model.scale.setScalar(0.01);
        model.rotation.x = -Math.PI / 2;
        const holder = new THREE.Group(); holder.add(model);
        return { node: holder, info };
      } catch (e) {
        return { node: placeholder(0xd04040, 3, 3), info: { ...info, kind: "error", error: String(e) } };
      }
    }
    if (info.kind === "marker") return { node: placeholder(0xe0b040, 1, 1), info };
    return { node: placeholder(0xd040d0, 2, 2), info };
  });
  templates.set(crc, job);
  return job;
}

export class ObjectLayer {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = "objects";
    this.nodes = new Map();      // id -> Group
    this.pending = 0;
    this.onLoaded = null;
  }

  clear() { for (const n of this.nodes.values()) this.root.remove(n); this.nodes.clear(); }

  place(node, o) {
    node.position.copy(toScene(o));
    node.rotation.set(0, THREE.MathUtils.degToRad(o.yaw || 0), 0);
  }

  add(o) {
    const node = new THREE.Group();
    node.userData.id = o.id;
    this.place(node, o);
    this.root.add(node);
    this.nodes.set(o.id, node);
    this.pending++;
    template(o.crc).then(({ node: tpl }) => {
      const inst = cloneSkinned(tpl);
      inst.traverse((m) => { m.userData.id = o.id; });
      node.add(inst);
    }).finally(() => { this.pending--; if (this.onLoaded) this.onLoaded(this.pending); });
    return node;
  }

  remove(id) { const n = this.nodes.get(id); if (n) { this.root.remove(n); this.nodes.delete(id); } }

  sync(objects) {
    const ids = new Set(objects.map((o) => o.id));
    for (const id of [...this.nodes.keys()]) if (!ids.has(id)) this.remove(id);
    for (const o of objects) {
      const n = this.nodes.get(o.id);
      if (!n) this.add(o); else this.place(n, o);
    }
  }
}
