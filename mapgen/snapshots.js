// Snapshots of a map's saved state inside the map folder (_studio_snapshots/<id>/): every terrain file, Setting.txt,
// MapProperty.txt, Map Studio's _studio files (spawns) and the map's texture set. For trying variants of a design:
// save, experiment, compare, go back. Restore first snapshots the current state ("pred obnovou ..."), so it never loses work.
const fs = require("fs"), path = require("path");

const DIR = "_studio_snapshots";
const OBJ = /Start Object\d+\s([\s\S]*?)End Object/g;
const objectLines = (t) => [...t.matchAll(OBJ)].map((m) => m[1].trim().split(/\s+/).join(" "));
const isTerrain = (n) => /^\d{6}$/.test(n);

function textureSetFile(mapDir) {
  const s = fs.readFileSync(path.join(mapDir, fs.readdirSync(mapDir).find((f) => f.toLowerCase() === "setting.txt")), "latin1");
  const rel = (s.match(/TextureSet\s+(\S+)/) || [])[1];
  if (!rel) return null;
  const f = path.join(path.dirname(mapDir), ...rel.replace(/\\/g, "/").split("/"));
  return fs.existsSync(f) ? f : null;
}

// relative path -> absolute, for everything a snapshot keeps
function stateFiles(mapDir) {
  const out = new Map();
  for (const n of fs.readdirSync(mapDir)) {
    const p = path.join(mapDir, n), st = fs.statSync(p);
    if (st.isFile() && !n.startsWith(".")) out.set(n, p);
    else if (st.isDirectory() && isTerrain(n)) for (const f of fs.readdirSync(p)) { if (fs.statSync(path.join(p, f)).isFile()) out.set(`${n}/${f}`, path.join(p, f)); }
    else if (st.isDirectory() && n === "_studio") for (const f of fs.readdirSync(p)) { if (fs.statSync(path.join(p, f)).isFile()) out.set(`_studio/${f}`, path.join(p, f)); }
  }
  const ts = textureSetFile(mapDir);
  if (ts) out.set("@textureset", ts);
  return out;
}

function saveSnapshot(mapDir, label = "") {
  const d = new Date(), two = (n) => String(n).padStart(2, "0");
  const id = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}` + (label ? "_" + label.replace(/[^\w\-]+/g, "_").slice(0, 40) : "");
  let dest = path.join(mapDir, DIR, id);
  for (let k = 2; fs.existsSync(dest); k++) dest = path.join(mapDir, DIR, `${id}_${k}`);   // two snapshots in one second
  const finalId = path.basename(dest);
  let files = 0, objects = 0;
  for (const [rel, src] of stateFiles(mapDir)) {
    const out = path.join(dest, ...rel.split("/"));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(src, out);
    files++;
    if (/areadata\.txt$/i.test(rel)) objects += objectLines(fs.readFileSync(src, "latin1")).length;
  }
  const meta = { id: finalId, label, created: d.toISOString(), files, objects };
  fs.writeFileSync(path.join(dest, "meta.json"), JSON.stringify(meta, null, 1));
  return meta;
}

function listSnapshots(mapDir) {
  const root = path.join(mapDir, DIR);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).map((id) => { try { return JSON.parse(fs.readFileSync(path.join(root, id, "meta.json"), "utf8")); } catch { return null; } }).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
}

// what differs between a snapshot and the current files: changed / added / removed files, objects per terrain
function diffSnapshot(mapDir, id) {
  const snap = path.join(mapDir, DIR, id);
  if (!fs.existsSync(snap)) throw new Error("snímka neexistuje: " + id);
  const now = stateFiles(mapDir), then = new Map();
  const walk = (dir, rel) => { for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); if (fs.statSync(p).isDirectory()) walk(p, rel ? `${rel}/${n}` : n); else if (n !== "meta.json" || rel) then.set(rel ? `${rel}/${n}` : n, p); } };
  walk(snap, "");
  const changed = [], objects = {};
  for (const [rel, p] of now) {
    const old = then.get(rel);
    if (!old) { changed.push({ file: rel, change: "nový" }); continue; }
    if (!fs.readFileSync(old).equals(fs.readFileSync(p))) {
      changed.push({ file: rel, change: "zmenený" });
      if (/areadata\.txt$/i.test(rel)) {
        const count = (a) => a.reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
        const b = count(objectLines(fs.readFileSync(old, "latin1"))), a = count(objectLines(fs.readFileSync(p, "latin1")));
        let removed = 0, added = 0;
        for (const [l, n] of b) removed += Math.max(0, n - (a.get(l) || 0));
        for (const [l, n] of a) added += Math.max(0, n - (b.get(l) || 0));
        objects[rel.split("/")[0]] = { removedOrChanged: removed, added };
      }
    }
  }
  for (const rel of then.keys()) if (!now.has(rel)) changed.push({ file: rel, change: "chýba" });
  return { id, changed, objects };
}

function restoreSnapshot(mapDir, id) {
  const snap = path.join(mapDir, DIR, id);
  if (!fs.existsSync(snap)) throw new Error("snímka neexistuje: " + id);
  const safety = saveSnapshot(mapDir, "pred_obnovou_" + id.slice(0, 15));
  const ts = textureSetFile(mapDir);
  let files = 0;
  const walk = (dir, rel) => {
    for (const n of fs.readdirSync(dir)) {
      const p = path.join(dir, n), r = rel ? `${rel}/${n}` : n;
      if (fs.statSync(p).isDirectory()) { walk(p, r); continue; }
      if (r === "meta.json") continue;
      const dest = r === "@textureset" ? ts : path.join(mapDir, ...r.split("/"));
      if (!dest) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(p, dest);
      files++;
    }
  };
  walk(snap, "");
  return { restored: id, files, safety: safety.id };
}

module.exports = { saveSnapshot, listSnapshots, diffSnapshot, restoreSnapshot };
