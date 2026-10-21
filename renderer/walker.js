// Play mode: a warrior placed on the map and walked around with a third-person camera.
// Blocked and water attributes stop it like the server would; noclip ignores them (and walks on water).
// Objects are not solid: the client's collision shapes are not loaded.
import * as THREE from "three";
import { loadFbx } from "./objects.js";

const RUN = 6.5, WALK = 2.2;               // meters per second
const BLOCK = 1, WATER = 2;
const MOVE_KEYS = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"]);

function prepareMaterials(model) {
  model.traverse((m) => {
    if (!m.isMesh) return;
    m.frustumCulled = false;                 // skinned bounds don't follow the animation
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      mat.side = THREE.DoubleSide; mat.transparent = false; mat.opacity = 1;
      if (mat.map) mat.alphaTest = 0.4;
    }
  });
}

// Root motion would drag the model away from its position: keep the root bone's horizontal track at frame 0.
function inPlace(clip, rootName) {
  for (const t of clip.tracks) {
    if (t.name !== `${rootName}.position`) continue;
    for (let i = 3; i < t.values.length; i += 3) { t.values[i] = t.values[0]; t.values[i + 1] = t.values[1]; }
  }
  return clip;
}

export class Walker {
  constructor(scene, camera, dom, getTerrain) {
    this.scene = scene; this.camera = camera; this.dom = dom; this.terrain = getTerrain;
    this.root = new THREE.Group(); this.root.visible = false; scene.add(this.root);
    this.active = false; this.placing = false; this.noclip = false; this.blocked = false;
    this.held = new Set();
    this.facing = 0;
    this.view = { yaw: 0, pitch: 0.45, dist: 9 };
    this.ready = null;
    this.onChange = () => {};
    dom.addEventListener("pointerdown", (e) => {
      if (!this.active || e.button !== 2) return;
      this.drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener("pointermove", (e) => {
      if (!this.drag || !this.active) return;
      this.view.yaw -= (e.clientX - this.drag.x) * 0.005;
      this.view.pitch = THREE.MathUtils.clamp(this.view.pitch + (e.clientY - this.drag.y) * 0.005, -0.2, 1.45);
      this.drag.x = e.clientX; this.drag.y = e.clientY;
    });
    window.addEventListener("pointerup", () => { this.drag = null; });
    dom.addEventListener("wheel", (e) => {
      if (!this.active) return;
      e.preventDefault(); e.stopImmediatePropagation();
      this.view.dist = THREE.MathUtils.clamp(this.view.dist * (e.deltaY > 0 ? 1.15 : 1 / 1.15), 2.5, 60);
    }, { passive: false, capture: true });
  }

  load() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const parts = await window.studio.character();
      if (!parts.body) throw new Error("Model postavy sa nenašiel v klientovi");
      const body = await loadFbx(parts.body);
      prepareMaterials(body);
      const bones = new Map();
      body.traverse((b) => { if (b.isBone) bones.set(b.name, b); });
      if (parts.hair) {
        // the hair is skinned to the same skeleton: rebind its meshes to the body's bones by name
        const hair = await loadFbx(parts.hair);
        prepareMaterials(hair);
        const meshes = [];
        hair.traverse((m) => { if (m.isSkinnedMesh) meshes.push(m); });
        for (const m of meshes) {
          const own = m.skeleton.bones.map((b) => bones.get(b.name));
          if (!own.every(Boolean)) continue;
          m.removeFromParent(); body.add(m);
          m.bind(new THREE.Skeleton(own, m.skeleton.boneInverses), m.bindMatrix);
        }
      }
      let rootBone = null;
      body.traverse((b) => { if (!rootBone && b.isBone && !(b.parent && b.parent.isBone)) rootBone = b; });
      this.mixer = new THREE.AnimationMixer(body);
      this.actions = {};
      for (const k of ["wait", "walk", "run"]) {
        if (!parts[k]) continue;
        const clip = (await loadFbx(parts[k])).animations[0];
        if (clip) this.actions[k] = this.mixer.clipAction(rootBone ? inPlace(clip, rootBone.name) : clip);
      }
      // Granny models are centimeters with z up, like the map objects
      body.scale.setScalar(0.01);
      body.rotation.x = -Math.PI / 2;
      this.model = new THREE.Group(); this.model.add(body);
      this.root.add(this.model);
      this.play("wait");
    })();
    return this.ready;
  }

  play(name) {
    const next = this.actions && (this.actions[name] || this.actions.wait);
    if (!next || next === this.current) return;
    next.reset().play();
    if (this.current) this.current.crossFadeTo(next, 0.2, false);
    this.current = next;
  }

  // where the character may stand: inside the map, and off blocked or water attributes unless noclip
  free(x, z) {
    const t = this.terrain();
    if (!t || x < 0.5 || z < 0.5 || x > t.size[0] * 256 - 0.5 || z > t.size[1] * 256 - 0.5) return false;
    return this.noclip || !(t.attr(Math.floor(x), Math.floor(z)) & (BLOCK | WATER));
  }
  groundY(x, z) {
    const t = this.terrain();
    let y = t.at(x, z);
    if (this.noclip) {
      const w = t.waterLevel(Math.floor(x / 2), Math.floor(z / 2));
      if (w !== null && w / 200 > y) y = w / 200;   // noclip walks on the water surface
    }
    return y;
  }

  setPosition(x, z) {
    this.root.position.set(x, this.groundY(x, z), z);
  }
  async beginPlacing() {
    this.stop(false);
    this.placing = true;
    await this.load();
    this.root.visible = this.placing;
  }
  start(x, z) {
    this.placing = false;
    this.setPosition(x, z);
    this.root.visible = true;
    this.active = true;
    this.view.yaw = this.facing + Math.PI;
    this.onChange();
  }
  stop(hide = true) {
    this.active = false; this.placing = false; this.held.clear(); this.drag = null;
    if (hide) this.root.visible = false;
    this.onChange();
  }

  keyDown(k) { if (MOVE_KEYS.has(k)) { this.held.add(k); return true; } return false; }
  keyUp(k) { this.held.delete(k); }

  update(dt) {
    if (this.mixer && this.root.visible) this.mixer.update(dt);
    if (!this.active) return;
    const has = (...k) => k.some((x) => this.held.has(x));
    const yaw = this.view.yaw;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const dir = new THREE.Vector3();
    if (has("w", "arrowup")) dir.add(fwd);
    if (has("s", "arrowdown")) dir.sub(fwd);
    if (has("d", "arrowright")) dir.add(right);
    if (has("a", "arrowleft")) dir.sub(right);
    const p = this.root.position;
    let blocked = false;
    if (dir.lengthSq()) {
      dir.normalize();
      const walk = has("shift"), step = (walk ? WALK : RUN) * dt;
      const tries = [[dir.x, dir.z], [Math.sign(dir.x), 0], [0, Math.sign(dir.z)]];   // slide along walls
      let moved = false;
      for (const [dx, dz] of tries) {
        if (!dx && !dz) continue;
        const nx = p.x + dx * step, nz = p.z + dz * step;
        if (this.free(nx, nz)) { p.x = nx; p.z = nz; moved = true; break; }
      }
      blocked = !moved;
      this.facing = Math.atan2(dir.x, dir.z);
      this.play(moved ? (walk ? "walk" : "run") : "wait");
    } else this.play("wait");
    if (blocked !== this.blocked) { this.blocked = blocked; this.onChange(); }
    // follow the ground smoothly, turn toward the walking direction
    const gy = this.groundY(p.x, p.z);
    p.y += (gy - p.y) * Math.min(1, dt * 14);
    let d = this.facing - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * Math.min(1, dt * 12);
    this.follow();
  }

  // third-person camera behind and above the character
  follow() {
    const v = this.view, target = this.root.position.clone().add(new THREE.Vector3(0, 1.6, 0));
    const c = this.camera;
    c.position.set(target.x + Math.sin(v.yaw) * Math.cos(v.pitch) * v.dist, target.y + Math.sin(v.pitch) * v.dist, target.z + Math.cos(v.yaw) * Math.cos(v.pitch) * v.dist);
    const t = this.terrain(), floor = t.at(c.position.x, c.position.z) + 0.6;
    if (c.position.y < floor) c.position.y = floor;
    c.lookAt(target);
    c.updateMatrixWorld();
  }
}
