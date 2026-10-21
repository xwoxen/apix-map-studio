// Applies a parsed .msenv (sun, ambient, fog, sky) to the scene. Metin2 axes: x east, y north, z up;
// scene axes: x east, y up, z south, so a Metin2 vector (x, y, z) becomes (x, z, -y).
import * as THREE from "three";
import { DDSLoader } from "three/addons/loaders/DDSLoader.js";

const DEFAULT = {
  sunDirection: [-0.4, 0.8, -0.45], diffuse: [1, 0.96, 0.88], ambient: [0.45, 0.47, 0.5],
  fog: { enabled: true, near: 40000, far: 140000, color: [0.56, 0.7, 0.81] },
  sky: { textured: false, faces: {}, gradient: [[0.42, 0.62, 0.86], [0.75, 0.85, 0.93]] }
};
const loader = new DDSLoader();
const rgb = (c) => new THREE.Color(c[0], c[1], c[2]);

function gradientSky(colors) {
  const cols = (colors.length ? colors : DEFAULT.sky.gradient).slice(0, 6).map(rgb);
  while (cols.length < 2) cols.push(cols[0].clone());
  const n = cols.length;
  while (cols.length < 6) cols.push(cols[cols.length - 1].clone());      // the shader array always has 6 slots
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { cols: { value: cols }, n: { value: n } },
    vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform vec3 cols[6]; uniform int n; varying vec3 vDir;
      void main(){ float t = clamp(1.0 - max(vDir.y, 0.0), 0.0, 1.0) * float(n - 1);
        int i = int(floor(t)); vec3 c = cols[0];
        for (int k = 0; k < 5; k++) { if (k == i) c = mix(cols[k], cols[k + 1], fract(t)); }
        if (i >= n - 1) c = cols[n - 1];
        gl_FragColor = vec4(c, 1.0); }`
  });
  return new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
}

function texturedSky(faces) {
  // BoxGeometry material order: +x, -x, +y, -y, +z, -z  (scene +z is south)
  const order = ["right", "left", "top", "bottom", "back", "front"];
  const mats = order.map((k) => {
    if (!faces[k]) return new THREE.MeshBasicMaterial({ color: 0x8fb3cf, side: THREE.BackSide, depthWrite: false, fog: false });
    const t = loader.load(faces[k]);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, depthWrite: false, fog: false });
  });
  return new THREE.Mesh(new THREE.BoxGeometry(1600, 1600, 1600), mats);
}

export class Environment {
  constructor(scene, sun, hemi) {
    this.scene = scene; this.sun = sun; this.hemi = hemi; this.sky = null; this.current = null;
    this.gameFog = false;   // the game's fog is tuned for a camera a few meters behind the player
  }
  apply(env, terrainView) {
    const e = env && !env.missing ? env : DEFAULT;
    this.current = env && !env.missing ? env : null;
    const d = e.sunDirection;
    const travel = new THREE.Vector3(d[0], d[2], -d[1]).normalize();          // direction the light travels
    const toSun = travel.clone().negate();
    if (toSun.y < 0.15) toSun.y = 0.15;                                          // keep a little light from above
    this.sun.position.copy(toSun.clone().multiplyScalar(500));
    this.sun.color.copy(rgb(e.diffuse)).multiplyScalar(1.6);
    this.hemi.color.copy(rgb(e.ambient)).lerp(new THREE.Color(1, 1, 1), 0.35);
    this.hemi.groundColor.copy(rgb(e.ambient)).multiplyScalar(0.6);
    this.hemi.intensity = 1.4;
    const fog = e.fog;
    const near = this.gameFog ? fog.near / 100 : Math.max(fog.near / 100, 450);
    const far = this.gameFog ? fog.far / 100 : Math.max(fog.far / 100, 1800);
    this.scene.fog = fog.enabled ? new THREE.Fog(rgb(fog.color), near, far) : null;
    this.scene.background = rgb(fog.enabled ? fog.color : (e.sky.gradient[0] || [0.56, 0.7, 0.81]));
    if (this.sky) { this.scene.remove(this.sky); this.sky = null; }
    const hasFaces = e.sky.textured && Object.values(e.sky.faces).some(Boolean);
    this.sky = hasFaces ? texturedSky(e.sky.faces) : gradientSky(e.sky.gradient);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    if (terrainView) terrainView.setLighting(toSun, rgb(e.diffuse), rgb(e.ambient));
  }
  follow(camera) { if (this.sky) this.sky.position.copy(camera.position); }
}
