// Background effects (.mse, EffectLib): particle systems played like the client does it. Emitter values follow
// the emitter's local time (seconds, looping over CycleLength), particle values follow the particle's life (0..1);
// both interpolate linearly between time events (Type.h GetTimeEventBlendValue). Units are centimeters, z up.
// Mesh elements (.mde, EffectMesh.cpp) play their frames; light elements are not drawn and multi-frame textures
// show their first frame.
import * as THREE from "three";
import { DDSLoader } from "three/addons/loaders/DDSLoader.js";

/* ---------- .mse parsing ---------- */

// Group <name> { ... } / List <name> { lines } / Key values...
function parseBlock(lines, i) {
  const node = { values: {}, lists: {}, groups: [] };
  while (i < lines.length) {
    const line = lines[i++].trim();
    if (!line) continue;
    if (line === "}") return [node, i];
    const tokens = line.match(/"[^"]*"|[^\s]+/g);
    if (tokens[0] === "Group" || tokens[0] === "List") {
      if (lines[i] && lines[i].trim() === "{") i++;
      if (tokens[0] === "Group") {
        const [child, next] = parseBlock(lines, i);
        child.name = tokens[1]; node.groups.push(child); i = next;
      } else {
        const rows = [];
        while (i < lines.length && lines[i].trim() !== "}") {
          const t = lines[i++].trim().match(/"[^"]*"|[^\s]+/g);
          if (t) rows.push(t.map((v) => v.replace(/^"|"$/g, "")));
        }
        i++;
        node.lists[tokens[1]] = rows;
      }
    } else node.values[tokens[0]] = tokens.slice(1);
  }
  return [node, i];
}

const num = (v, d = 0) => (v && v.length ? Number(v[0]) : d);
const events = (rows) => (rows || []).map((r) => [Number(r[0]), Number(r[1])]).filter((e) => Number.isFinite(e[0]) && Number.isFinite(e[1]));

export function parseMse(text) {
  const [root] = parseBlock(text.split(/\r?\n/), 0);
  const systems = [], meshes = [];
  for (const g of root.groups) {
    if (g.name === "Mesh") {
      const pos = (g.lists.TimeEventPosition || [])[0];
      meshes.push({
        start: num(g.values.StartTime), position: pos ? pos.slice(-3).map(Number) : [0, 0, 0],
        file: (g.values.MeshFileName || [""])[0].replace(/^"|"$/g, ""),
        loop: num(g.values.MeshAnimationLoopEnable, 1) === 1, frameDelay: num(g.values.MeshAnimationFrameDelay, 0.033) || 0.033,
        elements: g.groups.filter((x) => /^MeshElement/.test(x.name)).map((x) => ({
          billboard: num(x.values.BillboardType), blend: num(x.values.BlendingEnable, 1) === 1,
          src: num(x.values.BlendingSrcType, 5), dst: num(x.values.BlendingDestType, 6), colorOp: num(x.values.ColorOperationType, 4),
          factor: (x.values.ColorFactor || [1, 1, 1, 1]).map(Number), alpha: events(x.lists.TimeEventAlpha)
        }))
      });
      continue;
    }
    if (g.name !== "Particle") continue;
    const em = g.groups.find((x) => x.name === "EmitterProperty"), pp = g.groups.find((x) => x.name === "ParticleProperty");
    if (!em || !pp) continue;
    const pos = (g.lists.TimeEventPosition || [])[0];
    const E = em.values, P = pp.values, L = em.lists, Q = pp.lists;
    systems.push({
      start: num(g.values.StartTime),
      position: pos ? pos.slice(-3).map(Number) : [0, 0, 0],
      maxCount: Math.min(400, num(E.MaxEmissionCount, 50)),
      cycle: num(E.CycleLength, 1) || 1, loop: num(E.CycleLoopEnable, 1) === 1, loopCount: num(E.LoopCount),
      shape: num(E.EmitterShape), advanced: num(E.EmitterAdvancedType), radius: num(E.EmittingRadius), edge: num(E.EmitterEmitFromEdgeFlag) === 1,
      emitSize: (E.EmittingSize || [0, 0, 0]).map(Number), spread: (E.EmittingDirection || [0, 0, 0]).map(Number),
      ev: {
        size: events(L.TimeEventEmittingSize), dirX: events(L.TimeEventEmittingDirectionX), dirY: events(L.TimeEventEmittingDirectionY),
        dirZ: events(L.TimeEventEmittingDirectionZ), velocity: events(L.TimeEventEmittingVelocity), count: events(L.TimeEventEmissionCountPerSecond),
        life: events(L.TimeEventLifeTime), sizeX: events(L.TimeEventSizeX), sizeY: events(L.TimeEventSizeY)
      },
      src: num(P.SrcBlendType, 5), dst: num(P.DestBlendType, 2), colorOp: num(P.ColorOperationType, 4),
      rotationType: num(P.RotationType), rotationSpeed: num(P.RotationSpeed), rotationStart: [num(P.RotationRandomStartingBegin), num(P.RotationRandomStartingEnd)],
      pv: {
        gravity: events(Q.TimeEventGravity), air: events(Q.TimeEventAirResistance), scaleX: events(Q.TimeEventScaleX), scaleY: events(Q.TimeEventScaleY),
        r: events(Q.TimeEventColorRed), g: events(Q.TimeEventColorGreen), b: events(Q.TimeEventColorBlue), a: events(Q.TimeEventAlpha), rotation: events(Q.TimeEventRotation)
      },
      textures: (Q.TextureFiles || []).map((r) => r[0]).filter(Boolean)
    });
  }
  return { radius: num(root.values.BoundingSphereRadius, 100), systems, meshes };
}

function at(ev, t, d = 0) {
  if (!ev.length) return d;
  if (ev.length === 1 || t <= ev[0][0]) return ev[0][1];
  const last = ev[ev.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < ev.length; i++) {
    if (t <= ev[i][0]) { const [t0, v0] = ev[i - 1], [t1, v1] = ev[i]; return t1 > t0 ? v0 + (v1 - v0) * (t - t0) / (t1 - t0) : v1; }
  }
  return last[1];
}

/* ---------- textures and materials ---------- */

const ddsLoader = new DDSLoader(), texLoader = new THREE.TextureLoader();
export function assetPath(dir, name) {
  const n = String(name).replace(/\\/g, "/");
  if (/^[a-z]:\//i.test(n)) return "d:/" + n.slice(3);
  if (/^ymir work\//i.test(n)) return "d:/" + n;
  return `${dir}/${n}`;
}
const textures = new Map();
export function effectTexture(game) {
  const key = game.toLowerCase();
  if (!textures.has(key)) {
    textures.set(key, (async () => {
      if (/\.dds$/i.test(game)) {
        const url = await window.studio.textureUrl(game);
        const dds = url ? await new Promise((res) => ddsLoader.load(url, res, undefined, () => res(null))) : null;
        if (dds) return dds;                                         // else e.g. a PNG saved as .dds: texconv below
      }
      const png = await window.studio.texturePreview(game);       // tga / png via texconv
      return png ? await new Promise((res) => texLoader.load(png, res, undefined, () => res(null))) : null;
    })());
  }
  return textures.get(key);
}

const BLEND = [null, THREE.ZeroFactor, THREE.OneFactor, THREE.SrcColorFactor, THREE.OneMinusSrcColorFactor, THREE.SrcAlphaFactor,
  THREE.OneMinusSrcAlphaFactor, THREE.DstAlphaFactor, THREE.OneMinusDstAlphaFactor, THREE.DstColorFactor, THREE.OneMinusDstColorFactor];
export const POINT_SCALE = { value: 800 };      // pixels per meter at 1 m distance: viewport height / (2 tan(fov/2)), set by the app
export function setEffectViewport(height, fovDeg) { const old = POINT_SCALE.value; POINT_SCALE.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2)); return old; }
export function restoreEffectViewport(value) { POINT_SCALE.value = value; }

function systemMaterial(sys) {
  // D3DTOP: 2 texture, 3 colour, 4 modulate, 5 modulate 2×, 6 modulate 4×, 7 add
  const op = sys.colorOp;
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, hasMap: { value: 0 }, scale: POINT_SCALE, gain: { value: op === 5 ? 2 : op === 6 ? 4 : 1 }, add: { value: op === 7 ? 1 : 0 } },
    vertexShader: `
      attribute vec2 aSize; attribute vec4 aColor; attribute float aRot;
      uniform float scale;
      varying vec4 vColor; varying float vRot; varying vec2 vAspect;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float s = max(aSize.x, aSize.y);
        gl_PointSize = s * scale / max(0.1, -mv.z);
        vColor = aColor; vRot = aRot; vAspect = s > 0.0 ? vec2(s / max(aSize.x, 1e-4), s / max(aSize.y, 1e-4)) : vec2(1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform float hasMap; uniform float gain; uniform float add;
      varying vec4 vColor; varying float vRot; varying vec2 vAspect;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float c = cos(vRot), s = sin(vRot);
        p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) * vAspect + 0.5;
        if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) discard;
        vec4 t = hasMap > 0.5 ? texture2D(map, p) : vec4(1.0, 1.0, 1.0, 1.0 - smoothstep(0.3, 0.5, length(p - 0.5)));
        vec4 col = add > 0.5 ? vec4(t.rgb + vColor.rgb, t.a * vColor.a) : vec4(t.rgb * vColor.rgb * gain, t.a * vColor.a);
        if (col.a < 0.004) discard;
        gl_FragColor = col;
      }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: BLEND[sys.src] || THREE.SrcAlphaFactor, blendDst: BLEND[sys.dst] || THREE.OneFactor, blendEquation: THREE.AddEquation
  });
}

/* ---------- simulation ---------- */

const rnd = (a, b) => a + Math.random() * (b - a);

class ParticleSystem {
  constructor(sys, dir) {
    this.sys = sys; this.particles = []; this.time = 0; this.residue = 0; this.loops = 0;
    const n = sys.maxCount;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    geo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    geo.setAttribute("aRot", new THREE.BufferAttribute(new Float32Array(n), 1));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 4);
    this.points = new THREE.Points(geo, systemMaterial(sys));
    this.points.frustumCulled = false;
    this.ready = !sys.textures[0] ? Promise.resolve() : effectTexture(assetPath(dir, sys.textures[0])).then((t) => {
      if (!t) return;
      t.colorSpace = THREE.SRGBColorSpace;
      this.points.material.uniforms.map.value = t; this.points.material.uniforms.hasMap.value = 1;
    });
  }
  emit(t, dt) {
    const s = this.sys, ev = s.ev;
    let make = at(ev.count, t) * dt + this.residue;
    let n = Math.floor(make); this.residue = make - n;
    n = Math.min(n, s.maxCount - this.particles.length);
    if (n <= 0) return;
    const life = at(ev.life, t);
    if (!life) return;
    const esize = at(ev.size, t), dir = [at(ev.dirX, t), at(ev.dirY, t), at(ev.dirZ, t)], vel = at(ev.velocity, t);
    const hx = at(ev.sizeX, t), hy = at(ev.sizeY, t), [ox, oy, oz] = s.position;
    for (let i = 0; i < n; i++) {
      let p = [0, 0, 0];
      if (s.shape === 1 || s.shape === 3) {
        p = [rnd(-1, 1), rnd(-1, 1), s.shape === 3 ? rnd(-1, 1) : 0];
        const len = Math.hypot(...p) || 1, r = (s.edge ? s.radius : rnd(0, s.radius)) + esize;
        p = p.map((v) => (v / len) * r);
      } else if (s.shape === 2) p = [0, 1, 2].map((k) => rnd(-s.emitSize[k] / 2, s.emitSize[k] / 2) + esize);
      const v = [0, 0, 0];
      if (s.advanced === 1 || s.advanced === 2) {
        const len = Math.hypot(...p);
        if (s.advanced === 1 && s.shape === 0) { v[0] = rnd(-100, 100); v[1] = rnd(-100, 100); v[2] = rnd(-100, 100); }
        else if (len) for (let k = 0; k < 3; k++) v[k] = (p[k] / len) * (s.advanced === 2 ? -100 : 100);
      }
      for (let k = 0; k < 3; k++) {
        v[k] += dir[k];
        if (s.spread[k] > 0) v[k] += rnd(-s.spread[k] / 2, s.spread[k] / 2) * 1000;
        v[k] *= vel;
      }
      const sign = s.rotationType === 4 ? (Math.random() < 0.5 ? -1 : 1) : s.rotationType === 3 ? -1 : 1;
      this.particles.push({ x: p[0] + ox, y: p[1] + oy, z: p[2] + oz, vx: v[0], vy: v[1], vz: v[2], life, left: life, hx, hy,
        rot: rnd(s.rotationStart[0], s.rotationStart[1]), spin: sign });
    }
  }
  update(dt) {
    const s = this.sys;
    this.time += dt;
    let t = this.time - s.start;
    if (t >= 0) {
      if (t >= s.cycle && s.loop && (!s.loopCount || this.loops < s.loopCount)) { this.time -= s.cycle; this.loops++; t -= s.cycle; }
      if (t < s.cycle || s.loop) this.emit(Math.min(t, s.cycle), dt);
    }
    const pv = s.pv, geo = this.points.geometry;
    const pos = geo.attributes.position.array, size = geo.attributes.aSize.array, col = geo.attributes.aColor.array, rot = geo.attributes.aRot.array;
    let n = 0;
    const keep = [];
    for (const p of this.particles) {
      p.left -= dt;
      if (p.left < 0) continue;
      const f = (p.life - p.left) / p.life;
      const air = at(pv.air, f);
      if (air) { const k = Math.pow(Math.max(0, 1 - air), dt * 60); p.vx *= k; p.vy *= k; p.vz *= k; }
      p.vz -= at(pv.gravity, f) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (s.rotationType === 1) p.rot = at(pv.rotation, f);
      else if (s.rotationType >= 2) p.rot += p.spin * s.rotationSpeed * dt;
      keep.push(p);
      // cm z-up -> scene meters y-up
      pos[n * 3] = p.x / 100; pos[n * 3 + 1] = p.z / 100; pos[n * 3 + 2] = -p.y / 100;
      size[n * 2] = (2 * p.hx * at(pv.scaleX, f, 1)) / 100; size[n * 2 + 1] = (2 * p.hy * at(pv.scaleY, f, 1)) / 100;
      col[n * 4] = at(pv.r, f, 1); col[n * 4 + 1] = at(pv.g, f, 1); col[n * 4 + 2] = at(pv.b, f, 1); col[n * 4 + 3] = at(pv.a, f, 1);
      rot[n] = THREE.MathUtils.degToRad(p.rot);
      n++;
    }
    this.particles = keep;
    geo.setDrawRange(0, n);
    for (const a of ["position", "aSize", "aColor", "aRot"]) geo.attributes[a].needsUpdate = true;
  }
}

/* ---------- mesh elements (.mde) ---------- */

// "EffectData" (v1: one vertex/index layout for all frames) or "MDEData002" (v2: per-frame layout with a changed flag).
// Each frame becomes a non-indexed triangle list: positions (cm, z up) and UVs (v flipped like the client).
function parseMde(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  const head = new TextDecoder("latin1").decode(u8.subarray(0, 10));
  const v2 = head === "MDEData002";
  if (!v2 && head !== "EffectData") return null;
  let p = 11;
  const i32 = () => { const v = dv.getInt32(p, true); p += 4; return v; };
  const f32 = () => { const v = dv.getFloat32(p, true); p += 4; return v; };
  const str = (n) => { const t = new TextDecoder("latin1").decode(u8.subarray(p, p + n)); p += n; return t.replace(/\0.*$/s, ""); };
  const geoms = [], count = i32(), frames = i32();
  for (let g = 0; g < count; g++) {
    const name = str(32), map = str(128), out = [];
    let vc = 0, ic = 0, tc = 0;
    if (!v2) { vc = i32(); ic = i32(); tc = i32(); }
    for (let f = 0; f < frames; f++) {
      let vis;
      if (v2) { p += 1; vis = f32(); vc = i32(); ic = i32(); tc = i32(); } else vis = f32();
      const verts = new Float32Array(buf.slice(p, p + vc * 12)); p += vc * 12;
      const idx = new Int32Array(buf.slice(p, p + ic * 4)); p += ic * 4;
      const uvs = new Float32Array(buf.slice(p, p + tc * 8)); p += tc * 8;
      const tidx = new Int32Array(buf.slice(p, p + ic * 4)); p += ic * 4;
      const pos = new Float32Array(ic * 3), uv = new Float32Array(ic * 2);
      for (let j = 0; j < ic; j++) {
        const a = idx[j] * 3, b = tidx[j] * 2;
        pos[j * 3] = verts[a] / 100; pos[j * 3 + 1] = verts[a + 2] / 100; pos[j * 3 + 2] = -verts[a + 1] / 100;   // cm z-up -> m y-up
        uv[j * 2] = uvs[b]; uv[j * 2 + 1] = -uvs[b + 1];
      }
      out.push({ vis, pos, uv });
    }
    geoms.push({ name, map, frames: out });
  }
  return { frames, geoms };
}

const mdeCache = new Map();
function loadMde(game) {
  const key = game.toLowerCase();
  if (!mdeCache.has(key)) {
    mdeCache.set(key, (async () => {
      const url = await window.studio.textureUrl(game);
      if (!url) return null;
      return parseMde(await (await fetch(url)).arrayBuffer());
    })().catch(() => null));
  }
  return mdeCache.get(key);
}
// a diffuse map may be an .ifl list of frames: show the first one
async function meshTexture(dir, map) {
  if (!map) return null;
  let game = assetPath(dir, map);
  if (/\.ifl$/i.test(game)) {
    const url = await window.studio.textureUrl(game);
    if (!url) return null;
    const first = (await (await fetch(url)).text()).split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    if (!first) return null;
    game = game.replace(/[^/]*$/, "") + first;
  }
  return effectTexture(game);
}

class MeshElement {
  constructor(mesh, dir) {
    this.mesh = mesh; this.time = 0;
    this.group = new THREE.Group();
    const [x, y, z] = mesh.position;
    this.group.position.set(x / 100, z / 100, -y / 100);
    this.parts = [];
    this.ready = loadMde(assetPath(dir, mesh.file)).then(async (mde) => {
      if (!mde) return;
      this.mde = mde;
      for (let g = 0; g < mde.geoms.length; g++) {
        const el = mesh.elements[g] || mesh.elements[0] || { billboard: 0, blend: true, src: 5, dst: 6, colorOp: 4, factor: [1, 1, 1, 1], alpha: [] };
        const gain = el.colorOp === 5 ? 2 : el.colorOp === 6 ? 4 : 1;
        const both = el.src === 12 || el.src === 13;                  // D3DBLEND_BOTHSRCALPHA: normal alpha blending
        const mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(el.factor[0] * gain, el.factor[1] * gain, el.factor[2] * gain), opacity: el.factor[3],
          transparent: true, depthWrite: false, side: THREE.DoubleSide,
          blending: el.blend ? THREE.CustomBlending : THREE.NormalBlending,
          blendSrc: both ? THREE.SrcAlphaFactor : BLEND[el.src] || THREE.SrcAlphaFactor,
          blendDst: both ? THREE.OneMinusSrcAlphaFactor : BLEND[el.dst] || THREE.OneMinusSrcAlphaFactor
        });
        const tex = await meshTexture(dir, mde.geoms[g].map);
        if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; mat.map = tex; mat.needsUpdate = true; }
        const geo = new THREE.BufferGeometry();
        const f0 = mde.geoms[g].frames[0];
        geo.setAttribute("position", new THREE.BufferAttribute(f0.pos, 3));
        geo.setAttribute("uv", new THREE.BufferAttribute(f0.uv, 2));
        geo.computeBoundingSphere();
        const m = new THREE.Mesh(geo, mat);
        m.frustumCulled = false;
        if (el.billboard === 1 || el.billboard === 2) {
          const yOnly = el.billboard === 2;
          m.onBeforeRender = (r, sc, cam) => {
            if (yOnly) { const d = cam.position.clone().sub(m.getWorldPosition(new THREE.Vector3())); m.rotation.set(0, Math.atan2(d.x, d.z), 0); }
            else m.quaternion.copy(cam.quaternion);
          };
        }
        this.group.add(m);
        this.parts.push({ mesh: m, geom: mde.geoms[g], el, frame: 0 });
      }
    });
  }
  update(dt) {
    if (!this.mde) return;
    this.time += dt;
    const t = this.time - this.mesh.start;
    const length = this.mde.frames * this.mesh.frameDelay;
    if (t < 0) { this.group.visible = false; return; }
    this.group.visible = this.mesh.loop || t < length;
    const local = this.mesh.loop && length > 0 ? t % length : Math.min(t, length);
    const frame = Math.min(this.mde.frames - 1, Math.floor(local / this.mesh.frameDelay));
    for (const part of this.parts) {
      const f = part.geom.frames[frame];
      if (frame !== part.frame && f.pos.length === part.mesh.geometry.attributes.position.array.length) {
        part.mesh.geometry.attributes.position.array.set(f.pos); part.mesh.geometry.attributes.position.needsUpdate = true;
        part.mesh.geometry.attributes.uv.array.set(f.uv); part.mesh.geometry.attributes.uv.needsUpdate = true;
      } else if (frame !== part.frame) {
        part.mesh.geometry.setAttribute("position", new THREE.BufferAttribute(f.pos, 3));
        part.mesh.geometry.setAttribute("uv", new THREE.BufferAttribute(f.uv, 2));
      }
      part.frame = frame;
      part.mesh.visible = f.vis > 0.001;
      part.mesh.material.opacity = part.el.factor[3] * (part.el.alpha.length ? at(part.el.alpha, local) : 1) * Math.min(1, f.vis);
    }
  }
}

/* ---------- scene node ---------- */

export const liveEffects = new Set();

// An effect object: a small selectable marker plus one point cloud per particle system. clone() starts its own
// simulation, so every placed copy animates independently.
export class EffectNode extends THREE.Group {
  constructor(data, dir) {
    super();
    this.isEffect = true; this.data = data; this.dir = dir;
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial({ color: 0xe0b040, transparent: true, opacity: 0.3, depthWrite: false }));
    marker.position.y = 0.2;
    marker.userData.effectMarker = true;          // for picking in the map; thumbnails hide it
    this.add(marker);
    this.systems = data.systems.map((s) => new ParticleSystem(s, dir));
    for (const s of this.systems) this.add(s.points);
    this.meshes = (data.meshes || []).map((m) => new MeshElement(m, dir));
    for (const m of this.meshes) this.add(m.group);
    this.ready = Promise.all([...this.systems, ...this.meshes].map((s) => s.ready));
    liveEffects.add(this);
  }
  clone() { return new EffectNode(this.data, this.dir); }
  update(dt) { for (const s of this.systems) s.update(dt); for (const m of this.meshes) m.update(dt); }
  warm(seconds) { for (let t = 0; t < seconds; t += 1 / 30) this.update(1 / 30); }
  dispose() { liveEffects.delete(this); }
}

// once per frame from the app: animate placed effects, forget the ones that were removed from the map
export function updateEffects(dt) {
  for (const e of liveEffects) {
    if (!e.parent) { if (e.wasPlaced) liveEffects.delete(e); continue; }
    e.wasPlaced = true;
    e.update(dt);
  }
}

export async function loadEffect(url, dir) {
  const text = await (await fetch(url)).text();
  return new EffectNode(parseMse(text), dir);
}
