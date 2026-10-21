// Noclip camera: fly freely, never follows or collides with the terrain.
// Right drag looks around in place, middle drag pans, wheel flies forward/back,
// W/S along the view direction, A/D sideways, E/Space up, Q/C down, Shift faster.
import * as THREE from "three";

const KEYS = new Set(["w", "a", "s", "d", "q", "e", "c", " ", "arrowup", "arrowdown", "arrowleft", "arrowright"]);

export class FlyControls {
  constructor(camera, dom, groundAt) {
    this.camera = camera; this.dom = dom; this.groundAt = groundAt;
    this.enabled = true;
    this.yaw = 0; this.pitch = -0.6;          // yaw 0 looks north (-z); pitch < 0 looks down
    this.held = new Set();
    this.drag = null;
    camera.rotation.order = "YXZ";
    dom.addEventListener("contextmenu", (e) => e.preventDefault());
    dom.addEventListener("pointerdown", (e) => {
      if (!this.enabled || (e.button !== 1 && e.button !== 2)) return;
      this.drag = { button: e.button, x: e.clientX, y: e.clientY };
      dom.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
    window.addEventListener("pointermove", (e) => {
      if (!this.drag || !this.enabled) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      if (this.drag.button === 2) {
        this.yaw -= dx * 0.004;
        this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.004, -1.55, 1.55);
      } else {
        const s = this.speed() * 0.004;
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        camera.position.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
      }
      this.apply();
    });
    window.addEventListener("pointerup", (e) => { if (this.drag && e.button === this.drag.button) this.drag = null; });
    dom.addEventListener("wheel", (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      camera.position.addScaledVector(this.forward(), -Math.sign(e.deltaY) * this.speed() * 0.35);
    }, { passive: false });
  }

  // keyboard state is fed by the app (it decides when typing in inputs must be ignored)
  keyDown(k) { if (KEYS.has(k)) { this.held.add(k); return true; } return false; }
  keyUp(k) { this.held.delete(k); }
  clear() { this.held.clear(); }

  forward() { return new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion); }
  // meters per second: slow near the ground for precise work, fast high above it
  speed() {
    const p = this.camera.position, g = this.groundAt ? this.groundAt(p.x, p.z) : 0;
    return Math.max(8, Math.min(400, (p.y - g) * 1.1));
  }
  apply() { this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ"); this.camera.updateMatrixWorld(); }

  lookAt(point) {
    const d = point.clone().sub(this.camera.position);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    this.apply();
  }
  // a point in front of the camera on the ground (or at distance d when looking at the sky)
  focusPoint(d = 60) {
    const f = this.forward(), p = this.camera.position.clone();
    for (let t = 0; t < 3000; t += 2) {
      const q = p.clone().addScaledVector(f, t);
      if (this.groundAt && q.y <= this.groundAt(q.x, q.z)) return q;
    }
    return p.addScaledVector(f, d);
  }

  update(dt, shift) {
    if (!this.enabled || !this.held.size) return;
    const has = (...k) => k.some((x) => this.held.has(x));
    const f = this.forward(), right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const move = new THREE.Vector3();
    if (has("w", "arrowup")) move.add(f);
    if (has("s", "arrowdown")) move.sub(f);
    if (has("d", "arrowright")) move.add(right);
    if (has("a", "arrowleft")) move.sub(right);
    if (has("e", " ")) move.y += 1;
    if (has("q", "c")) move.y -= 1;
    if (!move.lengthSq()) return;
    move.normalize().multiplyScalar(this.speed() * (shift ? 3.5 : 1) * dt);
    this.camera.position.add(move);
    this.camera.updateMatrixWorld();
  }
}
