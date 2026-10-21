// Spawn markers: a coloured post with a label at each spawn point and its radius drawn on the terrain.
// Spawn positions are meters from the map's north-west corner (x east, y south), like the MCP API.
import * as THREE from "three";

export const SPAWN_TYPES = {
  m: { label: "Monštrá", color: 0xe0503c },
  g: { label: "Skupina", color: 0xe09a3c },
  ga: { label: "Agresívna skupina", color: 0xb02a7a },
  npc: { label: "NPC", color: 0x3c8ce0 }
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
  }
  clear() { for (const id of [...this.nodes.keys()]) this.remove(id); }
  remove(id) {
    const n = this.nodes.get(id);
    if (!n) return;
    this.root.remove(n);
    n.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
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
  highlight(id) {
    this.selected = id;
    for (const [sid, g] of this.nodes) for (const o of g.children) if (o.userData.ring) o.material.color.set(sid === id ? 0xffffff : SPAWN_TYPES[o.parent.userData.type || "m"].color);
  }
  pickables() { const out = []; for (const g of this.nodes.values()) for (const o of g.children) if (o.isMesh) out.push(o); return out; }
}
