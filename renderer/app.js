import * as THREE from "three";
import { FlyControls } from "./fly.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { TerrainModel, TerrainView } from "./terrain.js";
import { TOOLS, paint, sample, attrMask, BrushCursor } from "./brush.js";
import { applySpline } from "./spline.js";
import { reachable, patches } from "./reach.js";
import { planSpawns } from "./spawnplan.js";
import { forestEdge } from "./forestedge.js";
import { generateTerrain } from "./terraingen.js";
import { autoTexture } from "./autotexture.js";
import { scatter } from "./scatter.js";
import { importRegion } from "./importregion.js";
import { ObjectLayer, template, toScene, fromScene, AMBIENCE_DEFAULT } from "./objects.js";
import { thumbnail } from "./thumbs.js";
import { Environment } from "./env.js";
import { Walker, CLASSES } from "./walker.js";
import { SpawnLayer, SPAWN_TYPES } from "./spawns.js";
import { updateEffects, setEffectViewport } from "./effects.js";

const $ = (id) => document.getElementById(id);
const deg = THREE.MathUtils.radToDeg, rad = THREE.MathUtils.degToRad;

/* ---------- scene ---------- */

const viewport = $("viewport");
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);
viewport.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb3cf);
scene.fog = new THREE.Fog(0x8fb3cf, 400, 1400);
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 6000);
const hemi = new THREE.HemisphereLight(0xdfeaff, 0x5a5040, 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3dd, 2.0);
sun.position.set(200, 400, 150);
scene.add(sun);
const environment = new Environment(scene, sun, hemi);
let envName = "", envDirty = false, envList = null;

const fly = new FlyControls(camera, renderer.domElement, (x, z) => (heights ? heights.at(x, z) : 0));
const gizmo = new TransformControls(camera, renderer.domElement);
const walker = new Walker(scene, camera, renderer.domElement, () => heights);
gizmo.setSpace("world");
scene.add(gizmo.getHelper ? gizmo.getHelper() : gizmo);

const layer = new ObjectLayer();
scene.add(layer.root);
const selBox3 = new THREE.Box3();
const selBox = new THREE.Box3Helper(selBox3, 0xffd27a);
selBox.visible = false;
scene.add(selBox);

function resize() {
  const r = viewport.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
  setEffectViewport(r.height, camera.fov);
}
new ResizeObserver(resize).observe(viewport);

/* ---------- state ---------- */

let map = null, heights = null, view = null, terrainGroup = null;   // heights = TerrainModel (has .at)
let objects = [];               // { id, crc, x, y, z, yaw, pitch, roll, bias } in Metin2 units (cm, y negative)
let nextId = 1;
let selected = null;
let dirty = false;
const undoStack = [], redoStack = [];
let library = [];
const libByCrc = new Map();
let placing = null;             // { crc, name, ghost, yaw }

function setMsg(text, warn) { const el = $("st-msg"); el.textContent = text; el.classList.toggle("warn", !!warn); }
function snapshot() { return JSON.stringify(objects); }
// History entries: { kind: "objects", state: json } or { kind: "terrain", state: Map(chunk -> arrays) }.
function pushHistory(before, kind = "objects") {
  undoStack.push({ kind, state: before }); if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  if (kind === "objects") dirty = true;
  if (kind === "spawns") spawnsDirty = true;
  updateUi();
}
function restore(entry) {
  if (entry.kind === "terrain") {
    const current = heights.restore(entry.state);
    view.refresh(entry.state.keys(), new Set(["height", "tile", "water", "attr"]));
    updateUi();
    return { kind: "terrain", state: current };
  }
  if (entry.kind === "spawns") {
    const current = { kind: "spawns", state: spawnState() };
    ({ spawns, town } = JSON.parse(entry.state)); spawnsDirty = true;
    if (!spawns.some((x) => x.id === selectedSpawn)) selectedSpawn = null;
    rebuildSpawns(); syncSpawnForm(); updateUi();
    return current;
  }
  const current = { kind: "objects", state: snapshot() };
  objects = JSON.parse(entry.state); layer.sync(objects); syncSelection(); dirty = true; updateUi();
  return current;
}

function updateUi() {
  $("btn-save").disabled = !map;
  $("btn-undo").disabled = !undoStack.length;
  $("btn-redo").disabled = !redoStack.length;
  $("st-objects").textContent = `${objects.length} objektov`;
  const unsaved = dirty || envDirty || spawnsDirty || (heights && heights.isDirty);
  $("map-name").textContent = map ? map.name + (unsaved ? " •" : "") : "Žiadna mapa";
  document.title = map ? `${map.name}${unsaved ? " •" : ""} – APIX Map Studio` : "APIX Map Studio";
}

/* ---------- map loading ---------- */

// overview of the whole map from the south, also the way back after flying off into the sky (H)
function resetView() {
  if (!map) return;
  const w = map.size[0] * 256, d = map.size[1] * 256;
  camera.position.set(w / 2, heights.at(w / 2, d / 2) + w * 0.55, d / 2 + w * 0.75);
  fly.lookAt(new THREE.Vector3(w / 2, heights.at(w / 2, d / 2), d / 2));
}

async function openMap(dir) {
  if (!dir) return;
  setMsg("Načítavam mapu…");
  let data;
  try { data = await window.studio.openMap(dir); } catch (e) { setMsg(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true); return; }
  map = data;
  heights = new TerrainModel(map);
  if (view) scene.remove(view.group, view.water);
  view = new TerrainView(heights);
  terrainGroup = view.group;
  scene.add(view.group, view.water);
  applyAttrView();
  renderPalette();
  layer.clear();
  objects = map.objects.map((o) => ({ ...o, id: nextId++ }));
  for (const o of objects) layer.add(o);
  await loadSpawns();
  undoStack.length = redoStack.length = 0; dirty = false;
  select(null);
  resetView();
  const w = map.size[0] * 256;
  camera.far = Math.max(6000, w * 6); camera.updateProjectionMatrix();
  environment.apply(map.environment, view);
  envName = map.environment ? map.environment.name : ""; envDirty = false;
  $("empty-state").hidden = true;
  updateUi();
  setMsg(`Mapa ${map.name}: ${map.size[0]}×${map.size[1]}, ${objects.length} objektov, ${map.textures.length} textúr.`);
}

layer.onLoaded = (pending) => {
  $("st-models").textContent = pending ? `načítavam modely: ${pending}` : "";
  if (selection.size) refreshSelBox();
  if (!pending && shotRequested) setTimeout(() => window.studio.readyForShot(), 800);
};

// Sound ambience objects belong in AreaAmbienceData.txt with a range; everything else in AreaData.txt.
function isAmbience(crc) { const p = libByCrc.get(crc); return Boolean(p && /^ambience$/i.test(p.type)); }
function withKind(o) {
  if (o.ambience || isAmbience(o.crc)) return { ...o, ambience: { ...AMBIENCE_DEFAULT, ...(o.ambience || {}) } };
  const { ambience, ...rest } = o;
  return rest;
}

async function save() {
  if (!map) return;
  try {
    const parts = [];
    let backup = "";
    // a map from an older Studio (rotation in the first AreaData number) is rewritten in the client order on every save
    if (dirty || map.legacyRotation) {
      const r = await window.studio.saveMap(map.dir, map.size, objects.map(({ id, terrain, ...o }) => withKind(o)));
      parts.push(`${r.written} objektov${map.legacyRotation ? " (rotácie prevedené do poradia klienta)" : ""}`); backup = r.backup; dirty = false; map.legacyRotation = false;
    }
    if (envDirty) {
      const r = await window.studio.setEnvironment(map.dir, envName);
      parts.push(`prostredie ${envName || "(žiadne)"}`); backup = r.backup; envDirty = false;
    }
    if (spawnsDirty) {
      const r = await window.studio.saveSpawns(map.dir, spawns, town);
      parts.push(`${r.count} spawnov`); if (r.backup) backup = r.backup; spawnsDirty = false;
    }
    if (heights.isDirty) {
      const r = await window.studio.saveTerrain(map.dir, heights.savePayload());
      heights.markSaved();
      parts.push(`terén (${r.files.length} súborov)`); backup = r.backup;
    }
    updateUi();
    setMsg(parts.length ? `Uložené: ${parts.join(", ")}. Záloha pôvodných súborov je v ${backup}.` : "Nie je čo ukladať.");
  } catch (e) { setMsg("Uloženie zlyhalo: " + e.message, true); }
}

/* ---------- selection & editing ----------
   One or many objects can be selected; the gizmo drives a pivot at their centre and every selected
   object follows it (moved, or rotated around the pivot). */

const selection = new Set();
const pivot = new THREE.Group();
scene.add(pivot);
const UP = new THREE.Vector3(0, 1, 0);
let clipboard = null;           // { items: [{ crc, dx, dz, lift, yaw }] } relative to the selection centre

function selectedObjects() { return objects.filter((o) => selection.has(o.id)); }
function centroid(list) {
  const c = new THREE.Vector3();
  for (const o of list) c.add(toScene(o));
  return list.length ? c.divideScalar(list.length) : c;
}
function refreshSelBox() {
  selBox3.makeEmpty();
  for (const id of selection) { const n = layer.nodes.get(id); if (n) selBox3.expandByObject(n); }
  selBox.visible = !selBox3.isEmpty();
}
function placePivot() {
  const sel = selectedObjects();
  if (!sel.length || mode === "terrain") { gizmo.detach(); return; }
  pivot.position.copy(centroid(sel));
  pivot.rotation.set(0, sel.length === 1 ? rad(sel[0].yaw) : 0, 0);
  pivot.updateMatrixWorld();
  gizmo.attach(pivot);
}
function syncSelection() {
  for (const id of [...selection]) if (!objects.some((o) => o.id === id)) selection.delete(id);
  if (selected && !selection.has(selected.id)) selected = null;
  if (!selected && selection.size) selected = objects.find((o) => selection.has(o.id));
  if (selected) selected = objects.find((o) => o.id === selected.id) || null;
  placePivot(); refreshSelBox(); renderInspector();
}
// add: keep the current selection; with toggle a second click removes the object again
function select(id, { add = false, toggle = false } = {}) {
  if (!add) selection.clear();
  if (id) {
    if (toggle && selection.has(id)) selection.delete(id); else selection.add(id);
    selected = selection.has(id) ? objects.find((o) => o.id === id) : null;
  } else selected = null;
  syncSelection();
}
function selectMany(ids, add = false) {
  if (!add) selection.clear();
  for (const id of ids) selection.add(id);
  selected = null;
  syncSelection();
}

function setMode(m) {
  gizmo.setMode(m);
  gizmo.showX = gizmo.showZ = m === "translate";
  gizmo.showY = true;
  $("mode-move").setAttribute("aria-pressed", String(m === "translate"));
  $("mode-rotate").setAttribute("aria-pressed", String(m === "rotate"));
}

let dragBefore = null, dragStart = null;
gizmo.addEventListener("dragging-changed", (e) => {
  fly.enabled = !e.value;
  if (e.value) {
    dragBefore = snapshot();
    dragStart = { pivot: pivot.position.clone(), rot: pivot.rotation.y, items: selectedObjects().map((o) => {
      const p = toScene(o);
      return { o, p, yaw: o.yaw, lift: heights ? p.y - heights.at(p.x, p.z) : 0 };
    }) };
  } else if (dragBefore) {
    pushHistory(dragBefore); dragBefore = null; dragStart = null;
    placePivot(); renderInspector();
  }
});
gizmo.addEventListener("objectChange", () => {
  if (!dragStart) return;
  pivot.rotation.x = 0; pivot.rotation.z = 0;
  const d = pivot.position.clone().sub(dragStart.pivot), r = pivot.rotation.y - dragStart.rot;
  // Ground snap only for horizontal handles (X, Z, XZ plane); the centre handle and anything with Y move freely.
  // It follows the terrain but keeps each object's height above it, so a lifted object is not dropped back down.
  const snapGround = $("snap").checked && gizmo.mode === "translate" && heights && !/Y|E/.test(gizmo.axis || "");
  for (const it of dragStart.items) {
    const np = it.p.clone().sub(dragStart.pivot).applyAxisAngle(UP, r).add(dragStart.pivot).add(d);
    if (snapGround) np.y = heights.at(np.x, np.z) + it.lift;
    Object.assign(it.o, fromScene(np));
    it.o.yaw = (((it.yaw + deg(r)) % 360) + 360) % 360;
    const node = layer.nodes.get(it.o.id);
    if (node) layer.place(node, it.o);
  }
  refreshSelBox();
  renderInspectorValues();
});

function change(fn) {
  const before = snapshot();
  fn();
  layer.sync(objects);
  pushHistory(before);
  syncSelection();
}

// Shift+R: round the selected objects' rotation to the 15° grid
function snapRotation() {
  const sel = selectedObjects();
  change(() => { for (const o of sel) o.yaw = (Math.round((o.yaw || 0) / 15) * 15 + 360) % 360; });
  setMsg(`Rotácia ${sel.length} objektov zarovnaná na 15°.`);
}
function removeSelected() {
  if (!selection.size) return;
  const n = selection.size;
  change(() => { objects = objects.filter((o) => !selection.has(o.id)); selection.clear(); selected = null; });
  setMsg(n > 1 ? `Zmazaných ${n} objektov.` : "Objekt zmazaný.");
}
function duplicateSelected() {
  const sel = selectedObjects();
  if (!sel.length) return;
  const copies = sel.map((o) => {
    const c = { ...o, id: nextId++ };
    const p = toScene(c); p.x += 3; p.z += 3;
    if (heights) p.y = heights.at(p.x, p.z) + (toScene(o).y - heights.at(toScene(o).x, toScene(o).z));
    return Object.assign(c, fromScene(p));
  });
  change(() => { objects.push(...copies); selection.clear(); copies.forEach((c) => selection.add(c.id)); selected = copies[0]; });
  setMsg(copies.length > 1 ? `Zduplikovaných ${copies.length} objektov.` : "Objekt zduplikovaný.");
}
function focusSelected() {
  const sel = selectedObjects();
  if (!sel.length) return;
  const p = centroid(sel), off = fly.forward().negate().setLength(sel.length > 1 ? 70 : 40);
  if (off.y < 8) off.y = 8;
  camera.position.copy(p).add(off);
  fly.lookAt(p);
}
function groundSelected() {
  change(() => { for (const o of selectedObjects()) { const p = toScene(o); o.z = heights.at(p.x, p.z) * 100; } });
}

// Group layout relative to its centre; lift = height above the ground, so a pasted group hugs new terrain.
function captureGroup(list) {
  const c = centroid(list);
  return list.map((o) => { const p = toScene(o); return { crc: o.crc, dx: +(p.x - c.x).toFixed(3), dz: +(p.z - c.z).toFixed(3), lift: +(p.y - heights.at(p.x, p.z)).toFixed(3), yaw: o.yaw }; });
}
function placeGroup(items, x, z, yaw = 0, extra = 0) {
  const r = rad(yaw);
  return items.map((it) => {
    const v = new THREE.Vector3(it.dx, 0, it.dz).applyAxisAngle(UP, r);
    const px = x + v.x, pz = z + v.z;
    const o = { id: nextId++, crc: it.crc, ...fromScene(new THREE.Vector3(px, heights.at(px, pz) + (it.lift || 0) + extra, pz)), yaw: ((((it.yaw || 0) + yaw) % 360) + 360) % 360, pitch: 0, roll: 0, bias: 0 };
    return o;
  });
}
function copySelection() {
  const sel = selectedObjects();
  if (!sel.length) return;
  clipboard = { items: captureGroup(sel) };
  setMsg(`Skopírovaných ${sel.length} objektov. Ctrl+V ich vloží pod kurzor.`);
}
function pasteAt(point) {
  if (!clipboard || !point || !map) return;
  const added = placeGroup(clipboard.items, point.x, point.z);
  change(() => { objects.push(...added); selection.clear(); added.forEach((o) => selection.add(o.id)); selected = added[0]; });
  setMsg(`Vložených ${added.length} objektov.`);
}

/* ---------- inspector ---------- */

async function setEnvironmentByName(name) {
  const env = name ? await window.studio.environment(name) : null;
  environment.apply(env, view);
  envName = name; envDirty = true; updateUi();
  return env;
}

async function renderMapPanel(el) {
  if (!map) { el.innerHTML = `<p class="muted" style="padding:0">Klikni na objekt v mape.</p>`; return; }
  if (!envList) envList = await window.studio.environments();
  el.innerHTML = `<p class="muted" style="padding:0">Klikni na objekt v mape.</p>
    <div class="title">Mapa ${escapeHtml(map.name)}</div>
    <div class="sub">${map.size[0]}×${map.size[1]} terénov · ${map.size[0] * 256}×${map.size[1] * 256} m</div>
    <label class="sub" for="env-select">Prostredie (obloha, svetlo, hmla)</label>
    <select id="env-select"><option value="">(žiadne – predvolené)</option>${envList.map((n) => `<option value="${escapeHtml(n)}" ${n.toLowerCase() === envName.toLowerCase() ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}</select>
    <label class="check sub"><input type="checkbox" id="game-fog" ${environment.gameFog ? "checked" : ""}> Hmla ako v hre (blízko kamery)</label>
    ${map.environment && map.environment.missing ? `<div class="sub warn-text">Prostredie ${escapeHtml(map.environment.name)} sa v klientovi nenašlo.</div>` : ""}`;
  $("game-fog").addEventListener("change", async (e) => { environment.gameFog = e.target.checked; environment.apply(envName ? await window.studio.environment(envName) : null, view); });
  $("env-select").addEventListener("change", (e) => setEnvironmentByName(e.target.value).then(() => setMsg(`Prostredie: ${e.target.value || "predvolené"} (uloží sa s mapou).`)));
}

function renderGroupPanel(el) {
  const sel = selectedObjects();
  const kinds = new Map();
  for (const o of sel) { const n = (libByCrc.get(o.crc) || {}).name || o.crc; kinds.set(n, (kinds.get(n) || 0) + 1); }
  el.innerHTML = `
    <div class="title">Vybraných ${sel.length} objektov</div>
    <div class="sub">${[...kinds].slice(0, 6).map(([n, c]) => `${escapeHtml(n)} ×${c}`).join(" · ")}${kinds.size > 6 ? " …" : ""}</div>
    <div class="row-actions"><button type="button" id="i-ground">Položiť na terén</button><button type="button" id="i-dup">Duplikovať</button><button type="button" id="i-copy">Kopírovať</button><button type="button" class="danger" id="i-del">Zmazať</button></div>
    <label class="sub" for="pf-name">Uložiť ako prefab</label>
    <div class="size-row"><input type="text" id="pf-name" placeholder="napr. tabor_pri_ceste" pattern="[A-Za-z0-9_ -]+"><button type="button" id="pf-save">Uložiť</button></div>`;
  $("i-ground").addEventListener("click", groundSelected);
  $("i-dup").addEventListener("click", duplicateSelected);
  $("i-copy").addEventListener("click", copySelection);
  $("i-del").addEventListener("click", removeSelected);
  $("pf-save").addEventListener("click", () => savePrefab($("pf-name").value.trim()));
}

function renderInspector() {
  const el = $("inspector");
  if (selection.size > 1) { renderGroupPanel(el); return; }
  if (!selected) { renderMapPanel(el); return; }
  const info = libByCrc.get(selected.crc);
  el.innerHTML = `
    <div class="title">${info ? escapeHtml(info.name) : "Neznámy objekt"}</div>
    <div class="sub">${info ? escapeHtml(info.type) + " · " : ""}CRC ${selected.crc}</div>
    ${["x", "y", "z", "yaw"].map((k) => `<div class="field"><label for="f-${k}">${k === "yaw" ? "rotácia" : k + " (cm)"}</label><input type="number" id="f-${k}" step="${k === "yaw" ? 15 : 50}"></div>`).join("")}
    ${isAmbience(selected.crc) || selected.ambience ? `<div class="field"><label for="f-range">dosah (m)</label><input type="number" id="f-range" min="1" step="1"></div>
      <div class="field"><label for="f-percent">plná hlasitosť %</label><input type="number" id="f-percent" min="0" max="100" step="5"></div>
      <p class="sub">Zvuk je počuť do dosahu (modrý kruh), naplno vo vnútornom kruhu. Ukladá sa do AreaAmbienceData.txt.</p>` : ""}
    <div class="row-actions"><button type="button" id="i-ground">Položiť na terén</button><button type="button" id="i-dup">Duplikovať</button><button type="button" id="i-copy">Kopírovať</button><button type="button" class="danger" id="i-del">Zmazať</button></div>
    <p class="sub">Shift + klik pridá ďalší objekt, ťahanie po prázdnom mieste vyberie obdĺžnikom.</p>`;
  renderInspectorValues();
  $("i-copy").addEventListener("click", copySelection);
  for (const k of ["x", "y", "z", "yaw"]) {
    $("f-" + k).addEventListener("change", (e) => {
      const v = Number(e.target.value);
      if (!Number.isFinite(v)) return;
      change(() => { selected[k] = k === "yaw" ? ((v % 360) + 360) % 360 : v; });
    });
  }
  if ($("f-range")) {
    const amb = () => ({ ...AMBIENCE_DEFAULT, ...(selected.ambience || {}) });
    $("f-range").value = Math.round(amb().range / 100); $("f-percent").value = Math.round(amb().percent * 100);
    $("f-range").addEventListener("change", (e) => { const v = Number(e.target.value); if (v > 0) change(() => { selected.ambience = { ...amb(), range: v * 100 }; }); });
    $("f-percent").addEventListener("change", (e) => { const v = Number(e.target.value); if (v >= 0 && v <= 100) change(() => { selected.ambience = { ...amb(), percent: v / 100 }; }); });
  }
  $("i-ground").addEventListener("click", groundSelected);
  $("i-dup").addEventListener("click", duplicateSelected);
  $("i-del").addEventListener("click", removeSelected);
}
function renderInspectorValues() {
  if (!selected || selection.size > 1) return;
  for (const k of ["x", "y", "z", "yaw"]) { const f = $("f-" + k); if (f && document.activeElement !== f) f.value = Math.round(selected[k] * 10) / 10; }
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/* ---------- library & placing ---------- */

let libType = "Building";
const PREFABS = "Prefaby", RECENT = "Posledné";
// the last placed objects, newest first (per viewer, so browser storage is enough)
let recent = [];
try { recent = JSON.parse(localStorage.getItem("apix-recent-objects") || "[]"); } catch { recent = []; }
function rememberRecent(crc) {
  recent = [crc, ...recent.filter((c) => c !== crc)].slice(0, 24);
  try { localStorage.setItem("apix-recent-objects", JSON.stringify(recent)); } catch { /* storage unavailable */ }
}
async function renderPrefabs(q) {
  const list = (await window.studio.prefabs()).filter((p) => !q || p.name.toLowerCase().includes(q));
  if (libType !== PREFABS) return;
  $("lib-list").innerHTML = list.map((p) => `<li data-prefab="${escapeHtml(p.name)}" class="${placing && placing.prefab === p.name ? "active" : ""}">
      <span class="thumb prefab-icon">${p.count}</span><span class="name">${escapeHtml(p.name)}</span>
      <button type="button" class="link" data-del-prefab="${escapeHtml(p.name)}" title="Zmazať prefab">zmazať</button>
      <span class="folder">${p.count} objektov</span></li>`).join("")
    || `<li class="muted">Zatiaľ žiadne prefaby. Vyber viac objektov (Shift) a v paneli Vlastnosti ich ulož ako prefab.</li>`;
}
// catalog data on library rows (tools/build-catalog.js): size in meters and a warning badge for problem assets
const WARNING_TEXT = { "granny-v7": "Granny v7: hra ho bez prevodu nezobrazí", "model-missing": "chýba model", "texture-missing": "chýba textúra",
  "model-unreadable": "model sa nedá prečítať", huge: "obrovský (nad 40 m)", tiny: "takmer neviditeľný", "editor-only": "len vo WorldEditore, nie v klientovi",
  "needs-packing": "Fem: pred hrou zabaliť do klienta", "no-collision": "bez kolízie (namaľovať blok)", "sunk-origin": "počiatok pod modelom" };
const sizeText = (s) => `${s[0].toFixed(1)}×${s[1].toFixed(1)}×${s[2].toFixed(1)} m`;
function catalogNotes(p) {
  const notes = (p.warnings || []).filter((w) => w !== "needs-packing" || !p.usableAfterPacking).map((w) => WARNING_TEXT[w] || w);
  if (p.rating === "avoid" || p.rating === "rim-only") notes.unshift(p.reason || p.rating);
  return notes;
}
function catalogBadge(p) {
  if (p.usable === undefined) return "";
  const bad = p.rating === "avoid" || (p.warnings || []).some((w) => ["granny-v7", "model-missing", "texture-missing", "model-unreadable", "huge", "tiny", "editor-only"].includes(w));
  const notes = catalogNotes(p);
  return notes.length ? ` <span class="${bad ? "warn" : "note"}" title="${escapeHtml(notes.join(" · "))}">${bad ? "⚠" : "ⓘ"}</span>` : "";
}
function renderLibrary() {
  const q = $("lib-search").value.trim().toLowerCase();
  const types = [...new Set(library.map((p) => p.type))].sort();
  $("lib-types").innerHTML = ["Všetko", RECENT, ...types, PREFABS].map((t) => `<button type="button" class="chip" data-type="${escapeHtml(t)}" aria-pressed="${t === libType}">${escapeHtml(t)}</button>`).join("");
  if (libType === PREFABS) { thumbObserver.disconnect(); renderPrefabs(q); return; }
  const matches = (p) => !q || p.name.toLowerCase().includes(q) || p.folder.toLowerCase().includes(q);
  const rows = libType === RECENT ? recent.map((c) => libByCrc.get(c)).filter((p) => p && matches(p))
    : library.filter((p) => (libType === "Všetko" || p.type === libType) && matches(p));
  $("lib-list").innerHTML = rows.slice(0, 400).map((p) =>
    `<li data-crc="${p.crc}" class="${placing && placing.crc === p.crc ? "active" : ""}"><img class="thumb" data-crc="${p.crc}" alt=""><span class="name">${escapeHtml(p.name)}${catalogBadge(p)}</span><span class="type">${escapeHtml(p.type)}${p.size ? ` · ${sizeText(p.size)}` : ""}</span><span class="folder">${escapeHtml(p.folder)}</span></li>`).join("")
    + (rows.length > 400 ? `<li class="muted">… a ďalších ${rows.length - 400}, spresni hľadanie</li>` : "")
    + (!rows.length ? `<li class="muted">Nič nenájdené.</li>` : "");
  thumbObserver.disconnect();
  for (const img of $("lib-list").querySelectorAll("img.thumb")) thumbObserver.observe(img);
}

// Thumbnails render only for rows that scroll into view; the newest visible rows go first.
const thumbObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const img = e.target;
    thumbObserver.unobserve(img);
    thumbnail(Number(img.dataset.crc), true).then((url) => { if (url) img.src = url; img.classList.add("ready"); });
  }
}, { root: $("lib-list"), rootMargin: "120px" });

function showPreview(crc) {
  const p = libByCrc.get(crc);
  const box = $("lib-preview");
  if (!p) { box.hidden = true; return; }
  box.hidden = false;
  $("pv-name").textContent = p.name;
  const notes = catalogNotes(p);
  $("pv-meta").textContent = `${p.type} · ${p.folder || "property"} · CRC ${p.crc}${p.size ? ` · ${sizeText(p.size)}` : ""}${notes.length ? ` · ${notes.join(" · ")}` : ""}`;
  const img = $("pv-img");
  img.removeAttribute("src");
  img.dataset.crc = crc;
  thumbnail(crc, true).then((url) => { if (url && img.dataset.crc === String(crc)) img.src = url; });
}
$("lib-list").addEventListener("mouseover", (e) => { const li = e.target.closest("[data-crc]"); if (li) showPreview(Number(li.dataset.crc)); });
$("lib-list").addEventListener("mouseleave", () => { if (placing && placing.crc) showPreview(placing.crc); else $("lib-preview").hidden = true; });
$("lib-search").addEventListener("input", renderLibrary);
$("lib-types").addEventListener("click", (e) => { const b = e.target.closest("[data-type]"); if (b) { libType = b.dataset.type; renderLibrary(); } });
$("lib-list").addEventListener("click", async (e) => {
  const del = e.target.closest("[data-del-prefab]");
  if (del) { e.stopPropagation(); await window.studio.deletePrefab(del.dataset.delPrefab); renderLibrary(); setMsg(`Prefab ${del.dataset.delPrefab} zmazaný.`); return; }
  const pf = e.target.closest("[data-prefab]");
  if (pf && map) { startPlacingPrefab(pf.dataset.prefab); return; }
  const li = e.target.closest("[data-crc]");
  if (li && map) startPlacing(Number(li.dataset.crc));
});

async function savePrefab(name) {
  if (!name) { setMsg("Zadaj názov prefabu.", true); return; }
  const sel = selectedObjects();
  if (!sel.length) return;
  try {
    await window.studio.savePrefab(name, captureGroup(sel));
    setMsg(`Prefab ${name} uložený (${sel.length} objektov). Nájdeš ho v knižnici pod „Prefaby“.`);
    if (libType === PREFABS) renderLibrary();
  } catch (e) { setMsg(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true); }
}

function ghostify(node) {
  const g = node.clone(true);
  g.traverse((m) => { if (m.isMesh) { m.material = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => { const c = x.clone(); c.transparent = true; c.opacity = 0.55; return c; }); if (m.material.length === 1) m.material = m.material[0]; } });
  return g;
}

async function startPlacingPrefab(name) {
  stopPlacing();
  const data = await window.studio.prefab(name);
  placing = { prefab: name, items: data.items, name: `prefab ${name}`, ghost: new THREE.Group(), yaw: 0, lift: 0, point: null };
  scene.add(placing.ghost);
  $("placing").hidden = false; $("placing-name").textContent = placing.name; showLift();
  select(null); renderLibrary(); $("lib-preview").hidden = true;
  for (const it of data.items) {
    const { node } = await template(it.crc);
    if (!placing || placing.prefab !== name) return;
    const g = ghostify(node);
    g.position.set(it.dx, it.lift || 0, it.dz);
    g.rotation.y = rad(it.yaw || 0);
    placing.ghost.add(g);
  }
}

async function startPlacing(crc) {
  stopPlacing();
  const info = libByCrc.get(crc);
  placing = { crc, name: info ? info.name : String(crc), ghost: new THREE.Group(), yaw: 0, lift: 0, point: null };
  scene.add(placing.ghost);
  $("placing").hidden = false; $("placing-name").textContent = placing.name; showLift();
  select(null); renderLibrary(); showPreview(crc);
  const { node, info: model } = await template(crc);
  if (!placing || placing.crc !== crc) return;
  const g = node.clone(true);
  g.traverse((m) => { if (m.isMesh) { m.material = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => { const c = x.clone(); c.transparent = true; c.opacity = 0.55; return c; }); if (m.material.length === 1) m.material = m.material[0]; } });
  placing.ghost.add(g);
  if (model.kind === "missing") setMsg(`Model ${model.model} sa nenašiel, objekt bude len ako značka.`, true);
}
// Free placement: the ghost sits on whatever is under the cursor (terrain or another object), in the air on a
// level plane when nothing is hit, and Alt + wheel / PageUp / PageDown lift it; Home puts it back on the surface.
const placePlane = new THREE.Plane(), planeHit = new THREE.Vector3();
function placementPoint(e) {
  const hit = pick(e, [terrainGroup, layer.root])[0];
  let p;
  if (hit) p = hit.point.clone();
  else {
    const focus = fly.focusPoint();
    placePlane.set(UP, -(placing.point ? placing.point.y : focus.y));
    // looking up past the plane: drop it in the air as far away as the point the camera looks at
    const far = Math.min(camera.position.distanceTo(focus), 150);
    p = ray.ray.intersectPlane(placePlane, planeHit) && planeHit.distanceTo(camera.position) < far * 3 ? planeHit.clone() : ray.ray.at(far, new THREE.Vector3());
  }
  const w = map.size[0] * 256, d = map.size[1] * 256;            // objects must stay on a terrain to be saved
  p.x = THREE.MathUtils.clamp(p.x, 0.01, w - 0.01); p.z = THREE.MathUtils.clamp(p.z, 0.01, d - 0.01);
  return p;
}
// outline of the ghost's footprint on the ground, so the spot it covers is visible under roofs and in the air
const footprint = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd27a, depthTest: false }));
footprint.renderOrder = 5; footprint.visible = false;
scene.add(footprint);
const fpBox = new THREE.Box3();
function updateFootprint() {
  if (!placing || !placing.point || !placing.ghost.children.length) { footprint.visible = false; return; }
  placing.ghost.updateMatrixWorld(true);
  fpBox.setFromObject(placing.ghost);
  if (fpBox.isEmpty()) { footprint.visible = false; return; }
  const { min, max } = fpBox, pts = [];
  const edge = (x0, z0, x1, z1) => { for (let i = 0; i < 8; i++) { const t = i / 8, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t; pts.push(new THREE.Vector3(x, heights.at(x, z) + 0.15, z)); } };
  edge(min.x, min.z, max.x, min.z); edge(max.x, min.z, max.x, max.z); edge(max.x, max.z, min.x, max.z); edge(min.x, max.z, min.x, min.z);
  footprint.geometry.setFromPoints(pts);
  footprint.visible = true;
}
function updateGhost() {
  if (!placing || !placing.point) return;
  const p = placing.point;
  placing.ghost.position.set(p.x, p.y + placing.lift, p.z);
  placing.ghost.rotation.y = rad(placing.yaw);
  updateFootprint();
}
// raycasting every object on each mouse move is slow on big maps: the ghost follows at most once per frame
let placeEvent = null;
function queuePlacementMove(e) {
  const first = !placeEvent;
  placeEvent = e;
  if (!first) return;
  requestAnimationFrame(() => {
    const ev = placeEvent; placeEvent = null;
    if (!placing || !ev) return;
    const p = placementPoint(ev);
    if (p) { placing.point = p; updateGhost(); }
  });
}
function showLift() {
  $("placing-lift").textContent = placing && placing.lift ? ` · výška ${placing.lift > 0 ? "+" : ""}${placing.lift.toFixed(1)} m` : "";
}
function liftPlacing(dy) {
  if (!placing) return;
  placing.lift = dy === null ? 0 : Math.round((placing.lift + dy) * 10) / 10;
  showLift(); updateGhost();
}
// Selected objects lift the same way (Ctrl = 10 cm for fine detail); one undo step per key press / wheel notch.
function liftSelected(dy) {
  const sel = selectedObjects();
  if (!sel.length || mode !== "objects") return false;
  change(() => { for (const o of sel) o.z = Math.round(o.z + dy * 100); });
  placePivot();
  setMsg(sel.length > 1 ? `${sel.length} objektov ${dy > 0 ? "zdvihnutých" : "znížených"} o ${Math.abs(dy)} m.` : `Výška ${(sel[0].z / 100).toFixed(2)} m.`);
  return true;
}
const liftStep = (e) => (e.ctrlKey ? 0.1 : e.shiftKey ? 2 : 0.5);
renderer.domElement.addEventListener("wheel", (e) => {
  if (!e.altKey) return;
  const dy = (e.deltaY < 0 ? 1 : -1) * liftStep(e);
  if (placing) liftPlacing(dy);
  else if (!liftSelected(dy)) return;
  e.preventDefault(); e.stopImmediatePropagation();
}, { passive: false, capture: true });
function stopPlacing() {
  if (!placing) return;
  scene.remove(placing.ghost); placing = null; footprint.visible = false;
  $("placing").hidden = true; renderLibrary();
}

/* ---------- terrain mode ---------- */

let mode = "objects";             // "objects" | "terrain" | "spawns"
let zonesOn = false;              // server attribute overlay outside the attribute brush (Z)
function applyAttrView() {
  if (view) view.setAttrVisible(zonesOn || (mode === "terrain" && brush.tool === "attr"));
  $("zones-legend").hidden = !zonesOn;
  $("btn-zones").setAttribute("aria-pressed", String(zonesOn));
}
const brush = { tool: "raise", radius: 8, strength: 5, texture: null, waterLevel: null, flattenTo: undefined, attr: { block: true, water: false, banpk: false } };
const cursor = new BrushCursor();
scene.add(cursor.line);
let painting = false, lastHit = null, paintQueued = null, lastPaintAt = null;

function setMainMode(m) {
  mode = m;
  for (const t of ["objects", "terrain", "spawns"]) {
    $("tab-" + t).setAttribute("aria-selected", String(t === m));
    $("pane-" + t).hidden = t !== m;
  }
  spawnLayer.root.visible = m === "spawns";
  if (m === "spawns") { stopPlacing(); select(null); ensureMobs(); }
  if (m === "terrain") {
    stopPlacing(); select(null);
  } else {
    cursor.line.visible = false;
  }
  applyAttrView();
  $("keys-objects").hidden = m !== "objects"; $("keys-terrain").hidden = m !== "terrain"; $("keys-spawns").hidden = m !== "spawns";
}

function setTool(tool) {
  brush.tool = tool;
  brush.flattenTo = undefined;
  for (const b of $("tools").querySelectorAll("[data-tool]")) b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
  $("tool-hint").textContent = TOOLS[tool].hint;
  $("sec-texture").hidden = tool !== "texture";
  $("sec-water").hidden = tool !== "water";
  $("sec-attr").hidden = tool !== "attr";
  $("sec-strength").hidden = ["texture", "water", "attr"].includes(tool);
  applyAttrView();
}

// Paint at most once per animation frame, and only after the cursor moved a third of the radius.
function queuePaint(point, e) {
  paintQueued = { point: point.clone(), invert: e.ctrlKey };
  requestAnimationFrame(() => {
    if (!paintQueued || !painting) return;
    const { point: p, invert } = paintQueued;
    paintQueued = null;
    const spacing = ["raise", "lower", "smooth", "flatten"].includes(brush.tool) ? 0 : brush.radius / 3;
    if (lastPaintAt && spacing && Math.hypot(p.x - lastPaintAt.x, p.z - lastPaintAt.z) < spacing) return;
    lastPaintAt = p;
    if (brush.tool === "texture" && !brush.texture) { setMsg("Vyber textúru v palete vľavo.", true); return; }
    if (brush.tool === "water" && brush.waterLevel === null) brush.waterLevel = Math.round(heights.at(p.x, p.z) * 200) + 200;
    const changed = paint(heights, p.x, p.z, { ...brush, invert, attrFlags: attrMask(brush.attr) });
    if (changed.parts.size) { view.refresh(changed.keys, changed.parts); updateUi(); }
    if (brush.tool === "water") $("water-level").value = (brush.waterLevel / 200).toFixed(1);
  });
  if (!painting) lastPaintAt = null;
}
window.addEventListener("pointerup", () => { lastPaintAt = null; });

function takeSample(point) {
  const s = sample(heights, point.x, point.z, brush.tool);
  Object.assign(brush, s);
  if (s.flattenTo !== undefined) setMsg(`Zarovnám na výšku ${(s.flattenTo / 200).toFixed(1)} m.`);
  if (s.waterLevel !== undefined) { $("water-level").value = (s.waterLevel / 200).toFixed(1); setMsg(`Hladina vody: ${(s.waterLevel / 200).toFixed(1)} m.`); }
  if (s.texture !== undefined) { renderPalette(); setMsg("Textúra vybraná z terénu."); }
}

async function renderPalette() {
  const box = $("palette");
  if (!heights) { box.innerHTML = ""; return; }
  box.innerHTML = heights.textures.map((t) => `<button type="button" class="swatch" data-tex="${t.index}" aria-pressed="${brush.texture === t.index}" title="${escapeHtml(t.file)}">
      <img alt="" data-game="${escapeHtml(t.file)}"><span>${escapeHtml(t.file.split(/[\\/]/).pop().replace(/\.dds$/i, ""))}</span></button>`).join("")
    || `<p class="muted" style="padding:0">Mapa zatiaľ nemá textúry.</p>`;
  for (const img of box.querySelectorAll("img[data-game]")) window.studio.texturePreview(img.dataset.game).then((url) => { if (url) img.src = url; });
}
$("palette").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tex]");
  if (!b) return;
  brush.texture = Number(b.dataset.tex);
  for (const s of $("palette").querySelectorAll("[data-tex]")) s.setAttribute("aria-pressed", String(s === b));
});

let catalogue = null;
async function openCatalogue() {
  $("catalogue").hidden = false;
  $("cat-search").focus();
  if (!catalogue) { $("cat-list").innerHTML = `<li class="muted">Načítavam textúry…</li>`; catalogue = await window.studio.terrainTextures(); }
  renderCatalogue();
}
const catObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    catObserver.unobserve(en.target);
    window.studio.texturePreview(en.target.dataset.game).then((url) => { if (url) en.target.src = url; });
  }
}, { root: $("cat-list"), rootMargin: "80px" });
function renderCatalogue() {
  const q = $("cat-search").value.trim().toLowerCase();
  const rows = catalogue.filter((t) => !q || (t.folder + "/" + t.name).toLowerCase().includes(q));
  $("cat-list").innerHTML = rows.slice(0, 300).map((t) => `<li data-game="${escapeHtml(t.game)}"><img class="thumb" alt="" data-game="${escapeHtml(t.game)}"><span class="name">${escapeHtml(t.name)}</span><span class="folder">${escapeHtml(t.folder)}</span></li>`).join("")
    + (rows.length > 300 ? `<li class="muted">… a ďalších ${rows.length - 300}, spresni hľadanie</li>` : "") + (!rows.length ? `<li class="muted">Nič nenájdené.</li>` : "");
  catObserver.disconnect();
  for (const img of $("cat-list").querySelectorAll("img[data-game]")) catObserver.observe(img);
}
$("cat-search").addEventListener("input", () => catalogue && renderCatalogue());
$("cat-close").addEventListener("click", () => { $("catalogue").hidden = true; });
$("cat-list").addEventListener("click", async (e) => {
  const li = e.target.closest("[data-game]");
  if (!li || !heights) return;
  const entry = heights.addTexture(li.dataset.game, await window.studio.textureUrl(li.dataset.game));
  brush.texture = entry.index;
  $("catalogue").hidden = true;
  renderPalette(); updateUi();
  setMsg(`Textúra ${li.dataset.game.split("/").pop()} je v palete, môžeš maľovať.`);
});

function groundAllObjects() {
  if (!heights) return;
  change(() => { for (const o of objects) { const p = toScene(o); o.z = heights.at(p.x, p.z) * 100; } });
  setMsg(`Všetkých ${objects.length} objektov je položených na terén.`);
}

$("tab-objects").addEventListener("click", () => setMainMode("objects"));
$("tab-terrain").addEventListener("click", () => setMainMode("terrain"));
$("tools").innerHTML = Object.entries(TOOLS).map(([k, t]) => `<button type="button" data-tool="${k}" aria-pressed="false">${t.label}</button>`).join("");
$("tools").addEventListener("click", (e) => { const b = e.target.closest("[data-tool]"); if (b) setTool(b.dataset.tool); });
$("radius").addEventListener("input", (e) => { brush.radius = Number(e.target.value); $("radius-val").textContent = `${brush.radius} m`; });
$("strength").addEventListener("input", (e) => { brush.strength = Number(e.target.value); $("strength-val").textContent = brush.strength; });
$("water-level").addEventListener("change", (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) brush.waterLevel = Math.round(v * 200); });
for (const f of ["block", "water", "banpk"]) $("attr-" + f).addEventListener("change", (e) => { brush.attr[f] = e.target.checked; });
$("btn-add-texture").addEventListener("click", openCatalogue);
$("btn-ground-all").addEventListener("click", groundAllObjects);

/* ---------- spawns mode (renderer/spawns.js): monster / npc spawns saved to <map>/_studio/spawns.json ---------- */

let spawns = [], town = null, spawnsDirty = false, nextSpawnId = 1, selectedSpawn = null, mobList = null, pickingTown = false;
const mobByVnum = new Map();
const spawnLayer = new SpawnLayer((x, z) => (heights ? heights.at(x, z) : 0));
spawnLayer.root.visible = false;
scene.add(spawnLayer.root);

function mobLabel(vnum) { const m = mobByVnum.get(vnum); return m ? `${m.name} (${vnum})` : String(vnum); }
function rebuildSpawns() {
  spawnLayer.clear();
  for (const s of spawns) spawnLayer.set(s, mobLabel(s.vnum));
  spawnLayer.setTown(town);
  spawnLayer.highlight(selectedSpawn);
  $("sp-town").textContent = town ? `Town: x ${Math.round(town.x)}, y ${Math.round(town.y)} (zmeniť)` : "Nastaviť Town (štart hráčov)";
  renderSpawnList();
}
async function loadSpawns() {
  const data = await window.studio.spawns(map.dir);
  spawns = data.spawns.map((s) => ({ ...s, id: nextSpawnId++ }));
  town = data.town;
  spawnsDirty = false; selectedSpawn = null;
  rebuildSpawns(); syncSpawnForm();
}
async function ensureMobs() {
  if (mobList) return;
  mobList = await window.studio.mobs();
  for (const m of mobList) mobByVnum.set(m.vnum, m);
  renderMobList(); rebuildSpawns();
}
function spawnState() { return JSON.stringify({ spawns, town }); }
function changeSpawns(fn) {
  const before = spawnState();
  fn();
  pushHistory(before, "spawns");
  spawnsDirty = true;
  rebuildSpawns(); syncSpawnForm(); updateUi();
}
function spawnForm() {
  return { type: $("sp-type").value, vnum: Number($("sp-vnum").value) || 0, count: Math.max(1, Number($("sp-count").value) || 1),
    radius: Math.max(1, Number($("sp-radius").value) || 1), respawn: Math.max(1, Number($("sp-respawn").value) || 60) };
}
function syncSpawnForm() {
  const s = spawns.find((x) => x.id === selectedSpawn);
  $("sp-delete").hidden = !s;
  $("sp-state").textContent = s ? `Vybraný spawn: ${mobLabel(s.vnum)} na x ${Math.round(s.x)}, y ${Math.round(s.y)}. Zmeny polí ho upravia.` : "Nový spawn: vyber monštrum a klikni na terén.";
  if (!s) return;
  $("sp-type").value = s.type; $("sp-vnum").value = s.vnum; $("sp-count").value = s.count; $("sp-radius").value = s.radius; $("sp-respawn").value = s.respawn;
  renderMobList();
}
function selectSpawn(id) { selectedSpawn = id; spawnLayer.highlight(id); syncSpawnForm(); renderSpawnList(); }
function addSpawnAt(x, y, values = spawnForm()) {
  if (!values.vnum) { setMsg("Najprv vyber monštrum alebo NPC zo zoznamu (alebo zadaj vnum).", true); return null; }
  const s = { id: nextSpawnId++, ...values, x: +x.toFixed(2), y: +y.toFixed(2), direction: 0 };
  changeSpawns(() => { spawns.push(s); });
  selectSpawn(s.id);
  setMsg(`Spawn ${mobLabel(s.vnum)} položený.`);
  return s;
}
function deleteSpawn() {
  if (selectedSpawn === null) return;
  changeSpawns(() => { spawns = spawns.filter((s) => s.id !== selectedSpawn); });
  selectSpawn(null);
}
function renderMobList() {
  if (!mobList) return;
  const q = $("sp-search").value.trim().toLowerCase(), npc = $("sp-type").value === "npc";
  const rows = mobList.filter((m) => (npc ? m.type === "NPC" : m.type !== "NPC") && (!q || m.name.toLowerCase().includes(q) || String(m.vnum).startsWith(q))).slice(0, 300);
  $("sp-mobs").innerHTML = rows.map((m) => `<li data-vnum="${m.vnum}" class="${Number($("sp-vnum").value) === m.vnum ? "active" : ""}"><span class="name">${escapeHtml(m.name)}</span><span class="type">${escapeHtml(m.type)}${m.level ? " · lv " + m.level : ""}</span><span class="folder">${m.vnum} · ${escapeHtml(m.rank || "")} · ${escapeHtml(m.folder || "")}</span></li>`).join("")
    || `<li class="muted">Nič nenájdené.</li>`;
}
function renderSpawnList() {
  $("sp-title").textContent = `Spawny na mape (${spawns.length})`;
  $("sp-list").innerHTML = spawns.map((s) => `<li data-spawn="${s.id}" class="${s.id === selectedSpawn ? "active" : ""}"><span class="name">${escapeHtml(mobLabel(s.vnum))}</span><span class="type">${SPAWN_TYPES[s.type].label}${s.type === "m" ? " ×" + s.count : ""}</span><span class="folder">x ${Math.round(s.x)} · y ${Math.round(s.y)} · r ${s.radius} m · ${s.respawn} s</span></li>`).join("")
    || `<li class="muted">Zatiaľ žiadne spawny.</li>`;
}
$("sp-search").addEventListener("input", renderMobList);
$("sp-mobs").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-vnum]");
  if (!li) return;
  $("sp-vnum").value = li.dataset.vnum;
  formChanged();
  renderMobList();
});
$("sp-list").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-spawn]");
  if (!li) return;
  const s = spawns.find((x) => x.id === Number(li.dataset.spawn));
  selectSpawn(s.id);
  setCamera({ x: s.x, y: s.y, distance: 45, pitch: 50 });
});
// the form edits the selected spawn, or sets up the next one
function formChanged() {
  if (selectedSpawn === null) return;
  const f = spawnForm();
  if (!f.vnum) return;
  changeSpawns(() => { const s = spawns.find((x) => x.id === selectedSpawn); Object.assign(s, f); });
}
for (const id of ["sp-vnum", "sp-count", "sp-radius", "sp-respawn"]) $(id).addEventListener("change", formChanged);
$("sp-type").addEventListener("change", () => { renderMobList(); formChanged(); });
$("sp-delete").addEventListener("click", deleteSpawn);
$("sp-town").addEventListener("click", () => { pickingTown = true; selectSpawn(null); setMsg("Klikni na terén, kde sa majú hráči objaviť (Town)."); });
$("tab-spawns").addEventListener("click", () => setMainMode("spawns"));

/* ---------- pointer ---------- */

const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null, lastObjectHit = null;
function pick(e, targets) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  return ray.intersectObjects(targets, true);
}
renderer.domElement.addEventListener("pointermove", (e) => {
  if (!map) return;
  if (placing) queuePlacementMove(e);
  const hit = pick(e, [terrainGroup])[0];
  if (hit) {
    const m = fromScene(hit.point);
    $("st-cursor").textContent = `x ${Math.round(m.x)} · y ${Math.round(m.y)} · výška ${(hit.point.y).toFixed(1)} m`;
    lastObjectHit = hit.point.clone();
    if (walker.placing) walker.setPosition(hit.point.x, hit.point.z);
    if (mode === "terrain") { cursor.update(heights, hit.point.x, hit.point.z, brush.radius); lastHit = hit.point; }
  } else if (mode === "terrain") cursor.line.visible = false;
  if (painting && hit) queuePaint(hit.point, e);
});
// spawn markers can be dragged to a new spot (one undo step per drag)
let spawnDrag = null;
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (mode !== "spawns" || e.button !== 0 || !map || walker.active || walker.placing || pickingTown) return;
  const marker = pick(e, spawnLayer.pickables())[0];
  const id = marker && marker.object.userData.spawnId;
  if (!marker || id === "town") return;
  spawnDrag = { id, before: spawnState(), moved: false };
  fly.enabled = false;
});
renderer.domElement.addEventListener("pointermove", (e) => {
  if (!spawnDrag) return;
  const hit = pick(e, [terrainGroup])[0], sp = spawns.find((x) => x.id === spawnDrag.id);
  if (!hit || !sp) return;
  sp.x = +hit.point.x.toFixed(2); sp.y = +hit.point.z.toFixed(2);
  spawnDrag.moved = true;
  spawnLayer.set(sp, mobLabel(sp.vnum));
});
window.addEventListener("pointerup", () => {
  if (!spawnDrag) return;
  const d = spawnDrag;
  spawnDrag = null; fly.enabled = true;
  if (!d.moved) return;
  pushHistory(d.before, "spawns");
  selectSpawn(d.id); updateUi();
  setMsg("Spawn presunutý.");
});
renderer.domElement.addEventListener("pointerdown", (e) => {
  downAt = e.button === 0 ? [e.clientX, e.clientY] : null;
  if (walker.active || walker.placing) return;
  if (mode !== "terrain" || e.button !== 0 || !map) return;
  const hit = pick(e, [terrainGroup])[0];
  if (!hit) return;
  if (e.altKey) { takeSample(hit.point); return; }
  heights.beginStroke();
  painting = true;
  renderer.domElement.setPointerCapture(e.pointerId);
  if (brush.tool === "flatten" && brush.flattenTo === undefined) brush.flattenTo = heights.raw(Math.round(hit.point.x / 2), Math.round(hit.point.z / 2));
  queuePaint(hit.point, e);
});
window.addEventListener("pointerup", () => {
  if (!painting) return;
  painting = false;
  const snap = heights.endStroke();
  if (snap) pushHistory(snap, "terrain");
  updateUi();
});
renderer.domElement.addEventListener("pointerup", (e) => {
  if (mode === "terrain") return;
  if (!map || !downAt || e.button !== 0 || gizmo.dragging) return;
  if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;      // it was a camera drag
  if (walker.active) return;
  if (mode === "spawns" && !walker.placing) {
    const marker = pick(e, spawnLayer.pickables())[0];
    if (pickingTown) {
      const hit = pick(e, [terrainGroup])[0];
      if (hit) { pickingTown = false; changeSpawns(() => { town = { x: +hit.point.x.toFixed(2), y: +hit.point.z.toFixed(2) }; }); setMsg("Town nastavený."); }
      return;
    }
    if (marker && marker.object.userData.spawnId === "town") return;
    if (marker) { selectSpawn(marker.object.userData.spawnId); return; }
    if (selectedSpawn !== null) { selectSpawn(null); return; }      // the first click only drops the selection
    const hit = pick(e, [terrainGroup])[0];
    if (hit) addSpawnAt(hit.point.x, hit.point.z);
    return;
  }
  if (walker.placing) {
    const hit = pick(e, [terrainGroup])[0];
    if (hit) startWalking(hit.point.x, hit.point.z);
    return;
  }
  if (placing && placing.prefab) {
    const p = placementPoint(e);
    if (!p) return;
    placing.point = p;
    // the group keeps its shape over the terrain and rises with the surface it was put on (a roof, the air)
    const added = placeGroup(placing.items, p.x, p.z, placing.yaw, p.y - heights.at(p.x, p.z) + placing.lift);
    change(() => { objects.push(...added); });
    setMsg(`Položený ${placing.name} (${added.length} objektov).`);
    if (!e.shiftKey) { stopPlacing(); selectMany(added.map((o) => o.id)); }
    return;
  }
  if (placing) {
    const p = placementPoint(e);
    if (!p) return;
    placing.point = p.clone();
    p.y += placing.lift;
    const o = { id: nextId++, crc: placing.crc, ...fromScene(p), yaw: placing.yaw, pitch: 0, roll: 0, bias: 0 };
    change(() => { objects.push(o); });
    setMsg(`Položené: ${placing.name}.`);
    rememberRecent(placing.crc);
    if (!e.shiftKey) { stopPlacing(); select(o.id); }
    return;
  }
  if (marquee && marquee.moved) return;          // a Shift+drag rectangle, not a click
  const hit = pick(e, [layer.root])[0];
  if (e.shiftKey) { if (hit) select(hit.object.userData.id, { add: true, toggle: true }); return; }
  select(hit ? hit.object.userData.id : null);
});

// Left drag in object mode: rectangle selection (Shift adds to the selection). A left click without
// moving still selects through the click handler; the gizmo keeps its own drags.
let marquee = null;
viewport.addEventListener("pointerdown", (e) => {
  if (!map || mode !== "objects" || placing || walker.active || walker.placing || e.button !== 0 || gizmo.axis) return;
  marquee = { x0: e.clientX, y0: e.clientY, el: null, moved: false, add: e.shiftKey };
}, true);
window.addEventListener("pointermove", (e) => {
  if (!marquee) return;
  const r = viewport.getBoundingClientRect();
  if (!marquee.moved && Math.hypot(e.clientX - marquee.x0, e.clientY - marquee.y0) < 5) return;
  marquee.moved = true;
  if (!marquee.el) { marquee.el = document.createElement("div"); marquee.el.className = "marquee"; viewport.appendChild(marquee.el); }
  const x = Math.min(e.clientX, marquee.x0) - r.left, y = Math.min(e.clientY, marquee.y0) - r.top;
  Object.assign(marquee.el.style, { left: x + "px", top: y + "px", width: Math.abs(e.clientX - marquee.x0) + "px", height: Math.abs(e.clientY - marquee.y0) + "px" });
});
window.addEventListener("pointerup", (e) => {
  if (!marquee) return;
  const m = marquee;
  setTimeout(() => { marquee = null; }, 0);
  if (m.el) m.el.remove();
  if (!m.moved) return;
  const r = viewport.getBoundingClientRect();
  const x0 = Math.min(e.clientX, m.x0), x1 = Math.max(e.clientX, m.x0), y0 = Math.min(e.clientY, m.y0), y1 = Math.max(e.clientY, m.y0);
  const ids = [];
  for (const o of objects) {
    const p = toScene(o).project(camera);
    if (p.z > 1) continue;
    const sx = r.left + (p.x + 1) / 2 * r.width, sy = r.top + (1 - p.y) / 2 * r.height;
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) ids.push(o.id);
  }
  selectMany(ids, m.add);
  setMsg(`Vybraných ${selection.size} objektov.`);
});

/* ---------- keyboard & buttons ---------- */

/* Noclip flight (renderer/fly.js): keys are routed here so typing in inputs never moves the camera. */
let shiftHeld = false;
window.addEventListener("keyup", (e) => { fly.keyUp(e.key.toLowerCase()); walker.keyUp(e.key.toLowerCase()); if (e.key === "Shift") shiftHeld = false; });
window.addEventListener("blur", () => { fly.clear(); walker.held.clear(); shiftHeld = false; });

/* ---------- play mode: walk the map with a character (renderer/walker.js) ---------- */

async function beginCharacter() {
  if (!map) return;
  stopPlacing(); select(null);
  if (mode === "terrain") setMainMode("objects");
  setMsg("Načítavam postavu…");
  try { await walker.beginPlacing(); } catch (e) { walker.stop(); setMsg(String(e.message || e), true); return; }
  setMsg("Klikni na terén, kam chceš postaviť postavu.");
}
// object footprints for walking: recomputed from the current (maybe unsaved) objects whenever walking starts
async function refreshObjectGrid() {
  walker.objectGrid = await window.studio.collisionGrid(objects.map(({ crc, x, y, z, yaw }) => ({ crc, x, y, z, yaw })), map.size);
}
function startWalking(x, z) {
  walker.objectGrid = null;
  refreshObjectGrid();
  walker.start(x, z);
  fly.enabled = false; fly.clear();
  setMsg("Chôdza: WASD, Shift pomaly, medzerník skok, N noclip, P preložiť, Esc späť do editora.");
}
function stopWalking() {
  const target = walker.root.position.clone().add(new THREE.Vector3(0, 1.6, 0));
  walker.stop();
  fly.enabled = true;
  fly.lookAt(target);
  setMsg("Späť v editore.");
}
function setNoclip(on) {
  walker.noclip = on;
  walker.onChange();
}
walker.onChange = () => {
  $("walk-hud").hidden = !(walker.active || walker.placing);
  $("walk-text").textContent = walker.placing ? "Klikni na terén, kam postavíš postavu · Esc = zrušiť"
    : walker.blocked ? "Sem sa nedá prejsť (blokované / voda / objekt) · N = noclip" : "WASD chôdza · Shift pomaly · medzerník skok · pravé tlačidlo kamera · koliesko priblíženie · Esc koniec";
  $("walk-hud").classList.toggle("warn", walker.active && walker.blocked);
  $("noclip").checked = walker.noclip;
  $("walk-class").value = walker.cls;
  $("btn-walk").setAttribute("aria-pressed", String(walker.active || walker.placing));
};
$("btn-home").addEventListener("click", () => { if (!walker.active) resetView(); });
$("btn-zones").addEventListener("click", () => { zonesOn = !zonesOn; applyAttrView(); });
$("btn-walk").addEventListener("click", () => { if (walker.active || walker.placing) { walker.active ? stopWalking() : walker.stop(); } else beginCharacter(); });
$("noclip").addEventListener("change", (e) => { setNoclip(e.target.checked); e.target.blur(); });
$("walk-class").innerHTML = Object.entries(CLASSES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
$("walk-class").addEventListener("change", async (e) => {
  e.target.blur();
  setMsg("Načítavam postavu…");
  try { await walker.load(e.target.value); walker.root.visible = walker.active || walker.placing; setMsg(`Postava: ${CLASSES[e.target.value]}.`); }
  catch (err) { setMsg(String(err.message || err), true); }
});
const moveClock = new THREE.Clock();

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  // in text fields only the file shortcuts work (Ctrl+Z/C/V stay text editing); blur first so a typed value applies
  if (e.target.matches && e.target.matches("input, select, textarea")) {
    if (!(e.ctrlKey && ["s", "o", "n"].includes(k))) return;
    e.target.blur();
  }
  if (e.key === "Shift") shiftHeld = true;
  if ((walker.active || walker.placing) && !e.ctrlKey) {
    if (k === "escape") { walker.active ? stopWalking() : (walker.stop(), setMsg("")); }
    else if (k === "n" && walker.active) setNoclip(!walker.noclip);
    else if (k === "p") beginCharacter();
    else if (walker.active && !e.ctrlKey && walker.keyDown(k)) e.preventDefault();
    return;
  }
  if (k === "p" && !e.ctrlKey && map) { beginCharacter(); return; }
  if (!e.ctrlKey && !e.altKey && !e.metaKey && map && fly.keyDown(k)) { e.preventDefault(); return; }
  if (k === "[" || k === "]") { const r = $("radius"); r.value = Number(r.value) + (k === "]" ? 2 : -2); r.dispatchEvent(new Event("input")); return; }
  if (k === "t" && !e.ctrlKey) { setMainMode(mode === "terrain" ? "objects" : "terrain"); return; }
  if (e.ctrlKey && k === "s") { e.preventDefault(); save(); }
  else if (e.ctrlKey && k === "o") { e.preventDefault(); chooseAndOpen(); }
  else if (e.ctrlKey && k === "n") { e.preventDefault(); openNewMap(); }
  else if (e.ctrlKey && k === "z") { e.preventDefault(); undo(); }
  else if (e.ctrlKey && (k === "y" || (e.shiftKey && k === "z"))) { e.preventDefault(); redo(); }
  else if (e.ctrlKey && k === "d") { e.preventDefault(); duplicateSelected(); }
  else if (e.ctrlKey && k === "c") { e.preventDefault(); copySelection(); }
  else if (e.ctrlKey && k === "v") { e.preventDefault(); pasteAt(lastObjectHit); }
  else if (e.ctrlKey && k === "a" && mode === "objects") { e.preventDefault(); selectMany(objects.map((o) => o.id)); }
  else if (k === "delete") { if (mode === "spawns") deleteSpawn(); else removeSelected(); }
  else if (k === "1") setMode("translate");
  else if (k === "2") setMode("rotate");
  else if (k === "g") $("snap").checked = !$("snap").checked;
  else if (k === "f") focusSelected();
  else if (k === "h") { resetView(); setMsg("Kamera späť nad mapou."); }
  else if (k === "z" && !e.ctrlKey) { zonesOn = !zonesOn; applyAttrView(); }
  else if (k === "r" && placing) { placing.yaw = (placing.yaw + (e.shiftKey ? 15 : 45)) % 360; updateGhost(); }
  else if (k === "r" && e.shiftKey && selection.size) snapRotation();
  else if (placing && (k === "pageup" || k === "pagedown")) { e.preventDefault(); liftPlacing((k === "pageup" ? 1 : -1) * liftStep(e)); }
  else if (placing && k === "home") liftPlacing(null);
  else if (selection.size && (k === "pageup" || k === "pagedown")) { e.preventDefault(); liftSelected((k === "pageup" ? 1 : -1) * liftStep(e)); }
  else if (selection.size && k === "home") groundSelected();
  else if (k === "escape") { if (placing) stopPlacing(); else if (mode === "spawns") selectSpawn(null); else select(null); }
});
function undo() { if (!undoStack.length) return; redoStack.push(restore(undoStack.pop())); updateUi(); }
function redo() { if (!redoStack.length) return; undoStack.push(restore(redoStack.pop())); updateUi(); }
async function chooseAndOpen() {
  if ((dirty || (heights && heights.isDirty)) && !confirmDiscard()) return;
  openMap(await window.studio.chooseMap());
}
function confirmDiscard() { return window.confirm("Máš neuložené zmeny. Zahodiť ich a otvoriť inú mapu?"); }

$("btn-open").addEventListener("click", chooseAndOpen);

/* ---------- new map dialog ---------- */
function openNewMap() {
  if ((dirty || envDirty || spawnsDirty || (heights && heights.isDirty)) && !confirmDiscard()) return;
  $("nm-error").textContent = "";
  syncNewForm();
  $("new-map").showModal();
  $("nm-name").focus();
}
function syncNewForm() {
  const t = $("nm-template").value;
  $("nm-base").hidden = $("nm-base-label").hidden = t !== "empty";
  $("nm-x").disabled = $("nm-y").disabled = t === "island";
}
$("nm-template").addEventListener("change", syncNewForm);
$("new-close").addEventListener("click", () => $("new-map").close());
$("new-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const params = { name: $("nm-name").value.trim(), template: $("nm-template").value, sizeX: Number($("nm-x").value), sizeY: Number($("nm-y").value), baseTexture: $("nm-base").value };
  $("nm-create").disabled = true;
  try {
    const dir = await window.studio.newMap(params);
    $("new-map").close();
    dirty = false; envDirty = false;
    await openMap(dir);
  } catch (err) {
    $("nm-error").textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
  } finally { $("nm-create").disabled = false; }
});
$("btn-new").addEventListener("click", openNewMap);
$("btn-open-2").addEventListener("click", chooseAndOpen);
$("btn-save").addEventListener("click", save);
$("btn-undo").addEventListener("click", undo);
$("btn-redo").addEventListener("click", redo);
$("mode-move").addEventListener("click", () => setMode("translate"));
$("mode-rotate").addEventListener("click", () => setMode("rotate"));
window.addEventListener("beforeunload", (e) => { if (dirty || spawnsDirty || (heights && heights.isDirty)) { e.preventDefault(); e.returnValue = ""; } });

/* ---------- start ---------- */

let shotRequested = false;
// a map without objects never reports loaded models, so test runs also start once the map is open
window.studio.onAutoOpen(async (dir) => { shotRequested = true; await openMap(dir); if (!objects.length) setTimeout(() => window.studio.readyForShot(), 800); });
window.studio.library().then((list) => {
  library = list.sort((a, b) => a.name.localeCompare(b.name));
  for (const p of library) libByCrc.set(p.crc, p);
  renderLibrary();
  renderInspector();
});
setMode("translate");
setTool("raise");
setMainMode("objects");

/* ---------- control API (MCP bridge and scripted tests) ----------
   Positions are meters from the map's north-west corner: x east, y south, z height. Yaw in degrees. */

function describe(o) {
  const p = toScene(o), info = libByCrc.get(o.crc);
  return { id: o.id, crc: o.crc, name: info ? info.name : null, type: info ? info.type : null,
    x: +p.x.toFixed(2), y: +p.z.toFixed(2), z: +p.y.toFixed(2), yaw: +o.yaw.toFixed(1), ground: +heights.at(p.x, p.z).toFixed(2) };
}
// ground under an object: "min" = lowest point under its footprint (nothing floats on a slope), else the centre
function groundFor(crc, x, y, mode) {
  let z = heights.at(x, y);
  if (mode !== "min") return z;
  const s = (libByCrc.get(crc) || {}).size, r = s ? Math.max(s[0], s[1]) * 0.4 : 0;
  for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7]]) z = Math.min(z, heights.at(x + dx, y + dy));
  return z;
}
function findCrc(item) {
  if (item.crc !== undefined) return Number(item.crc) >>> 0;
  const q = String(item.name || "").toLowerCase();
  const hit = library.find((p) => p.name.toLowerCase() === q) || library.find((p) => p.name.toLowerCase().includes(q));
  if (!hit) throw new Error(`Objekt "${item.name}" nie je v knižnici`);
  return hit.crc;
}
function requireMap() { if (!map) throw new Error("Nie je otvorená žiadna mapa"); }
function waitModels(timeoutMs = 60000) {
  return new Promise((resolve) => { const t0 = Date.now(); const tick = () => (!layer.pending || Date.now() - t0 > timeoutMs ? resolve() : setTimeout(tick, 150)); tick(); });
}
function frames(n = 2) { return new Promise((r) => { const step = () => (--n <= 0 ? r() : requestAnimationFrame(step)); requestAnimationFrame(step); }); }

// Look at map point (x, y) from `distance` m away; yaw 0 = looking north, pitch 90 = straight down.
function setCamera({ x, y, distance = 80, yaw = 0, pitch = 50 }) {
  const fp = fly.focusPoint();
  const tx = x ?? fp.x, tz = y ?? fp.z, ty = heights.at(tx, tz);
  const p = rad(Math.min(pitch, 89.5)), a = rad(yaw);
  camera.position.set(tx - Math.sin(a) * Math.cos(p) * distance, ty + Math.sin(p) * distance, tz + Math.cos(a) * Math.cos(p) * distance);
  fly.lookAt(new THREE.Vector3(tx, ty, tz));
}

/* ---------- phase 3: top-down rendering, export, map check ---------- */

// Renders a north-up orthographic view of [x0, z0]..[x0+w, z0+h] meters; returns RGBA rows top (north) first.
function renderTopDown(x0, z0, w, h, px, py) {
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 1, 10000);
  cam.position.set(x0 + w / 2, 3000, z0 + h / 2);
  cam.up.set(0, 0, -1);
  cam.lookAt(x0 + w / 2, 0, z0 + h / 2);
  const target = new THREE.WebGLRenderTarget(px, py, { colorSpace: THREE.SRGBColorSpace });
  const hidden = [cursor.line, selBox, gizmo.getHelper ? gizmo.getHelper() : gizmo, environment.sky].filter((o) => o && o.visible);
  hidden.forEach((o) => { o.visible = false; });
  const fog = scene.fog; scene.fog = null;
  renderer.setRenderTarget(target);
  renderer.render(scene, cam);
  const raw = new Uint8Array(px * py * 4);
  renderer.readRenderTargetPixels(target, 0, 0, px, py, raw);
  renderer.setRenderTarget(null);
  scene.fog = fog; hidden.forEach((o) => { o.visible = true; });
  target.dispose();
  const out = new Uint8Array(px * py * 4);
  for (let r = 0; r < py; r++) out.set(raw.subarray((py - 1 - r) * px * 4, (py - r) * px * 4), r * px * 4);
  return out;
}

// Shadow of one terrain for the client's shadowmap.raw/.dds: the environment's sun casts the terrain and every
// model onto the ground; a top-down render at 1 px per meter returns the light amount (1 = sun, 0 = shadow).
// Models cast with their own materials but write no colour or depth, so they don't cover the ground.
function renderShadow(tx, ty) {
  const x0 = tx * 256, z0 = ty * 256, centre = new THREE.Vector3(x0 + 128, heights.at(x0 + 128, z0 + 128), z0 + 128);
  const temp = new THREE.Scene();
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.copy(centre).addScaledVector(sun.position.clone().normalize(), 1500);
  light.target.position.copy(centre);
  light.castShadow = true;
  light.shadow.mapSize.set(4096, 4096);
  Object.assign(light.shadow.camera, { left: -190, right: 190, top: 190, bottom: -190, near: 1, far: 4000 });
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.bias = -0.0004; light.shadow.normalBias = 0.08;
  temp.add(light, light.target);
  const groundMat = new THREE.ShadowMaterial({ color: 0x000000, opacity: 1 });
  for (const m of view.group.children) {
    if (!m.isMesh) continue;
    const g = new THREE.Mesh(m.geometry, groundMat);
    g.matrixAutoUpdate = false; g.matrix.copy(m.matrixWorld);
    g.castShadow = g.receiveShadow = true;
    temp.add(g);
  }
  const parent = layer.root.parent, casters = [];
  const mats = new Map();
  layer.root.traverse((o) => {
    if (!o.isMesh) return;
    casters.push([o, o.castShadow]); o.castShadow = true;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (!mats.has(m)) { mats.set(m, [m.colorWrite, m.depthWrite]); m.colorWrite = false; m.depthWrite = false; }
  });
  temp.add(layer.root);
  const prevShadow = renderer.shadowMap.enabled, prevType = renderer.shadowMap.type, prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xffffff, 1);
  const cam = new THREE.OrthographicCamera(-128, 128, 128, -128, 1, 10000);
  cam.position.set(x0 + 128, 3000, z0 + 128); cam.up.set(0, 0, -1); cam.lookAt(x0 + 128, 0, z0 + 128);
  const target = new THREE.WebGLRenderTarget(256, 256);
  renderer.setRenderTarget(target);
  renderer.render(temp, cam);
  const raw = new Uint8Array(256 * 256 * 4);
  renderer.readRenderTargetPixels(target, 0, 0, 256, 256, raw);
  renderer.setRenderTarget(null);
  renderer.shadowMap.enabled = prevShadow; renderer.shadowMap.type = prevType; renderer.setClearColor(prevClear, prevAlpha);
  parent.add(layer.root);
  for (const [o, cast] of casters) o.castShadow = cast;
  for (const [m, [c, d]] of mats) { m.colorWrite = c; m.depthWrite = d; }
  light.shadow.dispose(); target.dispose(); groundMat.dispose();
  const out = new Float32Array(256 * 256);
  for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) out[r * 256 + c] = raw[((255 - r) * 256 + c) * 4] / 255;
  return out;
}

function rgbaToPng(rgba, w, h) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  return c.toDataURL("image/png");
}

async function exportMaps() {
  requireMap();
  await waitModels();
  const files = [], shade = [];
  for (const c of heights.chunks.values()) {
    files.push({ rel: `${c.key}/minimap.dds`, kind: "dds", width: 256, height: 256, rgba: renderTopDown(c.tx * 256, c.ty * 256, 256, 256, 256, 256) });
    const light = renderShadow(c.tx, c.ty);
    files.push({ rel: `${c.key}/shadowmap.raw`, kind: "shadow-raw", light }, { rel: `${c.key}/shadowmap.dds`, kind: "shadow-dds", light });
    shade.push(light);
  }
  const per = Math.max(64, Math.floor(1024 / Math.max(map.size[0], map.size[1])) & ~3);
  const aw = per * map.size[0], ah = per * map.size[1];
  const atlas = renderTopDown(0, 0, map.size[0] * 256, map.size[1] * 256, aw, ah);
  const ddsName = `${map.name}_atlas.dds`;
  files.push({ rel: `_export/atlas/${ddsName}`, kind: "dds", width: aw, height: ah, rgba: atlas });
  files.push({ rel: "_export/atlas/atlas.sub", kind: "text", text: `title subImage\r\nversion 1.0\r\nimage "${ddsName}"\r\nleft 0\r\ntop 0\r\nright ${aw}\r\nbottom ${ah}\r\n` });
  files.push({ rel: "_export/atlas/preview.png", kind: "png", png: rgbaToPng(atlas, aw, ah) });
  const r = await window.studio.exportWrite(map.dir, files);
  const lit = shade.length ? shade.reduce((a, l) => a + l.reduce((s, v) => s + v, 0) / l.length, 0) / shade.length : 1;
  return { minimaps: heights.chunks.size, shadows: shade.length, litShare: +lit.toFixed(3), atlas: `${aw}x${ah}`, folder: r.folder, files: r.files, backup: r.backup, preview: r.preview };
}

async function checkMap() {
  requireMap();
  const issues = [];
  const add = (level, kind, message, ids) => issues.push({ level, kind, message, ...(ids && ids.length ? { ids: ids.slice(0, 50) } : {}) });
  const W = map.size[0] * 256, D = map.size[1] * 256;

  const outside = objects.filter((o) => { const p = toScene(o); return p.x < 0 || p.z < 0 || p.x >= W || p.z >= D; });
  if (outside.length) add("error", "outside", `${outside.length} objektov je mimo mapy (neuložia sa do žiadneho terénu správne).`, outside.map((o) => o.id));

  const crcs = [...new Set(objects.map((o) => o.crc))];
  const unknown = crcs.filter((c) => !libByCrc.has(c));
  if (unknown.length) add("error", "unknown_crc", `${unknown.length} CRC nie je v knižnici property klienta: ${unknown.slice(0, 10).join(", ")}. Hra tieto objekty nezobrazí.`, objects.filter((o) => unknown.includes(o.crc)).map((o) => o.id));
  const infos = await Promise.all(crcs.filter((c) => libByCrc.has(c)).map(async (c) => [c, (await template(c)).info]));
  const missing = infos.filter(([, i]) => i.kind === "missing" || i.kind === "error");
  if (missing.length) add("warning", "missing_model", `${missing.length} objektov nemá dostupný model: ${missing.slice(0, 5).map(([, i]) => i.model || i.name).join(", ")}.`, objects.filter((o) => missing.some(([c]) => c === o.crc)).map((o) => o.id));

  const trees = new Set(infos.filter(([, i]) => i.kind === "tree").map(([c]) => c));
  const floating = [], buried = [], wet = [];
  for (const o of objects) {
    if ((libByCrc.get(o.crc) || {}).type === "Effect") continue;              // fire over a brazier, mist in a gorge: placed in the air on purpose
    const p = toScene(o), g = heights.at(p.x, p.z), d = p.y - g;
    if (d > 1.5) floating.push(o.id);
    if (d < -1.5 && !trees.has(o.crc)) buried.push(o.id);
    const w = heights.waterLevel(Math.floor(p.x / 2), Math.floor(p.z / 2));
    if (w !== null && w / 200 > g + 0.5) wet.push(o.id);
  }
  if (floating.length) add("warning", "floating", `${floating.length} objektov visí viac ako 1,5 m nad terénom.`, floating);
  if (buried.length) add("warning", "buried", `${buried.length} objektov je viac ako 1,5 m pod terénom.`, buried);
  if (wet.length) add("warning", "in_water", `${wet.length} objektov stojí vo vode.`, wet);

  const badTex = heights.textures.filter((t) => !t.url);
  if (badTex.length) add("error", "texture_missing", `Textúry terénu sa nenašli v klientovi: ${badTex.map((t) => t.file).join(", ")}.`);
  for (const c of heights.chunks.values()) {
    const used = new Set(c.tile);
    if (used.size > 12) add("warning", "many_textures", `Terén ${c.key} používa ${used.size} textúr; Map Studio zobrazí len 12 najčastejších.`);
    let waterNoAttr = 0, attrNoWater = 0;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      // only water that is actually above the ground counts; water hidden under land is harmless
      const lvl = c.water.idx[y * 128 + x];
      const isWet = lvl !== 255 && c.water.levels[lvl] > heights.raw(c.tx * 128 + x, c.ty * 128 + y);
      const a = c.attr[(y * 2) * 256 + x * 2] & 2;
      if (isWet && !a) waterNoAttr++;
      if (!isWet && a) attrNoWater++;
    }
    if (waterNoAttr) add("warning", "water_without_attr", `Terén ${c.key}: ${waterNoAttr} buniek vody nemá atribút voda (hráč tam bude chodiť ako po suchu).`);
    if (attrNoWater) add("info", "attr_without_water", `Terén ${c.key}: ${attrNoWater} buniek má atribút voda bez viditeľnej vody.`);
  }
  // town and spawns against the server attributes (1 m cells; object footprints are checked by the export)
  const flagsAt = (x, y) => heights.attr(Math.floor(x), Math.floor(y));
  if (!town) add("info", "town_missing", "Town (štart hráčov) nie je nastavený; export použije --town alebo stred mapy. Nastavíš ho v karte Spawny.");
  else if (flagsAt(town.x, town.y) & 3) add("error", "town_blocked", `Town x ${Math.round(town.x)}, y ${Math.round(town.y)} stojí na blokovanej bunke alebo vo vode.`);
  else if (!(flagsAt(town.x, town.y) & 4)) add("warning", "town_pvp", `Town x ${Math.round(town.x)}, y ${Math.round(town.y)} je v PvP zóne – hráčov tam môžu napadnúť hneď po príchode.`);
  const onBlock = spawns.filter((s) => flagsAt(s.x, s.y) & 3), npcPvp = spawns.filter((s) => s.type === "npc" && !(flagsAt(s.x, s.y) & 7));
  const nearTown = town ? spawns.filter((s) => s.type !== "npc" && Math.hypot(s.x - town.x, s.y - town.y) < s.radius + 10) : [];
  if (onBlock.length) add("warning", "spawn_blocked", `${onBlock.length} spawnov má stred na blokovanej bunke alebo vo vode (server ich nespawne).`);
  if (npcPvp.length) add("warning", "npc_pvp", `${npcPvp.length} NPC stojí v PvP zóne.`);
  if (nearTown.length) add("warning", "spawn_near_town", `${nearTown.length} spawnov monštier je do 10 m od Townu.`);
  // object budget per 256 m terrain (official maps: 30-250; the client draws every object in view) and game usability
  const perTerrain = new Map();
  for (const o of objects) { const p = toScene(o), k = `${String(Math.floor(p.x / 256)).padStart(3, "0")}${String(Math.floor(p.z / 256)).padStart(3, "0")}`; perTerrain.set(k, (perTerrain.get(k) || 0) + 1); }
  for (const [k, n] of perTerrain) if (n > 450) add("warning", "object_budget", `Terén ${k} má ${n} objektov (oficiálne mapy 30–250); pri slabšom PC môže klient sekať.`);
  const unusable = objects.filter((o) => { const p = libByCrc.get(o.crc); return p && p.usable === false && !p.usableAfterPacking; });
  if (unusable.length) add("warning", "unusable", `${unusable.length} objektov hra nezobrazí (katalóg: ${[...new Set(unusable.map((o) => libByCrc.get(o.crc).name))].slice(0, 5).join(", ")}).`, unusable.map((o) => o.id));
  if (town && !(flagsAt(town.x, town.y) & 3)) {
    const R = reachable(heights, town), lost = spawns.filter((sp) => !R.at(sp.x, sp.y));
    if (lost.length) add("warning", "spawn_unreachable", `${lost.length} spawnov sa nedá z Townu dosiahnuť pešo (oddelená plocha).`);
  }
  if (dirty || spawnsDirty || heights.isDirty) add("info", "unsaved", "Mapa má neuložené zmeny.");
  return { ok: !issues.some((i) => i.level === "error"), objects: objects.length, issues };
}

function showReport(title, html) {
  $("report-title").textContent = title;
  $("report-body").innerHTML = html;
  $("report").showModal();
}
$("report-close").addEventListener("click", () => $("report").close());
$("btn-check").addEventListener("click", async () => {
  if (!map) return;
  setMsg("Kontrolujem mapu…");
  const r = await checkMap();
  const label = { error: "Chyba", warning: "Upozornenie", info: "Info" };
  showReport(r.ok ? "Kontrola: bez chýb" : "Kontrola: treba opraviť",
    r.issues.length ? `<ul class="issues">${r.issues.map((i) => `<li class="${i.level}"><b>${label[i.level]}</b> ${escapeHtml(i.message)}${i.ids ? ` <button type="button" class="link" data-ids="${i.ids.join(",")}">ukázať</button>` : ""}</li>`).join("")}</ul>` : "<p>Nenašiel som žiadny problém.</p>");
  setMsg(`Kontrola: ${r.issues.filter((i) => i.level === "error").length} chýb, ${r.issues.filter((i) => i.level === "warning").length} upozornení.`);
});
$("report-body").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ids]");
  if (!b) return;
  $("report").close();
  setMainMode("objects");
  select(Number(b.dataset.ids.split(",")[0]));
  focusSelected();
});
$("btn-export").addEventListener("click", async () => {
  if (!map) return;
  setMsg("Exportujem minimapu a atlas…");
  try {
    const r = await exportMaps();
    showReport("Export hotový", `<p>Minimapy: ${r.minimaps} × <code>minimap.dds</code> v priečinkoch terénov.</p>
      <p>Atlas ${r.atlas}: <code>${escapeHtml(r.folder)}</code> (atlas.sub, ${escapeHtml(map.name)}_atlas.dds). Do hry patrí do <code>d:/ymir work/ui/atlas/${escapeHtml(map.name)}/</code>.</p>
      <img class="report-img" src="${r.preview}" alt="Náhľad atlasu">`);
    setMsg("Export hotový.");
  } catch (e) { setMsg("Export zlyhal: " + e.message, true); }
});

/* ---------- game export: Map Studio renders minimap/atlas/shadows, mapgen/export-game.js stages the files ---------- */

async function openGameExport() {
  if (!map) return;
  try {
    const s = await window.studio.gameSuggest(map.dir, map.size);
    $("gx-index").value = s.index; $("gx-x").value = s.base[0]; $("gx-y").value = s.base[1];
    $("gx-hint").textContent = (s.existing ? "Mapa už v hre je: ponechaný jej index a poloha. " : "Navrhnutý voľný index a miesto vo svete bez prekrytia s inými mapami. ")
      + "Town a spawny sa berú z karty Spawny. Súbory pôjdu do APIX\\_map_exports, server ani klient sa nemenia.";
  } catch (e) { $("gx-hint").textContent = "Návrh sa nepodaril: " + e.message; }
  $("game-dlg").showModal();
}
async function runGameExport(opts) {
  requireMap();
  if (dirty || spawnsDirty || heights.isDirty) await save();
  await exportMaps();
  return window.studio.gameExport(map.dir, opts);
}
$("btn-game").addEventListener("click", openGameExport);
$("game-close").addEventListener("click", () => $("game-dlg").close());
$("game-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("game-dlg").close();
  setMsg("Pripravujem súbory do hry…");
  try {
    const r = await runGameExport({ index: Number($("gx-index").value), base: [Number($("gx-x").value), Number($("gx-y").value)],
      gotoAlias: $("gx-goto").value.trim() || null, objectCollision: $("gx-objects").checked });
    const c = r.serverAttr.cells, warn = r.spawns.warnings;
    showReport("Súbory do hry pripravené", `<p>${r.files} súborov v <a href="#" class="link" id="gx-reveal">${escapeHtml(r.out)}</a>.</p>
      <p>Index ${r.index}, BasePosition ${r.base.join(", ")}, Town ${r.town.map(Math.round).join(", ")}. server_attr: ${c.block} blokovaných, ${c.water} voda, ${c.banpk} bez PvP, ${c.object} pod objektmi (bunky 0,5 m).</p>
      <p>Spawny: ${r.spawns.regen} v regen.txt, ${r.spawns.npc} NPC. Tiene: ${Object.values(r.shadows).join(", ")}.</p>
      ${warn.length ? `<p class="warn">${warn.map(escapeHtml).join("<br>")}</p>` : ""}
      <p class="sub">Nasadenie (server + klient) je samostatný krok – kroky sú v manifest.json:</p>
      <pre class="steps">${escapeHtml([...r.deploy.server, ...r.deploy.client].join("\n"))}</pre>`);
    $("gx-reveal").addEventListener("click", (ev) => { ev.preventDefault(); window.studio.reveal(r.out + "\\manifest.json"); });
    setMsg("Súbory do hry pripravené.");
  } catch (err) { setMsg("Export do hry zlyhal: " + String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true); }
});

const API = {
  status() {
    return map ? {
      map: map.name, dir: map.dir, size: map.size, sizeMeters: [map.size[0] * 256, map.size[1] * 256],
      objects: objects.length, selected: [...selection], unsaved: { objects: dirty, terrain: heights.isDirty, spawns: spawnsDirty }, legacyRotation: !!map.legacyRotation, mode, tool: brush.tool,
      textures: heights.textures.map((t) => ({ index: t.index, file: t.file, found: Boolean(t.url) })), modelsLoading: layer.pending
    } : { map: null };
  },
  async open_map({ dir }) { await openMap(dir); requireMap(); return API.status(); },
  list_objects({ x, y, radius, crc, name, limit = 200 } = {}) {
    requireMap();
    let list = objects.map(describe);
    if (x !== undefined && y !== undefined && radius) list = list.filter((o) => Math.hypot(o.x - x, o.y - y) <= radius);
    if (crc !== undefined) list = list.filter((o) => o.crc === (Number(crc) >>> 0));
    if (name) list = list.filter((o) => (o.name || "").toLowerCase().includes(String(name).toLowerCase()));
    return { total: list.length, objects: list.slice(0, limit) };
  },
  search_library({ query = "", type, limit = 30 } = {}) {
    const q = query.toLowerCase();
    const rows = library.filter((p) => (!type || p.type === type) && (!q || p.name.toLowerCase().includes(q) || p.folder.toLowerCase().includes(q)));
    return { total: rows.length, items: rows.slice(0, limit).map(({ crc, name, type: t, folder }) => ({ crc, name, type: t, folder })) };
  },
  add_objects({ items }) {
    requireMap();
    const added = [];
    change(() => {
      for (const it of items) {
        const crc = findCrc(it);
        const zM = it.z !== undefined ? it.z : groundFor(crc, it.x, it.y, it.ground) + (it.lift || 0) - (it.sink || 0);
        // face: [x, y] turns the front (local +z, south at yaw 0) towards that point
        const yaw = it.face ? (Math.atan2(it.face[0] - it.x, it.face[1] - it.y) * 180) / Math.PI : it.yaw || 0;
        const o = { id: nextId++, crc, ...fromScene(new THREE.Vector3(it.x, zM, it.y)), yaw: (Math.round(yaw * 100) / 100 % 360 + 360) % 360, pitch: 0, roll: 0, bias: 0 };
        objects.push(o); added.push(o);
      }
    });
    return { added: added.map(describe) };
  },
  update_objects({ items }) {
    requireMap();
    const missing = items.filter((it) => !objects.some((o) => o.id === it.id)).map((it) => it.id);
    change(() => {
      for (const it of items) {
        const o = objects.find((x) => x.id === it.id);
        if (!o) continue;
        const p = toScene(o);
        const nx = it.x ?? p.x, ny = it.y ?? p.z;
        const nz = it.ground ? heights.at(nx, ny) : (it.z ?? (it.x !== undefined || it.y !== undefined ? heights.at(nx, ny) : p.y));
        Object.assign(o, fromScene(new THREE.Vector3(nx, nz, ny)));
        if (it.yaw !== undefined) o.yaw = ((it.yaw % 360) + 360) % 360;
      }
    });
    return { updated: items.length - missing.length, missing };
  },
  list_spawns() { requireMap(); return { town, spawns: spawns.map((x) => ({ ...x, name: mobLabel(x.vnum) })), unsaved: spawnsDirty }; },
  set_town({ x, y }) { requireMap(); changeSpawns(() => { town = { x, y }; }); return { town }; },
  async add_spawns({ items }) {
    requireMap(); await ensureMobs();
    const added = [];
    for (const it of items) {
      const v = { type: it.type || "m", vnum: it.vnum, count: Math.max(1, it.count || 1), radius: Math.max(1, it.radius || 10), respawn: Math.max(1, it.respawn || 120) };
      const sp = addSpawnAt(it.x, it.y, v);
      if (sp) added.push(sp.id);
    }
    return { added };
  },
  update_spawns({ items }) {
    requireMap();
    changeSpawns(() => { for (const it of items) { const sp = spawns.find((x) => x.id === it.id); if (sp) for (const k of ["type", "vnum", "x", "y", "radius", "count", "respawn"]) if (it[k] !== undefined) sp[k] = it[k]; } });
    return { updated: items.length };
  },
  delete_spawns({ ids }) {
    requireMap();
    const set = new Set(ids), before = spawns.length;
    changeSpawns(() => { spawns = spawns.filter((x) => !set.has(x.id)); });
    if (set.has(selectedSpawn)) selectSpawn(null);
    return { deleted: before - spawns.length };
  },
  delete_objects({ ids }) {
    requireMap();
    const set = new Set(ids);
    const before = objects.length;
    change(() => { objects = objects.filter((o) => !set.has(o.id)); if (selected && set.has(selected.id)) selected = null; });
    return { deleted: before - objects.length };
  },
  terrain_height({ points }) {
    requireMap();
    return { heights: points.map(([x, y]) => ({ x, y, z: +heights.at(x, y).toFixed(2), water: (() => { const w = heights.waterLevel(Math.floor(x / 2), Math.floor(y / 2)); return w === null ? null : +(w / 200).toFixed(2); })(), attr: heights.attr(Math.floor(x), Math.floor(y)) })) };
  },
  async add_texture({ game }) { requireMap(); const e = heights.addTexture(game, await window.studio.textureUrl(game)); renderPalette(); updateUi(); return { index: e.index, file: e.file, found: Boolean(e.url) }; },
  async paint({ tool, points, radius = 8, strength = 5, texture, waterLevel, flattenTo, attr, invert = false }) {
    requireMap();
    if (!TOOLS[tool]) throw new Error(`Neznámy nástroj ${tool}; použi ${Object.keys(TOOLS).join(", ")}`);
    const opts = { ...brush, tool, radius, strength, invert };
    if (tool === "texture") {
      if (texture === undefined) throw new Error("texture: index z mapy alebo herná cesta d:/ymir work/terrainmaps/...");
      opts.texture = typeof texture === "number" ? texture : (await API.add_texture({ game: texture })).index;
    }
    if (tool === "water") opts.waterLevel = waterLevel !== undefined ? Math.round(waterLevel * 200) : Math.round(heights.at(points[0][0], points[0][1]) * 200) + 200;
    if (tool === "flatten") opts.flattenTo = flattenTo !== undefined ? Math.round(flattenTo * 200) : heights.raw(Math.round(points[0][0] / 2), Math.round(points[0][1] / 2));
    if (tool === "attr") opts.attrFlags = attrMask({ block: false, water: false, banpk: false, ...(attr || brush.attr) });
    heights.beginStroke();
    const keys = new Set(), parts = new Set();
    for (const [x, y] of points) { const c = paint(heights, x, y, opts); c.keys.forEach((k) => keys.add(k)); c.parts.forEach((p) => parts.add(p)); }
    view.refresh(keys, parts);
    const snap = heights.endStroke();
    if (snap) pushHistory(snap, "terrain");
    updateUi();
    return { changed: [...parts] };
  },
  // road / river along a curve through points (one undo step); textures as map index or game path
  async spline({ kind = "road", points, width = kind === "river" ? 6 : kind === "ridge" ? 30 : 5, edge, texture, edgeTexture, bedTexture, steepTexture, height, depth, maxGrade, smooth, water = true, block = kind === "ridge" || (kind === "river" && water), seed = 1 }) {
    requireMap();
    if (!["road", "river", "ridge"].includes(kind)) throw new Error("kind: road, river alebo ridge");
    if (!Array.isArray(points) || points.length < 2) throw new Error("points: aspoň 2 body [x, y] v metroch");
    const tex = async (t) => (t === undefined ? undefined : typeof t === "number" ? t : (await API.add_texture({ game: t })).index);
    const opts = { kind, points, width, edge, depth, height, water, maxGrade, smooth, block, seed, steepTexture: await tex(steepTexture),
      texture: await tex(texture ?? (kind === "road" ? "d:/ymir work/terrainmaps/a/field/field 02.dds" : kind === "river" ? "d:/ymir work/terrainmaps/a/beach/beach sand 01.dds" : undefined)),
      edgeTexture: await tex(edgeTexture), bedTexture: await tex(bedTexture ?? (kind === "river" ? "d:/ymir work/terrainmaps/12temple/stone_02.dds" : undefined)),
      attrFlags: { water: attrMask({ water: true }), block: attrMask({ block: true }) } };
    heights.beginStroke();
    const r = applySpline(heights, opts);
    view.refresh(r.keys, r.parts);
    const snap = heights.endStroke();
    if (snap) pushHistory(snap, "terrain");
    updateUi();
    return { changed: [...r.parts], length: r.length, profile: r.profile, waterLevels: r.waterLevels };
  },
  // terrain from noise + erosion inside an area (one undo step); see renderer/terraingen.js for the options
  terrain_generate(opts = {}) {
    requireMap();
    heights.beginStroke();
    const r = generateTerrain(heights, opts);
    view.refresh(r.keys, r.parts);
    const snap = heights.endStroke();
    if (snap) pushHistory(snap, "terrain");
    updateUi();
    return r.stats;
  },
  // rule-based texturing by slope / height / water distance / noise (one undo step); textures as index or game path
  async auto_texture({ rules, keep = [], area, seed } = {}) {
    requireMap();
    const tex = async (t) => (typeof t === "number" ? t : (await API.add_texture({ game: t })).index);
    const rs = [];
    for (const rule of rules || []) rs.push({ ...rule, texture: await tex(rule.texture) });
    const kp = [];
    for (const k of keep) kp.push(await tex(k));
    heights.beginStroke();
    const r = autoTexture(heights, { rules: rs, keep: kp, area, seed });
    view.refresh(r.keys, r.parts);
    const snap = heights.endStroke();
    if (snap) pushHistory(snap, "terrain");
    updateUi();
    return { counts: r.counts, textures: heights.textures.map((t) => ({ index: t.index, file: t.file })) };
  },
  // biome scatter (one undo step); items by crc or name; sizes from the asset catalog; dryRun only reports
  async scatter({ layers, area, seed, avoid, avoidLines, avoidWater, avoidBlocked, dryRun = false } = {}) {
    requireMap();
    const tex = async (list) => { if (!list) return list; const out = []; for (const t of list) out.push(typeof t === "number" ? t : (await API.add_texture({ game: t })).index); return out; };
    const ls = [];
    for (const L of layers || []) ls.push({ ...L, items: (L.items || []).map((it) => ({ crc: findCrc(it), weight: it.weight ?? 1 })), onTextures: await tex(L.onTextures), avoidTextures: await tex(L.avoidTextures) });
    const existing = objects.map((o) => {
      const p = toScene(o), info = libByCrc.get(o.crc) || {}, s = info.size;
      const tree = info.type === "Tree";
      return { x: p.x, y: p.z, r: s ? (tree ? Math.min(2, Math.max(0.6, s[0] * 0.18)) : Math.max(0.5, Math.max(s[0], s[1]) / 2)) : 1 };
    });
    const info = (crc) => { const p = libByCrc.get(crc) || {}; return { size: p.size, tree: p.type === "Tree" }; };
    const res = scatter(heights, existing, info, { layers: ls, area, seed, avoid, avoidLines, avoidWater, avoidBlocked });
    if (dryRun) return { stats: res.stats, count: res.items.length };
    const added = [];
    change(() => {
      for (const it of res.items) {
        const o = { id: nextId++, crc: it.crc, ...fromScene(new THREE.Vector3(it.x, it.z, it.y)), yaw: it.yaw, pitch: 0, roll: 0, bias: 0 };
        objects.push(o); added.push(o);
      }
    });
    return { stats: res.stats, count: added.length, ids: added.map((o) => o.id) };
  },
  // what a player reaches on foot from the town (or from): area, walkable patches, spawns that cannot be reached;
  // png: true adds a picture (green reached, grey walkable elsewhere, red blocked, blue water, yellow objects)
  reachability({ from, png = false } = {}) {
    requireMap();
    const start = from ? { x: from[0], y: from[1] } : town;
    if (!start) throw new Error("from [x, y] alebo nastavený Town je povinný");
    const R = reachable(heights, start), sizes = patches(heights);
    const out = { from: [start.x, start.y], reachableHa: +(R.count / 10000).toFixed(2), walkableHa: +(R.walkable / 10000).toFixed(2),
      patchesHa: sizes.slice(0, 6).map((n) => +(n / 10000).toFixed(2)), patchCount: sizes.length,
      unreachableSpawns: spawns.filter((sp) => !R.at || !R.at(sp.x, sp.y)).map((sp) => ({ id: sp.id, type: sp.type, vnum: sp.vnum, x: sp.x, y: sp.y })) };
    if (png) {
      const c = document.createElement("canvas"); c.width = R.W; c.height = R.H;
      const ctx = c.getContext("2d"), img = ctx.createImageData(R.W, R.H);
      for (let y = 0; y < R.H; y++) for (let x = 0; x < R.W; x++) {
        const k = y * R.W + x, a = heights.attr(x, y), col = R.seen[k] ? [60, 170, 60] : a & 2 ? [40, 80, 200] : a & 1 ? [150, 40, 40] : [140, 140, 140];
        img.data.set([...col, 255], k * 4);
      }
      for (const o of objects) { const p = toScene(o), k = (Math.floor(p.z) * R.W + Math.floor(p.x)) * 4; if (k >= 0 && k < img.data.length) img.data.set([255, 230, 0, 255], k); }
      ctx.putImageData(img, 0, 0);
      out.png = c.toDataURL("image/png");
    }
    return out;
  },
  // metins and monster groups per zone on flat, reachable, free ground (see renderer/spawnplan.js); apply: true adds them
  async plan_spawns({ zones, from, avoid, avoidLines, metinSpacing, groupSpacing, metinClear, metinRough, groupRough, probe, step, seed, apply = false } = {}) {
    requireMap();
    const start = from ? { x: from[0], y: from[1] } : town;
    if (!start) throw new Error("from [x, y] alebo nastavený Town je povinný");
    const R = reachable(heights, start);
    const objs = objects.map((o) => { const p = toScene(o); return { x: p.x, y: p.z }; });
    const res = planSpawns(heights, R.at || (() => false), objs, { zones, avoid, avoidLines, metinSpacing, groupSpacing, metinClear, metinRough, groupRough, probe, step, seed });
    let added = [];
    if (apply && res.items.length) added = (await API.add_spawns({ items: res.items })).added;
    return { stats: res.stats, items: res.items, added };
  },
  // forest wall along the walkable valleys + bare blocked slopes filled (see renderer/forestedge.js); one undo step
  forest_edge({ items, rocks, area, edge, fill, rockChance, maxHeight, maxSlope, avoid, avoidLines, sink, step, seed, dryRun = false } = {}) {
    requireMap();
    const existing = objects.map((o) => { const p = toScene(o); return { x: p.x, y: p.z }; });
    const res = forestEdge(heights, existing, { items: (items || []).map((it) => ({ crc: findCrc(it), weight: it.weight ?? 1 })), rocks: (rocks || []).map((it) => ({ crc: findCrc(it) })),
      area, edge, fill, rockChance, maxHeight, maxSlope, avoid, avoidLines, sink, step, seed });
    if (dryRun) return { stats: res.stats, count: res.items.length };
    const added = [];
    change(() => {
      for (const it of res.items) {
        const o = { id: nextId++, crc: it.crc, ...fromScene(new THREE.Vector3(it.x, it.z, it.y)), yaw: it.yaw, pitch: 0, roll: 0, bias: 0 };
        objects.push(o); added.push(o);
      }
    });
    return { stats: res.stats, count: added.length };
  },
  list_sources: async ({ query = "" } = {}) => (await window.studio.sources()).filter((m) => (m.name + " " + m.dir).toLowerCase().includes(query.toLowerCase())),
  // copy a rectangle of another map into this one (one undo step); objects not usable in game are skipped by default
  async import_region({ source, area, to, rotate = 0, blend = 16, heightOffset = "match", parts, skipUnusable = true, seed } = {}) {
    requireMap();
    if (!source || !area || !to) throw new Error("source, area [x0,y0,x1,y1] (m v zdrojovej mape) a to [x,y] sú povinné");
    const region = await window.studio.region(source, area);
    // textures: source index -> destination index (added to the map's texture set by game path)
    const textureMap = {};
    const used = new Set(region.tiles);
    for (const t of region.textures) if (used.has(t.index)) textureMap[t.index] = (await API.add_texture({ game: t.file })).index;
    heights.beginStroke();
    const r = importRegion(heights, region, { to, rotate, blend, heightOffset, parts, seed, textureMap, attrFlags: { block: attrMask({ block: true }), water: attrMask({ water: true }) } });
    const skipped = {};
    const keep = r.objects.filter((o) => {
      const p = libByCrc.get(o.crc);
      const bad = !p || (skipUnusable && p.usable === false && !p.usableAfterPacking);
      if (bad) { const n = p ? p.name : `crc ${o.crc}`; skipped[n] = (skipped[n] || 0) + 1; }
      return !bad;
    });
    view.refresh(r.keys, r.parts);
    const snap = heights.endStroke();
    if (snap) pushHistory(snap, "terrain");
    const added = [];
    if (keep.length) change(() => {
      for (const o of keep) {
        const ob = { id: nextId++, crc: o.crc, ...fromScene(new THREE.Vector3(o.x, heights.at(o.x, o.y) + o.lift, o.y)), yaw: o.yaw, pitch: 0, roll: 0, bias: 0 };
        objects.push(ob); added.push(ob);
      }
    });
    // texture budget: the client draws at most 12 textures per 256 m terrain
    const perTerrain = {};
    for (let ty = 0; ty < map.size[1]; ty++) for (let tx = 0; tx < map.size[0]; tx++) {
      const s = new Set();
      for (let y = ty * 256; y < ty * 256 + 256; y += 1) for (let x = tx * 256; x < tx * 256 + 256; x += 1) s.add(heights.tile(x, y));
      perTerrain[`${String(tx).padStart(3, "0")}${String(ty).padStart(3, "0")}`] = s.size;
    }
    updateUi();
    return { source: region.source, area: region.area, placedAt: r.area, heightOffset: r.offset, objects: added.length, ids: added.map((o) => o.id), skipped,
      texturesPerTerrain: perTerrain, warnings: Object.entries(perTerrain).filter(([, n]) => n > 12).map(([k, n]) => `terén ${k}: ${n} textúr (max 12)`) };
  },
  catalog: (query) => window.studio.catalog(query || {}),
  list_prefabs: () => window.studio.prefabs(),
  async save_prefab({ name, ids }) {
    requireMap();
    const list = objects.filter((o) => ids.includes(o.id));
    if (!list.length) throw new Error("Žiadny z objektov neexistuje");
    return window.studio.savePrefab(name, captureGroup(list));
  },
  async place_prefab({ name, x, y, yaw = 0 }) {
    requireMap();
    const data = await window.studio.prefab(name);
    const added = placeGroup(data.items, x, y, yaw);
    change(() => { objects.push(...added); });
    return { added: added.map(describe) };
  },
  list_environments({ query = "" } = {}) { return window.studio.environments().then((l) => l.filter((n) => n.toLowerCase().includes(query.toLowerCase()))); },
  async set_environment({ name }) { requireMap(); const env = await setEnvironmentByName(name || ""); renderInspector(); return { environment: name || null, found: Boolean(env && !env.missing) }; },
  ground_all_objects() { requireMap(); groundAllObjects(); return { objects: objects.length }; },
  check_map: () => checkMap(),
  export: () => exportMaps(),
  suggest_game_slot() { requireMap(); return window.studio.gameSuggest(map.dir, map.size); },
  game_export({ index, base, goto: gotoAlias = null, objectCollision = true }) { return runGameExport({ index, base, gotoAlias, objectCollision }); },
  async save() { requireMap(); await save(); return { message: $("st-msg").textContent, unsaved: { objects: dirty, terrain: heights.isDirty, spawns: spawnsDirty } }; },
  undo() { undo(); return { undo: undoStack.length, redo: redoStack.length }; },
  redo() { redo(); return { undo: undoStack.length, redo: redoStack.length }; },
  camera(params = {}) {
    requireMap();
    if (Object.keys(params).length) setCamera(params);
    const f = fly.focusPoint();
    return { position: camera.position.toArray().map((v) => +v.toFixed(2)), lookingAt: [+f.x.toFixed(2), +f.z.toFixed(2)], yaw: +deg(fly.yaw).toFixed(1), pitch: +deg(fly.pitch).toFixed(1) };
  },
  async screenshot({ x, y, distance, yaw, pitch, attr } = {}) {
    requireMap();
    if (x !== undefined || distance !== undefined) setCamera({ x, y, distance, yaw, pitch });
    const prevAttr = view.showAttr;
    if (attr !== undefined) view.setAttrVisible(Boolean(attr));
    await waitModels(); await frames(3);
    renderer.render(scene, camera);
    const png = renderer.domElement.toDataURL("image/png");
    if (attr !== undefined) view.setAttrVisible(prevAttr);
    return { png, width: renderer.domElement.width, height: renderer.domElement.height };
  }
};

window.__studio = {
  api: async (method, params) => {
    const fn = API[method];
    if (!fn) throw new Error(`Neznáma metóda ${method}; dostupné: ${Object.keys(API).join(", ")}`);
    return fn(params || {});
  },
  setMainMode, setTool, save, undo, redo, startPlacing, groundAt: (x, z) => heights.at(x, z),
  brush, get model() { return heights; }, get objects() { return objects; }, scene,
  get gizmo() { return gizmo; }, get pivot() { return pivot; }, select, layer,
  // what a click at client (x, y) would hit: object ids (with the mesh name) in hit order
  pickAt(x, y) { return pick({ clientX: x, clientY: y }, [layer.root]).map((h) => ({ id: h.object.userData.id, mesh: h.object.name || h.object.type, dist: +h.distance.toFixed(1) })); },
  nodeInfo(id) {
    const n = layer.nodes.get(id);
    if (!n) return null;
    let meshes = 0, withId = 0;
    n.traverse((m) => { if (m.isMesh) { meshes++; if (m.userData.id === id) withId++; } });
    const box = new THREE.Box3().setFromObject(n), c = box.getCenter(new THREE.Vector3()).project(camera), r = renderer.domElement.getBoundingClientRect();
    let skinned = 0; n.traverse((m) => { if (m.isSkinnedMesh) skinned++; });
    return { children: n.children.length, meshes, withId, skinned, parent: n.parent ? n.parent.name : null,
      boxSize: box.getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(1)), origin: toScene(objects.find((o) => o.id === id)).toArray().map((v) => +v.toFixed(1)),
      boxCenter: box.getCenter(new THREE.Vector3()).toArray().map((v) => +v.toFixed(1)), boxScreen: { x: r.left + (c.x + 1) / 2 * r.width, y: r.top + (1 - c.y) / 2 * r.height } };
  },
  // client (window) coordinates of an object, for tests that simulate mouse clicks
  screenPos(id) {
    const o = objects.find((x) => x.id === id), r = renderer.domElement.getBoundingClientRect();
    const p = toScene(o).add(new THREE.Vector3(0, 1, 0)).project(camera);
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height, visible: p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1 };
  },
  walker,
  startWalking, stopWalking, renderShadow, spawnLayer,
  async addTexture(game) { const e = heights.addTexture(game, await window.studio.textureUrl(game)); brush.texture = e.index; renderPalette(); return e.index; },
  stroke(points, opts = {}) {
    Object.assign(brush, opts);
    heights.beginStroke();
    for (const [x, z] of points) { const c = paint(heights, x, z, { ...brush, invert: !!opts.invert, attrFlags: attrMask(brush.attr) }); view.refresh(c.keys, c.parts); }
    const snap = heights.endStroke();
    if (snap) pushHistory(snap, "terrain");
    return Boolean(snap);
  }
};
updateUi();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.1, moveClock.getDelta());
  if (walker.active) walker.update(dt); else { walker.update(dt); fly.update(dt, shiftHeld); }
  if (spawnLayer.root.visible) spawnLayer.update(dt);
  updateEffects(dt);
  environment.follow(camera);
  renderer.render(scene, camera);
});
