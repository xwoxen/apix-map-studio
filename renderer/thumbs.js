// Object thumbnails: render each library model once into a small offscreen canvas, cache the PNG on disk.
import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { template } from "./objects.js";
import { setEffectViewport, restoreEffectViewport } from "./effects.js";

const SIZE = 256;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(SIZE, SIZE, false);
renderer.setPixelRatio(1);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xe6efff, 0x5a5040, 1.7));
const sun = new THREE.DirectionalLight(0xfff3dd, 2.2);
sun.position.set(3, 5, 4);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 5000);

const known = new Map();          // crc -> Promise<url>
const queue = [];
let busy = false;

function texturesReady(node, timeoutMs = 4000) {
  const maps = [];
  node.traverse((m) => {
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (mat && mat.map) maps.push(mat.map);
  });
  const done = () => maps.every((t) => t.image && (t.image.complete !== false) && (t.image.width || t.image.naturalWidth));
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => (done() || performance.now() - t0 > timeoutMs ? resolve() : setTimeout(tick, 80));
    tick();
  });
}

const probe = document.createElement("canvas");
probe.width = probe.height = 32;
function isEmpty() {
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, 32, 32);
  ctx.drawImage(renderer.domElement, 0, 0, 32, 32);
  const px = ctx.getImageData(0, 0, 32, 32).data;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 8) return false;
  return true;
}

async function render(crc) {
  const { node } = await template(crc);
  const obj = cloneSkinned(node);
  const mainScale = obj.isEffect ? setEffectViewport(SIZE, camera.fov) : null;
  if (obj.isEffect) { await obj.ready; obj.warm(1.5); }   // textures, then let the particles fill in
  if (obj.isEffect) obj.traverse((o) => { if (o.userData.effectMarker) o.visible = false; });
  scene.add(obj);
  obj.updateMatrixWorld(true);
  await texturesReady(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(0.5, size.length() / 2);
  const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
  const dir = new THREE.Vector3(0.75, 0.55, 1).normalize();
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.near = dist / 100; camera.far = dist * 4; camera.updateProjectionMatrix();
  camera.lookAt(center);
  renderer.render(scene, camera);
  scene.remove(obj);
  if (obj.isEffect) { obj.dispose(); restoreEffectViewport(mainScale); }
  if (isEmpty()) return null;                 // nothing visible: don't cache a blank picture
  return window.studio.saveThumb(crc, renderer.domElement.toDataURL("image/png"));
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const { crc, resolve } = queue.shift();
    try { resolve(await render(crc)); } catch { resolve(null); }
  }
  busy = false;
}

// Returns a cached thumbnail URL, rendering it first if needed. Visible items should ask first (front of the queue).
export function thumbnail(crc, urgent = false) {
  if (known.has(crc)) return known.get(crc);
  const job = window.studio.thumb(crc).then((url) => url || new Promise((resolve) => {
    (urgent ? queue.unshift.bind(queue) : queue.push.bind(queue))({ crc, resolve });
    pump();
  }));
  known.set(crc, job);
  return job;
}
