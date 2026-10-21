import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { TerrainModel, TerrainView } from "./terrain.js";
import { TOOLS, paint, sample, attrMask, BrushCursor } from "./brush.js";
import { ObjectLayer, template, toScene, fromScene } from "./objects.js";
import { thumbnail } from "./thumbs.js";
import { Environment } from "./env.js";

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

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.maxPolarAngle = Math.PI * 0.49;
const gizmo = new TransformControls(camera, renderer.domElement);
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
  updateUi();
}
function restore(entry) {
  if (entry.kind === "terrain") {
    const current = heights.restore(entry.state);
    view.refresh(entry.state.keys(), new Set(["height", "tile", "water", "attr"]));
    updateUi();
    return { kind: "terrain", state: current };
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
  const unsaved = dirty || envDirty || (heights && heights.isDirty);
  $("map-name").textContent = map ? map.name + (unsaved ? " •" : "") : "Žiadna mapa";
  document.title = map ? `${map.name}${unsaved ? " •" : ""} – APIX Map Studio` : "APIX Map Studio";
}

/* ---------- map loading ---------- */

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
  view.setAttrVisible(mode === "terrain" && brush.tool === "attr");
  renderPalette();
  layer.clear();
  objects = map.objects.map((o) => ({ ...o, id: nextId++ }));
  for (const o of objects) layer.add(o);
  undoStack.length = redoStack.length = 0; dirty = false;
  select(null);
  const w = map.size[0] * 256, d = map.size[1] * 256;
  orbit.target.set(w / 2, heights.at(w / 2, d / 2), d / 2);
  camera.position.set(w / 2, heights.at(w / 2, d / 2) + w * 0.55, d / 2 + w * 0.75);
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

async function save() {
  if (!map) return;
  try {
    const parts = [];
    let backup = "";
    if (dirty) {
      const r = await window.studio.saveMap(map.dir, map.size, objects.map(({ id, terrain, ...o }) => o));
      parts.push(`${r.written} objektov`); backup = r.backup; dirty = false;
    }
    if (envDirty) {
      const r = await window.studio.setEnvironment(map.dir, envName);
      parts.push(`prostredie ${envName || "(žiadne)"}`); backup = r.backup; envDirty = false;
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
  orbit.enabled = !e.value;
  if (e.value) {
    dragBefore = snapshot();
    dragStart = { pivot: pivot.position.clone(), rot: pivot.rotation.y, items: selectedObjects().map((o) => ({ o, p: toScene(o), yaw: o.yaw })) };
  } else if (dragBefore) {
    pushHistory(dragBefore); dragBefore = null; dragStart = null;
    placePivot(); renderInspector();
  }
});
gizmo.addEventListener("objectChange", () => {
  if (!dragStart) return;
  pivot.rotation.x = 0; pivot.rotation.z = 0;
  const d = pivot.position.clone().sub(dragStart.pivot), r = pivot.rotation.y - dragStart.rot;
  const snapGround = $("snap").checked && gizmo.mode === "translate" && heights;
  for (const it of dragStart.items) {
    const np = it.p.clone().sub(dragStart.pivot).applyAxisAngle(UP, r).add(dragStart.pivot).add(d);
    if (snapGround) np.y = heights.at(np.x, np.z);
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
  const p = centroid(sel), off = camera.position.clone().sub(orbit.target).setLength(sel.length > 1 ? 70 : 40);
  orbit.target.copy(p); camera.position.copy(p).add(off);
}
function groundSelected() {
  change(() => { for (const o of selectedObjects()) { const p = toScene(o); o.z = heights.at(p.x, p.z) * 100; } });
}

// Group layout relative to its centre; lift = height above the ground, so a pasted group hugs new terrain.
function captureGroup(list) {
  const c = centroid(list);
  return list.map((o) => { const p = toScene(o); return { crc: o.crc, dx: +(p.x - c.x).toFixed(3), dz: +(p.z - c.z).toFixed(3), lift: +(p.y - heights.at(p.x, p.z)).toFixed(3), yaw: o.yaw }; });
}
function placeGroup(items, x, z, yaw = 0) {
  const r = rad(yaw);
  return items.map((it) => {
    const v = new THREE.Vector3(it.dx, 0, it.dz).applyAxisAngle(UP, r);
    const px = x + v.x, pz = z + v.z;
    const o = { id: nextId++, crc: it.crc, ...fromScene(new THREE.Vector3(px, heights.at(px, pz) + (it.lift || 0), pz)), yaw: ((((it.yaw || 0) + yaw) % 360) + 360) % 360, pitch: 0, roll: 0, bias: 0 };
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
    <div class="row-actions"><button type="button" id="i-ground">Položiť na terén</button><button type="button" id="i-dup">Duplikovať</button><button type="button" id="i-copy">Kopírovať</button><button type="button" class="danger" id="i-del">Zmazať</button></div>
    <p class="sub">Shift + klik pridá ďalší objekt, Shift + ťahanie vyberie obdĺžnikom.</p>`;
  renderInspectorValues();
  $("i-copy").addEventListener("click", copySelection);
  for (const k of ["x", "y", "z", "yaw"]) {
    $("f-" + k).addEventListener("change", (e) => {
      const v = Number(e.target.value);
      if (!Number.isFinite(v)) return;
      change(() => { selected[k] = k === "yaw" ? ((v % 360) + 360) % 360 : v; });
    });
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
const PREFABS = "Prefaby";
async function renderPrefabs(q) {
  const list = (await window.studio.prefabs()).filter((p) => !q || p.name.toLowerCase().includes(q));
  if (libType !== PREFABS) return;
  $("lib-list").innerHTML = list.map((p) => `<li data-prefab="${escapeHtml(p.name)}" class="${placing && placing.prefab === p.name ? "active" : ""}">
      <span class="thumb prefab-icon">${p.count}</span><span class="name">${escapeHtml(p.name)}</span>
      <button type="button" class="link" data-del-prefab="${escapeHtml(p.name)}" title="Zmazať prefab">zmazať</button>
      <span class="folder">${p.count} objektov</span></li>`).join("")
    || `<li class="muted">Zatiaľ žiadne prefaby. Vyber viac objektov (Shift) a v paneli Vlastnosti ich ulož ako prefab.</li>`;
}
function renderLibrary() {
  const q = $("lib-search").value.trim().toLowerCase();
  const types = [...new Set(library.map((p) => p.type))].sort();
  $("lib-types").innerHTML = ["Všetko", ...types, PREFABS].map((t) => `<button type="button" class="chip" data-type="${escapeHtml(t)}" aria-pressed="${t === libType}">${escapeHtml(t)}</button>`).join("");
  if (libType === PREFABS) { thumbObserver.disconnect(); renderPrefabs(q); return; }
  const rows = library.filter((p) => (libType === "Všetko" || p.type === libType) && (!q || p.name.toLowerCase().includes(q) || p.folder.toLowerCase().includes(q)));
  $("lib-list").innerHTML = rows.slice(0, 400).map((p) =>
    `<li data-crc="${p.crc}" class="${placing && placing.crc === p.crc ? "active" : ""}"><img class="thumb" data-crc="${p.crc}" alt=""><span class="name">${escapeHtml(p.name)}</span><span class="type">${escapeHtml(p.type)}</span><span class="folder">${escapeHtml(p.folder)}</span></li>`).join("")
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
  $("pv-meta").textContent = `${p.type} · ${p.folder || "property"} · CRC ${p.crc}`;
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
  placing = { prefab: name, items: data.items, name: `prefab ${name}`, ghost: new THREE.Group(), yaw: 0 };
  scene.add(placing.ghost);
  $("placing").hidden = false; $("placing-name").textContent = placing.name;
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
  placing = { crc, name: info ? info.name : String(crc), ghost: new THREE.Group(), yaw: 0 };
  scene.add(placing.ghost);
  $("placing").hidden = false; $("placing-name").textContent = placing.name;
  select(null); renderLibrary(); showPreview(crc);
  const { node, info: model } = await template(crc);
  if (!placing || placing.crc !== crc) return;
  const g = node.clone(true);
  g.traverse((m) => { if (m.isMesh) { m.material = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => { const c = x.clone(); c.transparent = true; c.opacity = 0.55; return c; }); if (m.material.length === 1) m.material = m.material[0]; } });
  placing.ghost.add(g);
  if (model.kind === "missing") setMsg(`Model ${model.model} sa nenašiel, objekt bude len ako značka.`, true);
}
function stopPlacing() {
  if (!placing) return;
  scene.remove(placing.ghost); placing = null;
  $("placing").hidden = true; renderLibrary();
}

/* ---------- terrain mode ---------- */

let mode = "objects";             // "objects" | "terrain"
const brush = { tool: "raise", radius: 8, strength: 5, texture: null, waterLevel: null, flattenTo: undefined, attr: { block: true, water: false, banpk: false } };
const cursor = new BrushCursor();
scene.add(cursor.line);
let painting = false, lastHit = null, paintQueued = null, lastPaintAt = null;

function setMainMode(m) {
  mode = m;
  for (const t of ["objects", "terrain"]) {
    $("tab-" + t).setAttribute("aria-selected", String(t === m));
    $("pane-" + t).hidden = t !== m;
  }
  if (m === "terrain") {
    stopPlacing(); select(null);
    orbit.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  } else {
    orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    cursor.line.visible = false;
  }
  if (view) view.setAttrVisible(m === "terrain" && brush.tool === "attr");
  $("keys-objects").hidden = m !== "objects"; $("keys-terrain").hidden = m !== "terrain";
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
  if (view) view.setAttrVisible(mode === "terrain" && tool === "attr");
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
  const hit = pick(e, [terrainGroup])[0];
  if (hit) {
    const m = fromScene(hit.point);
    $("st-cursor").textContent = `x ${Math.round(m.x)} · y ${Math.round(m.y)} · výška ${(hit.point.y).toFixed(1)} m`;
    lastObjectHit = hit.point.clone();
    if (placing) { placing.ghost.position.set(hit.point.x, heights.at(hit.point.x, hit.point.z), hit.point.z); placing.ghost.rotation.y = rad(placing.yaw); }
    if (mode === "terrain") { cursor.update(heights, hit.point.x, hit.point.z, brush.radius); lastHit = hit.point; }
  } else if (mode === "terrain") cursor.line.visible = false;
  if (painting && hit) queuePaint(hit.point, e);
});
renderer.domElement.addEventListener("pointerdown", (e) => {
  downAt = e.button === 0 ? [e.clientX, e.clientY] : null;
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
  if (placing && placing.prefab) {
    const hit = pick(e, [terrainGroup])[0];
    if (!hit) return;
    const added = placeGroup(placing.items, hit.point.x, hit.point.z, placing.yaw);
    change(() => { objects.push(...added); });
    setMsg(`Položený ${placing.name} (${added.length} objektov).`);
    if (!e.shiftKey) { stopPlacing(); selectMany(added.map((o) => o.id)); }
    return;
  }
  if (placing) {
    const hit = pick(e, [terrainGroup])[0];
    if (!hit) return;
    const p = new THREE.Vector3(hit.point.x, heights.at(hit.point.x, hit.point.z), hit.point.z);
    const o = { id: nextId++, crc: placing.crc, ...fromScene(p), yaw: placing.yaw, pitch: 0, roll: 0, bias: 0 };
    change(() => { objects.push(o); });
    setMsg(`Položené: ${placing.name}.`);
    if (!e.shiftKey) { stopPlacing(); select(o.id); }
    return;
  }
  if (marquee && marquee.moved) return;          // a Shift+drag rectangle, not a click
  const hit = pick(e, [layer.root])[0];
  if (e.shiftKey) { if (hit) select(hit.object.userData.id, { add: true, toggle: true }); return; }
  select(hit ? hit.object.userData.id : null);
});

// Shift + drag in object mode: rectangle selection (captured before the camera controls see the event).
let marquee = null;
viewport.addEventListener("pointerdown", (e) => {
  if (!map || mode !== "objects" || placing || !e.shiftKey || e.button !== 0) return;
  marquee = { x0: e.clientX, y0: e.clientY, el: null, moved: false };
  orbit.enabled = false;
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
  orbit.enabled = true;
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
  selectMany(ids, true);
  setMsg(`Vybraných ${selection.size} objektov.`);
});

/* ---------- keyboard & buttons ---------- */

window.addEventListener("keydown", (e) => {
  if (e.target.matches && e.target.matches("input, select, textarea")) return;
  const k = e.key.toLowerCase();
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
  else if (k === "delete") removeSelected();
  else if (k === "w") setMode("translate");
  else if (k === "e") setMode("rotate");
  else if (k === "g") $("snap").checked = !$("snap").checked;
  else if (k === "f") focusSelected();
  else if (k === "r" && placing) placing.yaw = (placing.yaw + 45) % 360;
  else if (k === "escape") { if (placing) stopPlacing(); else select(null); }
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
  if ((dirty || envDirty || (heights && heights.isDirty)) && !confirmDiscard()) return;
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
window.addEventListener("beforeunload", (e) => { if (dirty || (heights && heights.isDirty)) { e.preventDefault(); e.returnValue = ""; } });

/* ---------- start ---------- */

let shotRequested = false;
window.studio.onAutoOpen((dir) => { shotRequested = true; openMap(dir); });
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

function setCamera({ x, y, distance = 80, yaw = 0, pitch = 50 }) {
  const tx = x ?? orbit.target.x, tz = y ?? orbit.target.z, ty = heights.at(tx, tz);
  const p = rad(pitch), a = rad(yaw);
  orbit.target.set(tx, ty, tz);
  camera.position.set(tx - Math.sin(a) * Math.cos(p) * distance, ty + Math.sin(p) * distance, tz + Math.cos(a) * Math.cos(p) * distance);
  orbit.update();
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

function rgbaToPng(rgba, w, h) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  return c.toDataURL("image/png");
}

async function exportMaps() {
  requireMap();
  await waitModels();
  const files = [];
  for (const c of heights.chunks.values()) {
    files.push({ rel: `${c.key}/minimap.dds`, kind: "dds", width: 256, height: 256, rgba: renderTopDown(c.tx * 256, c.ty * 256, 256, 256, 256, 256) });
  }
  const per = Math.max(64, Math.floor(1024 / Math.max(map.size[0], map.size[1])) & ~3);
  const aw = per * map.size[0], ah = per * map.size[1];
  const atlas = renderTopDown(0, 0, map.size[0] * 256, map.size[1] * 256, aw, ah);
  const ddsName = `${map.name}_atlas.dds`;
  files.push({ rel: `_export/atlas/${ddsName}`, kind: "dds", width: aw, height: ah, rgba: atlas });
  files.push({ rel: "_export/atlas/atlas.sub", kind: "text", text: `title subImage\r\nversion 1.0\r\nimage "${ddsName}"\r\nleft 0\r\ntop 0\r\nright ${aw}\r\nbottom ${ah}\r\n` });
  files.push({ rel: "_export/atlas/preview.png", kind: "png", png: rgbaToPng(atlas, aw, ah) });
  const r = await window.studio.exportWrite(map.dir, files);
  return { minimaps: heights.chunks.size, atlas: `${aw}x${ah}`, folder: r.folder, files: r.files, backup: r.backup, preview: r.preview };
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
  if (dirty || heights.isDirty) add("info", "unsaved", "Mapa má neuložené zmeny.");
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

const API = {
  status() {
    return map ? {
      map: map.name, dir: map.dir, size: map.size, sizeMeters: [map.size[0] * 256, map.size[1] * 256],
      objects: objects.length, selected: [...selection], unsaved: { objects: dirty, terrain: heights.isDirty }, mode, tool: brush.tool,
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
        const zM = it.z !== undefined ? it.z : heights.at(it.x, it.y);
        const o = { id: nextId++, crc, ...fromScene(new THREE.Vector3(it.x, zM, it.y)), yaw: ((it.yaw || 0) % 360 + 360) % 360, pitch: 0, roll: 0, bias: 0 };
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
  async save() { requireMap(); await save(); return { message: $("st-msg").textContent, unsaved: { objects: dirty, terrain: heights.isDirty } }; },
  undo() { undo(); return { undo: undoStack.length, redo: redoStack.length }; },
  redo() { redo(); return { undo: undoStack.length, redo: redoStack.length }; },
  camera(params) { requireMap(); setCamera(params || {}); return { target: orbit.target.toArray().map((v) => +v.toFixed(2)) }; },
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
  setMainMode, setTool, save, undo, redo,
  brush, get model() { return heights; }, get objects() { return objects; },
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
renderer.setAnimationLoop(() => { orbit.update(); environment.follow(camera); renderer.render(scene, camera); });
