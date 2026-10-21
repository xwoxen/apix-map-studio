import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { TerrainModel, TerrainView } from "./terrain.js";
import { TOOLS, paint, sample, attrMask, BrushCursor } from "./brush.js";
import { ObjectLayer, template, toScene, fromScene } from "./objects.js";
import { thumbnail } from "./thumbs.js";

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
scene.add(new THREE.HemisphereLight(0xdfeaff, 0x5a5040, 1.6));
const sun = new THREE.DirectionalLight(0xfff3dd, 2.0);
sun.position.set(200, 400, 150);
scene.add(sun);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.maxPolarAngle = Math.PI * 0.49;
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setSpace("world");
scene.add(gizmo.getHelper ? gizmo.getHelper() : gizmo);

const layer = new ObjectLayer();
scene.add(layer.root);
const selBox = new THREE.BoxHelper(undefined, 0xffd27a);
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
  objects = JSON.parse(entry.state); layer.sync(objects); select(selected && objects.find((o) => o.id === selected.id) ? selected.id : null); dirty = true; updateUi();
  return current;
}

function updateUi() {
  $("btn-save").disabled = !map;
  $("btn-undo").disabled = !undoStack.length;
  $("btn-redo").disabled = !redoStack.length;
  $("st-objects").textContent = `${objects.length} objektov`;
  const unsaved = dirty || (heights && heights.isDirty);
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
  scene.fog.near = w * 1.5; scene.fog.far = w * 5;
  $("empty-state").hidden = true;
  updateUi();
  setMsg(`Mapa ${map.name}: ${map.size[0]}×${map.size[1]}, ${objects.length} objektov, ${map.textures.length} textúr.`);
}

layer.onLoaded = (pending) => {
  $("st-models").textContent = pending ? `načítavam modely: ${pending}` : "";
  if (selected) selBox.setFromObject(layer.nodes.get(selected.id));
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
    if (heights.isDirty) {
      const r = await window.studio.saveTerrain(map.dir, heights.savePayload());
      heights.markSaved();
      parts.push(`terén (${r.files.length} súborov)`); backup = r.backup;
    }
    updateUi();
    setMsg(parts.length ? `Uložené: ${parts.join(", ")}. Záloha pôvodných súborov je v ${backup}.` : "Nie je čo ukladať.");
  } catch (e) { setMsg("Uloženie zlyhalo: " + e.message, true); }
}

/* ---------- selection & editing ---------- */

function select(id) {
  selected = id ? objects.find((o) => o.id === id) : null;
  const node = selected && layer.nodes.get(selected.id);
  if (node) { gizmo.attach(node); selBox.setFromObject(node); selBox.visible = true; }
  else { gizmo.detach(); selBox.visible = false; }
  renderInspector();
}

function setMode(mode) {
  gizmo.setMode(mode);
  gizmo.showX = gizmo.showZ = mode === "translate";
  gizmo.showY = true;
  $("mode-move").setAttribute("aria-pressed", String(mode === "translate"));
  $("mode-rotate").setAttribute("aria-pressed", String(mode === "rotate"));
  if (mode === "rotate") { gizmo.showX = false; gizmo.showZ = false; }
}

let dragBefore = null;
gizmo.addEventListener("dragging-changed", (e) => {
  orbit.enabled = !e.value;
  if (e.value) dragBefore = snapshot();
  else if (dragBefore) { pushHistory(dragBefore); dragBefore = null; renderInspector(); }
});
gizmo.addEventListener("objectChange", () => {
  if (!selected) return;
  const node = layer.nodes.get(selected.id);
  if ($("snap").checked && gizmo.mode === "translate" && heights) node.position.y = heights.at(node.position.x, node.position.z);
  node.rotation.x = 0; node.rotation.z = 0;
  Object.assign(selected, fromScene(node.position));
  selected.yaw = ((deg(node.rotation.y) % 360) + 360) % 360;
  selBox.setFromObject(node);
  renderInspectorValues();
});

function change(fn) {
  const before = snapshot();
  fn();
  layer.sync(objects);
  pushHistory(before);
  if (selected) select(selected.id);
}

function removeSelected() {
  if (!selected) return;
  const id = selected.id;
  change(() => { objects = objects.filter((o) => o.id !== id); selected = null; });
  setMsg("Objekt zmazaný.");
}
function duplicateSelected() {
  if (!selected) return;
  const copy = { ...selected, id: nextId++ };
  const p = toScene(copy); p.x += 3; p.z += 3;
  if (heights) p.y = heights.at(p.x, p.z);
  Object.assign(copy, fromScene(p));
  change(() => { objects.push(copy); selected = copy; });
  setMsg("Objekt zduplikovaný.");
}
function focusSelected() {
  if (!selected) return;
  const p = toScene(selected), off = camera.position.clone().sub(orbit.target).setLength(40);
  orbit.target.copy(p); camera.position.copy(p).add(off);
}

/* ---------- inspector ---------- */

function renderInspector() {
  const el = $("inspector");
  if (!selected) { el.innerHTML = `<p class="muted" style="padding:0">Klikni na objekt v mape.</p>`; return; }
  const info = libByCrc.get(selected.crc);
  el.innerHTML = `
    <div class="title">${info ? escapeHtml(info.name) : "Neznámy objekt"}</div>
    <div class="sub">${info ? escapeHtml(info.type) + " · " : ""}CRC ${selected.crc}</div>
    ${["x", "y", "z", "yaw"].map((k) => `<div class="field"><label for="f-${k}">${k === "yaw" ? "rotácia" : k + " (cm)"}</label><input type="number" id="f-${k}" step="${k === "yaw" ? 15 : 50}"></div>`).join("")}
    <div class="row-actions"><button type="button" id="i-ground">Položiť na terén</button><button type="button" id="i-dup">Duplikovať</button><button type="button" class="danger" id="i-del">Zmazať</button></div>`;
  renderInspectorValues();
  for (const k of ["x", "y", "z", "yaw"]) {
    $("f-" + k).addEventListener("change", (e) => {
      const v = Number(e.target.value);
      if (!Number.isFinite(v)) return;
      change(() => { selected[k] = k === "yaw" ? ((v % 360) + 360) % 360 : v; });
    });
  }
  $("i-ground").addEventListener("click", () => change(() => { const p = toScene(selected); selected.z = heights.at(p.x, p.z) * 100; }));
  $("i-dup").addEventListener("click", duplicateSelected);
  $("i-del").addEventListener("click", removeSelected);
}
function renderInspectorValues() {
  if (!selected) return;
  for (const k of ["x", "y", "z", "yaw"]) { const f = $("f-" + k); if (f && document.activeElement !== f) f.value = Math.round(selected[k] * 10) / 10; }
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/* ---------- library & placing ---------- */

let libType = "Building";
function renderLibrary() {
  const q = $("lib-search").value.trim().toLowerCase();
  const types = [...new Set(library.map((p) => p.type))].sort();
  $("lib-types").innerHTML = ["Všetko", ...types].map((t) => `<button type="button" class="chip" data-type="${escapeHtml(t)}" aria-pressed="${t === libType}">${escapeHtml(t)}</button>`).join("");
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
$("lib-list").addEventListener("mouseleave", () => { if (placing) showPreview(placing.crc); else $("lib-preview").hidden = true; });
$("lib-search").addEventListener("input", renderLibrary);
$("lib-types").addEventListener("click", (e) => { const b = e.target.closest("[data-type]"); if (b) { libType = b.dataset.type; renderLibrary(); } });
$("lib-list").addEventListener("click", (e) => { const li = e.target.closest("[data-crc]"); if (li && map) startPlacing(Number(li.dataset.crc)); });

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
let downAt = null;
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
  const hit = pick(e, [layer.root])[0];
  select(hit ? hit.object.userData.id : null);
});

/* ---------- keyboard & buttons ---------- */

window.addEventListener("keydown", (e) => {
  if (e.target.matches("input")) return;
  const k = e.key.toLowerCase();
  if (k === "[" || k === "]") { const r = $("radius"); r.value = Number(r.value) + (k === "]" ? 2 : -2); r.dispatchEvent(new Event("input")); return; }
  if (k === "t" && !e.ctrlKey) { setMainMode(mode === "terrain" ? "objects" : "terrain"); return; }
  if (e.ctrlKey && k === "s") { e.preventDefault(); save(); }
  else if (e.ctrlKey && k === "o") { e.preventDefault(); chooseAndOpen(); }
  else if (e.ctrlKey && k === "z") { e.preventDefault(); undo(); }
  else if (e.ctrlKey && (k === "y" || (e.shiftKey && k === "z"))) { e.preventDefault(); redo(); }
  else if (e.ctrlKey && k === "d") { e.preventDefault(); duplicateSelected(); }
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

// Hook for scripted tests (main --eval): paint strokes and save without a mouse.
window.__studio = {
  setMainMode, setTool, save, undo, redo,
  brush, get model() { return heights; }, get objects() { return objects; },
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
renderer.setAnimationLoop(() => { orbit.update(); renderer.render(scene, camera); });
