// APIX Map Studio main process: map files, property library, GR2 -> FBX model cache, asset protocol, saving.
const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { pathToFileURL } = require("url");
const { terrainKey, parseAreaData, saveObjects } = require("./maplib");

const APIX_ROOT = "C:\\Users\\micha\\Documents\\APIX";
const EDITOR_ROOT = "C:\\Users\\micha\\Documents\\we_remix_v59__20260716-1745";
const PACK_ROOT = path.join(APIX_ROOT, "apix-client", "bin", "pack");
const GRANNY_EXPORTER = path.join(APIX_ROOT, "_codex_granny_compiled", "GrannyExporter.exe");
const CACHE = path.join(app.getPath("userData"), "model-cache");

protocol.registerSchemesAsPrivileged([{ scheme: "apix", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

/* ---------- asset roots ("d:/ymir work/..." resolution) ---------- */

let assetRoots = null;   // directories that contain "ymir work", in the client's pack Index order
function getAssetRoots() {
  if (assetRoots) return assetRoots;
  const roots = [];
  const add = (dir) => { if (fs.existsSync(path.join(dir, "ymir work")) && !roots.includes(dir)) roots.push(dir); };
  try {
    for (const line of fs.readFileSync(path.join(PACK_ROOT, "Index"), "utf8").split(/\r?\n/)) {
      const name = line.split("\t")[0].trim();
      if (name) add(path.join(PACK_ROOT, name));
    }
    for (const name of fs.readdirSync(PACK_ROOT)) add(path.join(PACK_ROOT, name));
  } catch { /* pack folder missing: fall back to the editor drive */ }
  add(path.join(EDITOR_ROOT, "_asset_root"));
  if (fs.existsSync("D:\\ymir work")) add("D:\\");
  assetRoots = roots;
  return roots;
}

function resolveAsset(gamePath) {
  const rel = String(gamePath).replace(/\\/g, "/").replace(/^d:\//i, "").replace(/^\/+/, "");
  if (!/^ymir work\//i.test(rel)) return null;
  for (const root of getAssetRoots()) {
    const file = path.join(root, rel);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/* ---------- property library ---------- */

let library = null;      // crc -> { crc, name, type, file, model, treeSize, folder }
function parseProperty(file) {
  const text = fs.readFileSync(file, "latin1");
  const lines = text.split(/\r?\n/);
  if (!lines[0].startsWith("YPRT")) return null;
  const crc = Number(lines[1]) >>> 0;
  const field = (key) => { const m = text.match(new RegExp("^" + key + "\\s+\"([^\"]*)\"", "mi")); return m ? m[1] : ""; };
  return {
    crc,
    name: field("propertyname") || path.basename(file, path.extname(file)),
    type: field("propertytype") || "Unknown",
    model: field("buildingfile") || field("treefile") || field("effectfile") || "",
    treeSize: Number(field("treesize")) || 0,
    file
  };
}
function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(prb|prt|pre|pra|prd)$/i.test(entry.name)) out.push(full);
  }
}
function getLibrary() {
  if (library) return library;
  const files = [];
  const dirs = [path.join(EDITOR_ROOT, "property")];
  for (const root of getAssetRoots()) if (fs.existsSync(path.join(root, "property"))) dirs.push(path.join(root, "property"));
  for (const d of dirs) { try { walk(d, files); } catch { /* unreadable folder */ } }
  library = new Map();
  for (const file of files) {
    try {
      const p = parseProperty(file);
      if (p && !library.has(p.crc)) {                            // first owner wins, like the client
        p.folder = path.relative(path.dirname(path.dirname(file)), path.dirname(file)) || "";
        library.set(p.crc, p);
      }
    } catch { /* skip malformed property */ }
  }
  return library;
}

/* ---------- map reading / writing ---------- */

function readText(file) { return fs.existsSync(file) ? fs.readFileSync(file, "latin1") : ""; }

function readTextureSet(file) {
  const text = readText(file);
  const textures = [];
  const re = /Start Texture(\d+)\s+"([^"]*)"\s+([\d.\-]+)\s+([\d.\-]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const resolved = resolveAsset(m[2]) || (fs.existsSync(m[2]) ? m[2] : null);
    textures.push({ index: Number(m[1]), file: m[2], uScale: Number(m[3]), vScale: Number(m[4]), url: resolved ? assetUrl(resolved) : null });
  }
  return textures;
}

function openMap(dir) {
  const setting = readText(path.join(dir, "Setting.txt"));
  if (!setting) throw new Error("V priečinku chýba Setting.txt, nie je to mapa WorldEditora.");
  const size = (setting.match(/MapSize\s+(\d+)\s+(\d+)/) || [0, 1, 1]).slice(1).map(Number);
  const tsRel = (setting.match(/TextureSet\s+(.+)/) || [0, ""])[1].trim();
  const editorRoot = path.dirname(dir);
  const textures = tsRel ? readTextureSet(path.join(editorRoot, tsRel)) : [];
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
  return { dir, name: path.basename(dir), size, textures, terrains, objects };
}

/* ---------- models: GR2 -> FBX cache ---------- */

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
  if (/^tree$/i.test(p.type)) return Promise.resolve({ kind: "tree", size: p.treeSize || 1000, name: p.name });
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

/* ---------- asset protocol ---------- */

// Path-shaped URLs so loaders can resolve relative files (an FBX finds its PNG textures next to it).
function assetUrl(file) { return "apix://file/" + path.resolve(file).split(path.sep).map(encodeURIComponent).join("/"); }
function allowed(file) {
  const f = path.resolve(file).toLowerCase();
  return [CACHE, THUMBS, EDITOR_ROOT, PACK_ROOT, "D:\\ymir work"].some((r) => f.startsWith(path.resolve(r).toLowerCase()));
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
ipcMain.handle("map:save", (_, dir, size, objects) => saveObjects(dir, size, objects));
ipcMain.handle("library:list", () => [...getLibrary().values()].map(({ crc, name, type, folder, model }) => ({ crc, name, type, folder, model })));
ipcMain.handle("model:get", (_, crc) => modelFor(crc));
ipcMain.handle("thumb:get", (_, crc) => (fs.existsSync(thumbFile(crc)) ? assetUrl(thumbFile(crc)) : null));
ipcMain.handle("thumb:save", (_, crc, dataUrl) => {
  const png = Buffer.from(String(dataUrl).replace(/^data:image\/png;base64,/, ""), "base64");
  fs.mkdirSync(THUMBS, { recursive: true });
  fs.writeFileSync(thumbFile(crc), png);
  return assetUrl(thumbFile(crc));
});
ipcMain.handle("shell:reveal", (_, file) => shell.showItemInFolder(file));

function argValue(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; }

app.whenReady().then(() => {
  protocol.handle("apix", (req) => {
    const file = path.resolve(new URL(req.url).pathname.replace(/^\//, "").split("/").map(decodeURIComponent).join(path.sep));
    if (!allowed(file) || !fs.existsSync(file)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  // Dev/test flags: --open <map dir> loads a map on start, --screenshot <png> saves the view and quits.
  const open = argValue("--open"), shot = argValue("--screenshot");
  win.webContents.on("did-finish-load", () => {
    if (open) win.webContents.send("map:auto-open", open);
    if (shot) {
      ipcMain.once("app:ready-for-shot", () => setTimeout(async () => {
        const image = await win.webContents.capturePage();
        fs.writeFileSync(shot, image.toPNG());
        app.quit();
      }, Number(argValue("--shot-delay") || 0)));
    }
  });
});
app.on("window-all-closed", () => app.quit());
