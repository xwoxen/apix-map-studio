// APIX Map Studio main process: map files, property library, GR2 -> FBX model cache, asset protocol, saving.
const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { pathToFileURL } = require("url");
const { terrainKey, parseAreaData, saveObjects, parseTextureSet, saveTerrain } = require("./maplib");
const { parseEnvironment } = require("./envlib");

const { APIX_ROOT, EDITOR_ROOT, PACK_ROOT, getAssetRoots, resolveAsset, getLibrary } = require("./assets");
const GRANNY_EXPORTER = path.join(APIX_ROOT, "_codex_granny_compiled", "GrannyExporter.exe");
const CACHE = path.join(app.getPath("userData"), "model-cache");

protocol.registerSchemesAsPrivileged([{ scheme: "apix", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

/* ---------- map reading / writing ---------- */

function readText(file) { return fs.existsSync(file) ? fs.readFileSync(file, "latin1") : ""; }

function textureUrl(gameOrFile) {
  const resolved = resolveAsset(gameOrFile) || (fs.existsSync(gameOrFile) ? gameOrFile : null);
  return resolved ? assetUrl(resolved) : null;
}

function readTextureSet(file) {
  return parseTextureSet(readText(file)).map((e) => ({ ...e, url: textureUrl(e.file) }));
}

/* ---------- terrain texture catalogue and previews ---------- */

let terrainTextures = null;
function listTerrainTextures() {
  if (terrainTextures) return terrainTextures;
  const seen = new Map();
  const visit = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel + "/" + e.name;
      if (e.isDirectory()) visit(path.join(dir, e.name), r);
      else if (/\.dds$/i.test(e.name) && !seen.has(r.toLowerCase())) {
        seen.set(r.toLowerCase(), { game: "d:/ymir work/terrainmaps" + r.toLowerCase(), name: e.name.replace(/\.dds$/i, ""), folder: rel.slice(1) });
      }
    }
  };
  for (const root of getAssetRoots()) visit(path.join(root, "ymir work", "terrainmaps"), "");
  terrainTextures = [...seen.values()].sort((a, b) => (a.folder + a.name).localeCompare(b.folder + b.name));
  return terrainTextures;
}

/* ---------- environments (.msenv in d:/ymir work/environment) ---------- */

let environments = null;
function listEnvironments() {
  if (environments) return environments;
  const seen = new Map();
  const visit = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) visit(path.join(dir, e.name), r);
      else if (/\.msenv$/i.test(e.name) && !seen.has(r.toLowerCase())) seen.set(r.toLowerCase(), { name: r, file: path.join(dir, e.name) });
    }
  };
  for (const root of getAssetRoots()) visit(path.join(root, "ymir work", "environment"), "");
  environments = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  return environments;
}

function loadEnvironment(name) {
  if (!name) return null;
  const hit = listEnvironments().find((e) => e.name.toLowerCase() === name.toLowerCase().replace(/\\/g, "/"));
  if (!hit) return { name, missing: true };
  const env = parseEnvironment(fs.readFileSync(hit.file, "latin1"));
  for (const k of Object.keys(env.sky.faces)) {
    const f = resolveAsset(env.sky.faces[k]);
    env.sky.faces[k] = f ? assetUrl(f) : null;
  }
  return { name: hit.name, ...env };
}

function setEnvironment(dir, name) {
  const file = path.join(dir, "Setting.txt");
  const text = fs.readFileSync(file, "latin1");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(dir, "_studio_backup", stamp);
  fs.mkdirSync(backup, { recursive: true });
  fs.copyFileSync(file, path.join(backup, "Setting.txt"));
  const line = `Environment\t${name || ""}`;
  const out = /^Environment\b.*$/m.test(text) ? text.replace(/^Environment\b.*$/m, line) : text.replace(/\r?\n?$/, `\r\n${line}\r\n`);
  fs.writeFileSync(file, out, "latin1");
  return { backup };
}

const PREVIEWS = path.join(app.getPath("userData"), "texture-previews");
function texturePreview(game) {
  const src = resolveAsset(game) || (fs.existsSync(game) ? game : null);
  if (!src) return Promise.resolve(null);
  const name = require("crypto").createHash("md5").update(src.toLowerCase()).digest("hex") + ".png";
  const dest = path.join(PREVIEWS, name);
  if (fs.existsSync(dest)) return Promise.resolve(assetUrl(dest));
  if (!fs.existsSync(TEXCONV)) return Promise.resolve(null);
  fs.mkdirSync(PREVIEWS, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(PREVIEWS, "tx-"));
  return new Promise((resolve) => {
    execFile(TEXCONV, ["-nologo", "-y", "-ft", "png", "-w", "96", "-h", "96", "-m", "1", "-o", tmp, src], { windowsHide: true, timeout: 30000 }, () => {
      const made = fs.existsSync(tmp) && fs.readdirSync(tmp).find((f) => /\.png$/i.test(f));
      if (made) fs.renameSync(path.join(tmp, made), dest);
      fs.rmSync(tmp, { recursive: true, force: true });
      resolve(made ? assetUrl(dest) : null);
    });
  });
}

function openMap(dir) {
  const setting = readText(path.join(dir, "Setting.txt"));
  if (!setting) throw new Error("V priečinku chýba Setting.txt, nie je to mapa WorldEditora.");
  const size = (setting.match(/MapSize\s+(\d+)\s+(\d+)/) || [0, 1, 1]).slice(1).map(Number);
  const tsRel = (setting.match(/TextureSet\s+(.+)/) || [0, ""])[1].trim();
  const editorRoot = path.dirname(dir);
  const textureSetFile = tsRel ? path.join(editorRoot, tsRel) : path.join(editorRoot, "textureset", path.basename(dir) + ".txt");
  const textures = readTextureSet(textureSetFile);
  const terrains = [];
  let objects = [];
  for (let ty = 0; ty < size[1]; ty++) for (let tx = 0; tx < size[0]; tx++) {
    const key = terrainKey(tx, ty);
    const tdir = path.join(dir, key);
    if (!fs.existsSync(tdir)) continue;
    const read = (n) => (fs.existsSync(path.join(tdir, n)) ? fs.readFileSync(path.join(tdir, n)) : null);
    terrains.push({ key, tx, ty, height: read("height.raw"), tile: read("tile.raw"), water: read("water.wtr"), attr: read("attr.atr") });
    objects = objects.concat(parseAreaData(readText(path.join(tdir, "AreaData.txt")), key));
  }
  const envName = (setting.match(/^Environment[ \t]+([^\r\n]*)/m) || [0, ""])[1].trim();
  return { dir, name: path.basename(dir), size, textures, textureSetFile, terrains, objects, environment: loadEnvironment(envName) };
}

/* ---------- models: GR2 -> FBX cache ---------- */

/* ---------- trees: SpeedTree (.spt) cannot be read, so the view builds a stand-in from its textures ---------- */
// Bark and leaf textures sit next to the .spt; pick the ones whose names share the longest prefix with the tree.
function treeInfo(p) {
  const base = { kind: "tree", size: p.treeSize || 1000, name: p.name, shape: treeShape(p.name + " " + p.model) };
  const spt = resolveAsset(p.model);
  if (!spt) return base;
  const stem = path.basename(spt, path.extname(spt)).toLowerCase();
  let files;
  try { files = fs.readdirSync(path.dirname(spt)).filter((f) => /\.dds$/i.test(f)); } catch { return base; }
  const score = (f) => { const n = f.toLowerCase(); let i = 0; while (i < n.length && i < stem.length && n[i] === stem[i]) i++; return i; };
  const best = (re) => files.filter((f) => re.test(f) && !/shadow/i.test(f)).sort((a, b) => score(b) - score(a))[0];
  const bark = best(/bark|trunk|stamm/i);
  const leaves = best(/lea(f|ves)|frond|needle|composite|free|blatt/i);
  return {
    ...base,
    bark: bark ? assetUrl(path.join(path.dirname(spt), bark)) : null,
    leaves: leaves ? assetUrl(path.join(path.dirname(spt), leaves)) : null
  };
}
function treeShape(name) {
  const n = name.toLowerCase();
  if (/palm|coco/.test(n)) return "palm";
  if (/pine|fir|spruce|cedar|deodar|hemlock|cypress|larch|conifer|tanne|fichte|sequoia|juniper/.test(n)) return "conifer";
  if (/bush|shrub|fern|grass/.test(n)) return "bush";
  return "broadleaf";
}

const converting = new Map();
// Thumbnails ask for many models at once; run at most 3 exporter processes in parallel.
const MAX_EXPORTERS = 3;
let runningExporters = 0;
const exporterQueue = [];
function limitConversions(task) {
  return new Promise((resolve) => {
    const start = () => { runningExporters++; task().then((v) => { runningExporters--; if (exporterQueue.length) exporterQueue.shift()(); resolve(v); }); };
    if (runningExporters < MAX_EXPORTERS) start(); else exporterQueue.push(start);
  });
}

// The exporter only writes PNGs for textures it can find at the absolute d:\ path stored in the GR2.
// The FBX still names every texture (dashes/spaces turned into underscores), so missing ones are rebuilt
// from the DDS next to the source model, or from the game path, with texconv.
const TEXCONV = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages",
  "Microsoft.DirectXTex.Texconv_Microsoft.Winget.Source_8wekyb3d8bbwe", "texconv.exe");
const normalize = (name) => name.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[\s\-]+/g, "_");

function textureRefs(fbx) {
  const text = fs.readFileSync(fbx).toString("latin1");
  return [...new Set(text.match(/[A-Za-z0-9_\-. :\/\\]{3,}\.(png|dds|tga)/gi) || [])];
}

function findSourceTexture(ref, modelFile) {
  const wanted = normalize(path.basename(ref.replace(/\\/g, "/")));
  const dir = path.dirname(modelFile);
  for (const f of fs.readdirSync(dir)) if (/\.(dds|tga|png)$/i.test(f) && normalize(f) === wanted) return path.join(dir, f);
  const game = ref.replace(/\\/g, "/").replace(/ymir_work/i, "ymir work");
  if (/ymir work\//i.test(game)) {
    for (const ext of [".dds", ".tga", ".png"]) {
      const hit = resolveAsset(game.replace(/\.[a-z0-9]+$/i, ext));
      if (hit) return hit;
      const dashed = resolveAsset(game.replace(/\.[a-z0-9]+$/i, ext).replace(/_/g, "-"));
      if (dashed) return dashed;
    }
  }
  return null;
}

function toPng(src, dest) {
  return new Promise((resolve) => {
    if (/\.png$/i.test(src)) { fs.copyFileSync(src, dest); return resolve(true); }
    if (!fs.existsSync(TEXCONV)) return resolve(false);
    const tmp = fs.mkdtempSync(path.join(path.dirname(dest), "tx-"));
    execFile(TEXCONV, ["-nologo", "-y", "-ft", "png", "-o", tmp, src], { windowsHide: true, timeout: 30000 }, () => {
      const made = fs.readdirSync(tmp).find((f) => /\.png$/i.test(f));
      if (made) fs.renameSync(path.join(tmp, made), dest);
      fs.rmSync(tmp, { recursive: true, force: true });
      resolve(Boolean(made));
    });
  });
}

async function recoverTextures(fbx, modelFile, out) {
  for (const ref of textureRefs(fbx)) {
    const dest = path.join(out, path.basename(ref.replace(/\\/g, "/")).replace(/\.[a-z0-9]+$/i, ".png"));
    if (fs.existsSync(dest)) continue;
    const src = findSourceTexture(ref, modelFile);
    if (src) await toPng(src, dest);
  }
}

/* ---------- thumbnails ---------- */

const THUMBS = path.join(app.getPath("userData"), "thumbs");
function thumbFile(crc) { return path.join(THUMBS, `${crc >>> 0}.png`); }
function modelFor(crc) {
  const p = getLibrary().get(crc >>> 0);
  if (!p) return Promise.resolve({ kind: "unknown" });
  if (/^tree$/i.test(p.type)) return Promise.resolve(treeInfo(p));
  if (!/\.gr2$/i.test(p.model)) return Promise.resolve({ kind: "marker", type: p.type, name: p.name });
  const out = path.join(CACHE, String(crc));
  const fbx = path.join(out, "m.fbx");
  if (fs.existsSync(fbx)) {
    // Models cached before texture recovery existed get it once.
    const marker = path.join(out, ".textures");
    if (fs.existsSync(marker)) return Promise.resolve({ kind: "fbx", url: assetUrl(fbx), name: p.name });
    const src = resolveAsset(p.model);
    return (src ? recoverTextures(fbx, src, out) : Promise.resolve()).then(() => {
      fs.writeFileSync(marker, "");
      return { kind: "fbx", url: assetUrl(fbx), name: p.name };
    });
  }
  if (converting.has(crc)) return converting.get(crc);
  const src = resolveAsset(p.model);
  if (!src) return Promise.resolve({ kind: "missing", name: p.name, model: p.model });
  const job = limitConversions(() => new Promise((resolve) => {
    fs.mkdirSync(out, { recursive: true });
    fs.copyFileSync(src, path.join(out, "m.gr2"));
    // The exporter cuts the output name at the first '.', so it always works on m.gr2 in a dot-free cache path.
    execFile(GRANNY_EXPORTER, [path.join(out, "m.gr2")], { cwd: path.dirname(GRANNY_EXPORTER), timeout: 60000, windowsHide: true }, async () => {
      if (fs.existsSync(fbx)) { await recoverTextures(fbx, src, out); fs.writeFileSync(path.join(out, ".textures"), ""); }
      converting.delete(crc);
      resolve(fs.existsSync(fbx) ? { kind: "fbx", url: assetUrl(fbx), name: p.name } : { kind: "missing", name: p.name, model: p.model });
    });
  }));
  converting.set(crc, job);
  return job;
}

/* ---------- walking character (play mode) ---------- */

// A warrior with hair and the general wait/walk/run motions, converted like map models into model-cache/pc/<part>.
const CHARACTER = {
  body: "d:/ymir work/pc/warrior/warrior_novice.gr2",
  hair: "d:/ymir work/pc/warrior/hair/hair_1_1.gr2",
  wait: "d:/ymir work/pc/warrior/general/wait.gr2",
  walk: "d:/ymir work/pc/warrior/general/walk.gr2",
  run: "d:/ymir work/pc/warrior/general/run.gr2"
};
function convertGr2(game, out) {
  const fbx = path.join(out, "m.fbx");
  if (fs.existsSync(fbx)) return Promise.resolve(assetUrl(fbx));
  const src = resolveAsset(game);
  if (!src) return Promise.resolve(null);
  return limitConversions(() => new Promise((resolve) => {
    fs.mkdirSync(out, { recursive: true });
    fs.copyFileSync(src, path.join(out, "m.gr2"));
    execFile(GRANNY_EXPORTER, [path.join(out, "m.gr2")], { cwd: path.dirname(GRANNY_EXPORTER), timeout: 60000, windowsHide: true }, async () => {
      if (!fs.existsSync(fbx)) return resolve(null);
      await recoverTextures(fbx, src, out);
      resolve(assetUrl(fbx));
    });
  }));
}
async function characterParts() {
  const parts = {};
  for (const [k, game] of Object.entries(CHARACTER)) parts[k] = await convertGr2(game, path.join(CACHE, "pc", k));
  return parts;
}

/* ---------- asset protocol ---------- */

// Path-shaped URLs so loaders can resolve relative files (an FBX finds its PNG textures next to it).
function assetUrl(file) { return "apix://file/" + path.resolve(file).split(path.sep).map(encodeURIComponent).join("/"); }
function allowed(file) {
  const f = path.resolve(file).toLowerCase();
  return [CACHE, THUMBS, PREVIEWS, EDITOR_ROOT, PACK_ROOT, "D:\\ymir work"].some((r) => f.startsWith(path.resolve(r).toLowerCase()));
}

/* ---------- window & IPC ---------- */

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 900, minHeight: 600, title: "APIX Map Studio", backgroundColor: "#1b1d22",
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, backgroundThrottling: false }
  });
  // A hidden window never repaints, so screenshot runs keep it visible but off-screen.
  if (process.argv.includes("--screenshot")) { win.setSkipTaskbar(true); win.setPosition(-20000, 0); }
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  if (process.argv.includes("--screenshot")) {
    win.webContents.on("console-message", (_e, level, message) => { if (level >= 2) console.log("[renderer]", message); });
  }
}

ipcMain.handle("map:choose", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Otvoriť mapu (priečinok so Setting.txt)", defaultPath: EDITOR_ROOT, properties: ["openDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("map:open", (_, dir) => openMap(dir));
ipcMain.handle("map:new", (_, params) => createBlankMap(params));

// Prefabs: saved object groups (relative layout) in %APPDATA%\APIX Map Studio\prefabs\<name>.json
const PREFABS = path.join(app.getPath("userData"), "prefabs");
const prefabFile = (name) => {
  if (!/^[\w \-]{1,60}$/.test(String(name || ""))) throw new Error("Názov prefabu: písmená, čísla, medzera, - a _");
  return path.join(PREFABS, `${name}.json`);
};
ipcMain.handle("prefab:list", () => {
  if (!fs.existsSync(PREFABS)) return [];
  return fs.readdirSync(PREFABS).filter((f) => f.endsWith(".json")).map((f) => {
    try { const p = JSON.parse(fs.readFileSync(path.join(PREFABS, f), "utf8")); return { name: p.name, count: p.items.length }; } catch { return null; }
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
});
ipcMain.handle("prefab:get", (_, name) => JSON.parse(fs.readFileSync(prefabFile(name), "utf8")));
ipcMain.handle("prefab:save", (_, name, items) => {
  fs.mkdirSync(PREFABS, { recursive: true });
  fs.writeFileSync(prefabFile(name), JSON.stringify({ name, created: new Date().toISOString(), items }, null, 2));
  return { name, count: items.length };
});
ipcMain.handle("prefab:delete", (_, name) => { fs.rmSync(prefabFile(name), { force: true }); return true; });
ipcMain.handle("map:save", (_, dir, size, objects) => saveObjects(dir, size, objects));
ipcMain.handle("terrain:save", (_, dir, payload) => saveTerrain(dir, payload));
ipcMain.handle("textures:list", () => listTerrainTextures());
ipcMain.handle("texture:preview", (_, game) => texturePreview(game));
ipcMain.handle("texture:url", (_, game) => textureUrl(game));
ipcMain.handle("export:write", (_, dir, files) => writeExport(dir, files));
ipcMain.handle("env:list", () => listEnvironments().map((e) => e.name));
ipcMain.handle("env:get", (_, name) => loadEnvironment(name));
ipcMain.handle("env:set", (_, dir, name) => setEnvironment(dir, name));

// Uncompressed 32-bit BGRX DDS, the same layout WorldEditor writes for minimap.dds.
function ddsBgrx(width, height, rgba) {
  const head = Buffer.alloc(128);
  head.write("DDS ", 0, "ascii");
  head.writeUInt32LE(124, 4); head.writeUInt32LE(0x1007, 8); head.writeUInt32LE(height, 12); head.writeUInt32LE(width, 16);
  head.writeUInt32LE(32, 76); head.writeUInt32LE(0x40, 80); head.writeUInt32LE(32, 88);
  head.writeUInt32LE(0x00ff0000, 92); head.writeUInt32LE(0x0000ff00, 96); head.writeUInt32LE(0x000000ff, 100);
  head.writeUInt32LE(0x1000, 108);
  const px = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) { px[i * 4] = rgba[i * 4 + 2]; px[i * 4 + 1] = rgba[i * 4 + 1]; px[i * 4 + 2] = rgba[i * 4]; px[i * 4 + 3] = 0; }
  return Buffer.concat([head, px]);
}

function writeExport(dir, files) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(dir, "_studio_backup", stamp);
  const written = [];
  let preview = null;
  for (const f of files) {
    const dest = path.join(dir, f.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest) && !f.rel.startsWith("_export")) {
      fs.mkdirSync(path.dirname(path.join(backup, f.rel)), { recursive: true });
      fs.copyFileSync(dest, path.join(backup, f.rel));
    }
    if (f.kind === "dds") fs.writeFileSync(dest, ddsBgrx(f.width, f.height, f.rgba));
    else if (f.kind === "png") { fs.writeFileSync(dest, Buffer.from(f.png.replace(/^data:image\/png;base64,/, ""), "base64")); preview = assetUrl(dest); }
    else fs.writeFileSync(dest, f.text, "latin1");
    written.push(f.rel);
  }
  return { folder: path.join(dir, "_export", "atlas"), files: written, backup: fs.existsSync(backup) ? backup : null, preview };
}
// Properties whose GR2 model is not in the client (the main Property pack lists zones the client doesn't ship)
// stay in the library for the map check but are left out of the list; their old placeholder thumbnails go.
function modelAvailable(p) {
  if (p.available === undefined) {
    p.available = !/\.gr2$/i.test(p.model) || Boolean(resolveAsset(p.model));
    if (!p.available) fs.rmSync(thumbFile(p.crc), { force: true });
  }
  return p.available;
}
ipcMain.handle("library:list", () => [...getLibrary().values()].filter(modelAvailable).map(({ crc, name, type, folder, model }) => ({ crc, name, type, folder, model })));
ipcMain.handle("model:get", (_, crc) => modelFor(crc));
ipcMain.handle("character:get", () => characterParts());
ipcMain.handle("thumb:get", (_, crc) => (fs.existsSync(thumbFile(crc)) ? assetUrl(thumbFile(crc)) : null));
ipcMain.handle("thumb:save", (_, crc, dataUrl) => {
  const png = Buffer.from(String(dataUrl).replace(/^data:image\/png;base64,/, ""), "base64");
  fs.mkdirSync(THUMBS, { recursive: true });
  fs.writeFileSync(thumbFile(crc), png);
  return assetUrl(thumbFile(crc));
});
ipcMain.handle("shell:reveal", (_, file) => shell.showItemInFolder(file));

/* ---------- control bridge (used by the MCP server in mcp/server.js) ---------- */
// Local HTTP on 127.0.0.1 with a per-start token; the endpoint file tells the MCP server where to connect.
const http = require("http");
const ENDPOINT_FILE = path.join(app.getPath("userData"), "control-endpoint.json");
const SHOTS = path.join(app.getPath("userData"), "screenshots");

async function callRenderer(method, params) {
  const js = `window.__studio && window.__studio.api ? window.__studio.api(${JSON.stringify(method)}, ${JSON.stringify(params || {})}) : Promise.reject(new Error("Studio is still starting"))`;
  return win.webContents.executeJavaScript(js, true);
}

// New flat map (raw height 32767, one base texture, no water) written by mapgen, then opened.
// template: "empty" (flat, one base texture), "island" (mapgen/maps/ostrov.js, 1x1) or "dungeon" (mapgen/maps/dungeon.js).
function createBlankMap({ name, sizeX = 1, sizeY = 1, baseTexture = "d:/ymir work/terrainmaps/a/grass/grass 01.dds", template = "empty", seed }) {
  if (!/^[a-z0-9_]+$/i.test(String(name || ""))) throw new Error("Názov mapy: len písmená, čísla a _");
  const dir = path.join(EDITOR_ROOT, name);
  if (fs.existsSync(dir)) throw new Error(`Mapa ${name} už existuje`);
  const { generate } = require("./mapgen/mapgen.js");
  let spec;
  if (template === "island") spec = { ...require("./mapgen/maps/ostrov.js"), name };
  else if (template === "dungeon") spec = require("./mapgen/maps/dungeon.js").create({ name, sizeX, sizeY, seed: seed || name + Date.now() });
  else spec = { name, sizeX, sizeY, height: () => 32767, texture: () => 1, textures: [{ file: baseTexture }], water: null, objects: () => [] };
  generate(spec, EDITOR_ROOT, name);
  return dir;
}

async function bridgeCall(method, params) {
  if (method === "new_map") return callRenderer("open_map", { dir: createBlankMap(params) });
  if (method === "screenshot") {
    const r = await callRenderer("screenshot", params);                     // renderer prepares the view and returns a PNG
    fs.mkdirSync(SHOTS, { recursive: true });
    const file = path.join(SHOTS, `shot-${Date.now()}.png`);
    fs.writeFileSync(file, Buffer.from(r.png.replace(/^data:image\/png;base64,/, ""), "base64"));
    return { file, width: r.width, height: r.height };
  }
  if (method === "window_screenshot") {
    fs.mkdirSync(SHOTS, { recursive: true });
    const file = path.join(SHOTS, `window-${Date.now()}.png`);
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    return { file };
  }
  return callRenderer(method, params);
}

function startBridge() {
  const token = require("crypto").randomBytes(24).toString("hex");
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 20e6) req.destroy(); });
    req.on("end", async () => {
      res.setHeader("Content-Type", "application/json");
      try {
        const msg = JSON.parse(body || "{}");
        if (msg.token !== token) { res.statusCode = 403; return res.end(JSON.stringify({ ok: false, error: "bad token" })); }
        const result = await bridgeCall(String(msg.method), msg.params || {});
        res.end(JSON.stringify({ ok: true, result }));
      } catch (e) {
        res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      }
    });
  });
  server.listen(0, "127.0.0.1", () => {
    fs.mkdirSync(path.dirname(ENDPOINT_FILE), { recursive: true });
    fs.writeFileSync(ENDPOINT_FILE, JSON.stringify({ host: "127.0.0.1", port: server.address().port, token, pid: process.pid }, null, 2));
  });
  app.on("will-quit", () => { try { fs.unlinkSync(ENDPOINT_FILE); } catch { /* already gone */ } });
}

function argValue(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; }

app.whenReady().then(() => {
  protocol.handle("apix", (req) => {
    const file = path.resolve(new URL(req.url).pathname.replace(/^\//, "").split("/").map(decodeURIComponent).join(path.sep));
    if (!allowed(file) || !fs.existsSync(file)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  if (!process.argv.includes("--screenshot")) startBridge();
  // Dev/test flags: --open <map dir> loads a map on start, --screenshot <png> saves the view and quits.
  const open = argValue("--open"), shot = argValue("--screenshot");
  win.webContents.on("did-finish-load", () => {
    if (open) win.webContents.send("map:auto-open", open);
    if (shot) {
      ipcMain.once("app:ready-for-shot", () => setTimeout(async () => {
        const script = argValue("--eval");
        if (script) {
          try { console.log("[eval]", JSON.stringify(await win.webContents.executeJavaScript(fs.readFileSync(script, "utf8")))); }
          catch (e) { console.log("[eval] failed:", e.message); }
          await new Promise((r) => setTimeout(r, 1500));
        }
        const image = await win.webContents.capturePage();
        fs.writeFileSync(shot, image.toPNG());
        app.exit(0);                                   // test runs skip the unsaved-changes prompt
      }, Number(argValue("--shot-delay") || 0)));
    }
  });
});
app.on("window-all-closed", () => app.quit());
