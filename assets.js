// Client asset lookup shared by Map Studio and the command-line tools: "d:/ymir work/..." paths resolve through
// the pack folders in Index order, and the property library maps CRCs to models (first owner wins).
const path = require("path");
const fs = require("fs");

const APIX_ROOT = "C:\\Users\\micha\\Documents\\APIX";
const EDITOR_ROOT = "C:\\Users\\micha\\Documents\\we_remix_v59__20260716-1745";
const PACK_ROOT = path.join(APIX_ROOT, "apix-client", "bin", "pack");

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
  // every pack folder with property/ counts (the main "Property" pack has no ymir work/), in Index order
  const dirs = [path.join(EDITOR_ROOT, "property")];
  const packs = [];
  try {
    for (const line of fs.readFileSync(path.join(PACK_ROOT, "Index"), "utf8").split(/\r?\n/)) { const n = line.split("\t")[0].trim(); if (n) packs.push(path.join(PACK_ROOT, n)); }
    for (const n of fs.readdirSync(PACK_ROOT)) packs.push(path.join(PACK_ROOT, n));
  } catch { /* no client pack folder */ }
  for (const root of [...packs, ...getAssetRoots()]) {
    const p = path.join(root, "property");
    if (fs.existsSync(p) && !dirs.some((d) => d.toLowerCase() === p.toLowerCase())) dirs.push(p);
  }
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

module.exports = { APIX_ROOT, EDITOR_ROOT, PACK_ROOT, getAssetRoots, resolveAsset, getLibrary };
