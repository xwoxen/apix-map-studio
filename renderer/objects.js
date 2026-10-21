// Map objects: Metin2 AreaData entries <-> three.js nodes. Metin2 position is cm with z up and y pointing north
// (map rows go south, so y is negative); scene is meters with y up: scene = (x/100, z/100, -y/100).
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

const templates = new Map();     // crc -> Promise<{ node, info }>

export const toScene = (o) => new THREE.Vector3(o.x / 100, o.z / 100, -o.y / 100);
export function fromScene(v) { return { x: v.x * 100, y: -v.z * 100, z: v.y * 100 }; }

function placeholder(color, w, h) {
  const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.85 }));
  g.position.y = h / 2;
  const holder = new THREE.Group(); holder.add(g); return holder;
}

function treeNode(sizeCm) {
  const h = Math.max(3, (sizeCm || 1000) / 100);
  const holder = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, h * 0.35, 6), new THREE.MeshLambertMaterial({ color: 0x5b4330 }));
  trunk.position.y = h * 0.175;
  const crown = new THREE.Mesh(new THREE.ConeGeometry(h * 0.22, h * 0.8, 8), new THREE.MeshLambertMaterial({ color: 0x2f5d34 }));
  crown.position.y = h * 0.6;
  holder.add(trunk, crown);
  return holder;
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
    if (info.kind === "tree") return { node: treeNode(info.size), info };
    if (info.kind === "fbx") {
      try {
        const model = await loadFbx(info.url);
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
