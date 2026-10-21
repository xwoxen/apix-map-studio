// Spawn markers: a coloured post with a label at each spawn point and its radius drawn on the terrain.
// Spawn positions are meters from the map's north-west corner (x east, y south), like the MCP API.
import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { loadFbx } from "./objects.js";

// one loaded model per monster vnum, cloned for each spawn and played in its wait motion
const mobTemplates = new Map();
function mobTemplate(vnum) {
  if (!mobTemplates.has(vnum)) {
    mobTemplates.set(vnum, (async () => {
      const info = await window.studio.mobModel(vnum);
      if (!info || !info.body) return null;
      const body = await loadFbx(info.body);
      body.traverse((m) => {
        if (!m.isMesh) return;
        m.frustumCulled = false;
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) { mat.side = THREE.DoubleSide; mat.transparent = false; if (mat.map) mat.alphaTest = 0.4; }
      });
      const clip = info.wait ? (await loadFbx(info.wait)).animations[0] : null;
      return { body, clip };
    })().catch(() => null));
  }
  return mobTemplates.get(vnum);
}

export const SPAWN_TYPES = {
  m: { label: "Monštrá", color: 0xe0503c },
  g: { label: "Skupina", color: 0xe09a3c },
  ga: { label: "Agresívna skupina", color: 0xb02a7a },
  npc: { label: "NPC", color: 0x3c8ce0 },
  town: { label: "Town", color: 0xf2c230 }
};

function labelSprite(text, color) {
  const c = document.createElement("canvas"), ctx = c.getContext("2d");
  ctx.font = "bold 26px Segoe UI, sans-serif";
  c.width = Math.ceil(ctx.measureText(text).width) + 20; c.height = 40;
  ctx.font = "bold 26px Segoe UI, sans-serif";
  ctx.fillStyle = "rgba(20, 22, 26, 0.82)"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#" + color.toString(16).padStart(6, "0"); ctx.fillRect(0, 0, 6, c.height);
  ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(text, 12, c.height / 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(c.width / 40 * 1.4, 1.4, 1);
  s.renderOrder = 10;
  return s;
}

export class SpawnLayer {
  constructor(groundAt) {
    this.groundAt = groundAt;
    this.root = new THREE.Group(); this.root.name = "spawns";
    this.nodes = new Map();
    this.selected = null;
    this.mixers = new Map();
    this.models = true;                      // show monster models (off: posts only)
  }
  update(dt) { for (const m of this.mixers.values()) m.update(dt); }
  clear() { for (const id of [...this.nodes.keys()]) this.remove(id); }
  remove(id) {
    const n = this.nodes.get(id);
    if (!n) return;
    this.root.remove(n);
    this.mixers.delete(id);
    // the monster model shares geometry and materials with its template, so only the marker parts are freed
    for (const c of n.children) if (!c.userData.model) c.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
    this.nodes.delete(id);
  }
  // rebuild one spawn's marker (cheap: a post, a label and a ring)
  set(s, name) {
    this.remove(s.id);
    const t = SPAWN_TYPES[s.type] || SPAWN_TYPES.m, g = new THREE.Group();
    g.userData.spawnId = s.id; g.userData.type = s.type;
    const gy = this.groundAt(s.x, s.y);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 3, 10), new THREE.MeshBasicMaterial({ color: t.color }));
    post.position.set(s.x, gy + 1.5, s.y); post.userData.spawnId = s.id;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), new THREE.MeshBasicMaterial({ color: t.color }));
    head.position.set(s.x, gy + 3.2, s.y); head.userData.spawnId = s.id;
    const label = labelSprite(`${name || s.vnum}${s.type === "m" ? " ×" + s.count : ""}`, t.color);
    label.position.set(s.x, gy + 4.6, s.y);
    g.add(post, head, label);
    if (this.models && s.type !== "town") this.attachModel(g, s, gy);
    const r = Math.max(0.6, s.type === "npc" ? 0.6 : s.radius);
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2, x = s.x + Math.cos(a) * r, z = s.y + Math.sin(a) * r;
      pts.push(new THREE.Vector3(x, this.groundAt(x, z) + 0.25, z));
    }
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: t.color }));
    ring.userData.ring = true;
    g.add(ring);
    this.root.add(g);
    this.nodes.set(s.id, g);
    if (this.selected === s.id) this.highlight(s.id);
  }
  async attachModel(g, s, gy) {
    const t = await mobTemplate(s.vnum);
    if (!t || this.nodes.get(s.id) !== g) return;          // no model, or the marker was rebuilt meanwhile
    const model = cloneSkinned(t.body);
    model.scale.setScalar(0.01); model.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group(); holder.userData.model = true;
    holder.add(model);
    holder.position.set(s.x + 1.2, gy, s.y);
    model.traverse((o) => { if (o.isMesh) o.userData.spawnId = s.id; });
    g.add(holder);
    if (t.clip) { const mixer = new THREE.AnimationMixer(model); mixer.clipAction(t.clip).play(); this.mixers.set(s.id, mixer); }
  }
  // the players' arrival point (Town.txt): a gold post
  setTown(town) {
    this.remove("town");
    if (!town) return;
    this.set({ id: "town", type: "town", vnum: 0, count: 1, radius: 2, x: town.x, y: town.y }, "Town – štart hráčov");
  }
  highlight(id) {
    this.selected = id;
    for (const [sid, g] of this.nodes) for (const o of g.children) if (o.userData.ring) o.material.color.set(sid === id ? 0xffffff : SPAWN_TYPES[o.parent.userData.type || "m"].color);
  }
  pickables() { const out = []; for (const g of this.nodes.values()) for (const o of g.children) if (o.isMesh) out.push(o); return out; }
}
