// Editing a map that is live in the game, safely:
//   importLiveMap   copies a client map (from its pack ZIP, the file the game reads) into a WorldEditor working copy
//                   <editor>/<map>_live with its own copy of the texture set, and records where it came from
//                   (.live-source.json: pack ZIPs in bin and dist, member prefix, SHA-256 of the ZIPs at import)
//   diffLiveMap     what a save changed against the game: changed files, original objects kept / changed / removed,
//                   objects added, texture set changes, and whether the game files changed since the import
//   stageLiveUpdate the new pack ZIPs (bin + dist; plus textureset.zip if the texture set changed) and loose files,
//                   a report and deploy.sh that backs everything up (with ROLLBACK.md) before copying
// Nothing here touches the client; deploy.sh is run by hand (client closed) after the update was approved.
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { APIX_ROOT, PACK_ROOT, EDITOR_ROOT } = require("../assets");
const { readZip, writeZip } = require("./zipfile");
const { ROTATION_MARKER, ROTATION_NOTE } = require("../maplib");

const DIST_PACK = path.join(APIX_ROOT, "apix-client", "dist", "pack");
const MARKER = ".live-source.json";
// files of a terrain folder the client reads (GameLib/AreaLoaderThread, Area.cpp); minimap / shadow change only by Export
const TERRAIN_FILES = ["areadata.txt", "areaambiencedata.txt", "areaproperty.txt", "attr.atr", "height.raw", "tile.raw", "water.wtr", "minimap.dds", "shadowmap.dds", "shadowmap.raw"];
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const findCi = (dir, name) => { try { const n = fs.readdirSync(dir).find((f) => f.toLowerCase() === name.toLowerCase()); return n ? path.join(dir, n) : null; } catch { return null; } };
const OBJ = /Start Object\d+\s([\s\S]*?)End Object/g;
const objectLines = (text) => [...text.matchAll(OBJ)].map((m) => m[1].trim().split(/\s+/).join(" "));

// client map folder -> its pack: bin/pack/<Pack>/<rel>/<map>  ->  <Pack>.zip with members "<rel>/<map>/..."
function packOf(mapDir) {
  const rel = path.relative(PACK_ROOT, mapDir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("mapa nie je z packu klienta: " + mapDir);
  const [pack, ...rest] = rel.split(path.sep);
  const binZip = findCi(PACK_ROOT, pack + ".zip");
  if (!binZip) throw new Error(`pack ${pack}.zip v bin/pack neexistuje (hra číta mapu z ${pack}.zip)`);
  return { pack, binZip, distZip: findCi(DIST_PACK, pack + ".zip"), prefix: rest.join("/").toLowerCase() + "/" };
}

function liveMaps() {
  const { listSourceMaps } = require("../mapread");
  return listSourceMaps().filter((m) => m.source === "client").map((m) => { try { const p = packOf(m.dir); return { name: m.name, dir: m.dir, pack: p.pack, size: m.size }; } catch { return null; } }).filter(Boolean);
}

// texture set the client loads for a map: Setting.txt "TextureSet textureset\x.txt" -> textureset.zip member + loose copies
function clientTextureSet(setting) {
  const rel = ((setting.match(/TextureSet\s+(\S+)/) || [])[1] || "").replace(/\\/g, "/");
  const base = path.basename(rel).toLowerCase();
  const loose = [path.join(PACK_ROOT, "textureset", base), path.join(PACK_ROOT, "textureset", "textureset", base)].map((f) => findCi(path.dirname(f), path.basename(f))).filter(Boolean);
  return { rel, base, loose };
}

function importLiveMap(nameOrDir, { editorRoot = EDITOR_ROOT, copyName } = {}) {
  const src = fs.existsSync(nameOrDir) ? { dir: nameOrDir } : liveMaps().find((m) => m.name.toLowerCase() === String(nameOrDir).toLowerCase());
  if (!src) throw new Error("mapa v hre nenájdená: " + nameOrDir);
  const p = packOf(src.dir), name = path.basename(src.dir), copy = path.join(editorRoot, copyName || name + "_live");
  const zip = readZip(p.binZip);
  const members = zip.filter((e) => e.name.replace(/\\/g, "/").toLowerCase().startsWith(p.prefix) && !e.name.endsWith("/"));
  if (!members.length) throw new Error(`${p.pack}.zip neobsahuje ${p.prefix}`);
  const setting = members.find((e) => e.name.toLowerCase().endsWith("/setting.txt"));
  if (!setting) throw new Error("v ZIP chýba setting.txt");
  const ts = clientTextureSet(setting.data.toString("latin1"));
  const tsFile = ts.loose[0];
  if (!tsFile) throw new Error("sada textúr " + ts.base + " v klientovi nenájdená");
  const tsCopy = path.join(editorRoot, "textureset", path.basename(copy) + ".txt");
  const markerFile = path.join(copy, MARKER);
  const makeMarker = () => ({ map: name, pack: p.pack, prefix: p.prefix, binZip: p.binZip, distZip: p.distZip, textureSet: { client: tsFile, base: ts.base, copy: tsCopy },
    importedAt: new Date().toISOString(), zipSha256: { bin: sha(fs.readFileSync(p.binZip)), dist: p.distZip ? sha(fs.readFileSync(p.distZip)) : null } });
  if (fs.existsSync(copy)) {
    if (fs.existsSync(markerFile)) return { copy, existed: true, marker: JSON.parse(fs.readFileSync(markerFile, "utf8")) };
    // an older hand-made copy is adopted only if every client file in it is still byte-identical to the game
    const differs = members.filter((e) => { const rel = e.name.split("\\").join("/").slice(p.prefix.length); if (/^setting\.txt$/i.test(rel)) return false;
      const f = findCi(path.join(copy, ...rel.split("/").slice(0, -1)), rel.split("/").pop()); return !f || !fs.readFileSync(f).equals(e.data); });
    if (differs.length || !fs.existsSync(tsCopy) || !fs.readFileSync(tsCopy).equals(fs.readFileSync(tsFile)))
      throw new Error(`${copy} už existuje, nemá záznam o pôvode a líši sa od hry (${differs.length} súborov); premenuj ho alebo zvoľ iné meno (copyName)`);
    const marker = makeMarker();
    fs.writeFileSync(path.join(copy, ROTATION_MARKER), ROTATION_NOTE);
    fs.writeFileSync(markerFile, JSON.stringify(marker, null, 1));
    return { copy, existed: true, adopted: true, marker };
  }
  for (const e of members) {
    const rel = e.name.replace(/\\/g, "/").slice(p.prefix.length);
    const out = path.join(copy, ...rel.split("/"));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, e.data);
  }
  // the copy reads its own texture set, so painting never changes the game's set by accident
  fs.mkdirSync(path.dirname(tsCopy), { recursive: true });
  fs.copyFileSync(tsFile, tsCopy);
  const settingFile = findCi(copy, "setting.txt");
  fs.writeFileSync(settingFile, fs.readFileSync(settingFile, "latin1").replace(/TextureSet\s+\S+/, `TextureSet\ttextureset/${path.basename(tsCopy)}`), "latin1");
  fs.writeFileSync(path.join(copy, ROTATION_MARKER), ROTATION_NOTE);                  // client files: client rotation order
  const marker = makeMarker();
  fs.writeFileSync(markerFile, JSON.stringify(marker, null, 1));
  return { copy, existed: false, marker, files: members.length };
}

function readMarker(copy) {
  const f = path.join(copy, MARKER);
  if (!fs.existsSync(f)) throw new Error("toto nie je pracovná kópia mapy z hry (chýba " + MARKER + ")");
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

// zip member name for a copy file: the existing member (any case), else the lower-case client style
function diffLiveMap(copy) {
  const mk = readMarker(copy);
  const zip = readZip(mk.binZip);
  const byName = new Map(zip.map((e) => [e.name.replace(/\\/g, "/").toLowerCase(), e]));
  const out = { map: mk.map, copy, changes: [], objects: {}, problems: [], notes: [] };
  if (sha(fs.readFileSync(mk.binZip)) !== mk.zipSha256.bin) out.problems.push(`${mk.pack}.zip v hre sa zmenil od importu kópie (${mk.importedAt}); zmeny by prepísali novší stav – urob nový import`);
  if (mk.distZip && fs.existsSync(mk.distZip) && sha(fs.readFileSync(mk.distZip)) !== mk.zipSha256.dist) out.problems.push(`dist ${mk.pack}.zip sa zmenil od importu kópie`);
  for (const t of fs.readdirSync(copy).filter((n) => /^\d{6}$/.test(n)).sort()) {
    for (const f of TERRAIN_FILES) {
      const file = findCi(path.join(copy, t), f);
      if (!file) continue;
      const member = `${mk.prefix}${t}/${f}`, live = byName.get(member);
      const data = fs.readFileSync(file);
      if (live && live.data.equals(data)) continue;
      if (!data.length) { out.problems.push(`${t}/${f} je prázdny – klient prázdne súbory v ZIP preskakuje`); continue; }
      out.changes.push({ terrain: t, file: f, member, isNew: !live, bytes: data.length });
      if (f === "areadata.txt") {
        const before = objectLines(live ? live.data.toString("latin1") : ""), after = objectLines(data.toString("latin1"));
        const count = (a) => a.reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
        const b = count(before), a = count(after);
        let kept = 0, removed = 0, added = 0;
        for (const [l, n] of b) { const k = Math.min(n, a.get(l) || 0); kept += k; removed += n - k; }
        for (const [l, n] of a) added += Math.max(0, n - (b.get(l) || 0));
        out.objects[t] = { before: before.length, after: after.length, kept, removedOrChanged: removed, added };
        if (removed) out.notes.push(`${t}: ${removed} pôvodných objektov je zmenených alebo zmazaných – over, či je to zámer`);
      }
    }
    const here = out.changes.filter((c) => c.terrain === t).map((c) => c.file);
    if (here.some((f) => ["height.raw", "tile.raw", "water.wtr"].includes(f)) && !here.includes("minimap.dds"))
      out.notes.push(`${t}: zmenený terén alebo textúry – minimapa tohto terénu ostane stará, kým ju nevyexportuješ (Export v Map Studiu)`);
  }
  const tsNow = fs.readFileSync(mk.textureSet.copy), tsLive = fs.readFileSync(mk.textureSet.client);
  if (!tsNow.equals(tsLive)) out.changes.push({ terrain: "-", file: "textureset", member: mk.textureSet.base, textureSet: true, bytes: tsNow.length });
  const attrChanged = out.changes.some((c) => c.file === "attr.atr");
  if (attrChanged) out.notes.push("zmenené attr.atr: serverové server_attr tejto mapy sa NEaktualizuje – blokované / vodné plochy na serveri ostanú staré");
  out.notes = [...new Set(out.notes)];
  return out;
}

function stageLiveUpdate(copy, outDir) {
  const mk = readMarker(copy), diff = diffLiveMap(copy);
  if (diff.problems.length) throw new Error("update nejde pripraviť:\n- " + diff.problems.join("\n- "));
  if (!diff.changes.length) throw new Error("kópia sa od hry nelíši, nie je čo nasadiť");
  fs.mkdirSync(outDir, { recursive: true });
  const repl = new Map(diff.changes.filter((c) => !c.textureSet).map((c) => [c.member, fs.readFileSync(findCi(path.join(copy, c.terrain), c.file))]));
  const targets = [];                                                     // { live, staged, kind }
  const rebuild = (zipFile, label, replace) => {
    const entries = readZip(zipFile);
    let n = 0;
    for (const e of entries) { const d = replace(e); if (d) { e.data = d; n++; } }
    const staged = path.join(outDir, label);
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    writeZip(staged, entries);
    targets.push({ live: zipFile, staged, members: n });
    return n;
  };
  const mapReplace = (e) => repl.get(e.name.replace(/\\/g, "/").toLowerCase());
  const added = [...repl.keys()].filter((m) => diff.changes.find((c) => c.member === m).isNew);
  const addNew = (zipFile, label) => {
    rebuild(zipFile, label, mapReplace);
    if (added.length) {                                                   // new member files (e.g. a terrain file the map lacked)
      const staged = path.join(outDir, label), entries = readZip(staged);
      const tpl = entries.find((e) => !e.name.endsWith("/")) || { method: 8, time: 0, date: 0, extAttr: 0 };
      for (const m of added) entries.push({ ...tpl, name: m, data: repl.get(m) });
      writeZip(staged, entries);
    }
  };
  addNew(mk.binZip, `bin/${path.basename(mk.binZip)}`);
  if (mk.distZip) addNew(mk.distZip, `dist/${path.basename(mk.distZip)}`);
  // loose bin folder (the client checks loose files first): <bin/pack>/<Pack>/<prefix><terrain>/<file>
  for (const [member, data] of repl) {
    const live = path.join(PACK_ROOT, mk.pack, ...member.split("/"));
    if (!fs.existsSync(path.dirname(live))) continue;
    const staged = path.join(outDir, "loose", ...member.split("/"));
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    fs.writeFileSync(staged, data);
    targets.push({ live: findCi(path.dirname(live), path.basename(live)) || live, staged, members: 1 });
  }
  // texture set: every copy in textureset.zip (bin, dist) and loose that still holds the original text
  const ts = diff.changes.find((c) => c.textureSet);
  if (ts) {
    const original = fs.readFileSync(mk.textureSet.client), next = fs.readFileSync(mk.textureSet.copy);
    for (const [root, label] of [[PACK_ROOT, "bin"], [DIST_PACK, "dist"]]) {
      const z = findCi(root, "textureset.zip");
      if (z) rebuild(z, `${label}/${path.basename(z)}`, (e) => (path.basename(e.name).toLowerCase() === mk.textureSet.base && e.data.equals(original) ? next : null));
    }
    for (const f of [path.join(PACK_ROOT, "textureset", mk.textureSet.base), path.join(PACK_ROOT, "textureset", "textureset", mk.textureSet.base)]) {
      const live = findCi(path.dirname(f), path.basename(f));
      if (live && fs.readFileSync(live).equals(original)) {
        const staged = path.join(outDir, "loose_textureset", path.relative(PACK_ROOT, live));
        fs.mkdirSync(path.dirname(staged), { recursive: true });
        fs.writeFileSync(staged, next);
        targets.push({ live, staged, members: 1 });
      }
    }
  }
  const rel = (f) => path.relative(APIX_ROOT, f).split(path.sep).join("/");
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const backup = `_codex_backups/${mk.map}_update_${stamp}`;
  const lines = ["#!/bin/bash", `# Update of ${mk.map} prepared by Map Studio ${new Date().toISOString()}. Run from anywhere with the client CLOSED.`,
    "set -e", `cd "${APIX_ROOT.replace(/\\/g, "/")}"`, `B="${backup}"`, 'mkdir -p "$B"'];
  targets.forEach((t, i) => lines.push(`cp -p "${rel(t.live)}" "$B/${i}_${path.basename(t.live)}"`));
  lines.push('sha256sum "$B"/* > "$B/SHA256SUMS"', 'cat > "$B/ROLLBACK.md" <<RB', `# Rollback: ${mk.map} update`, "Close the client, then from the APIX folder:", "");
  targets.forEach((t, i) => lines.push(`    cp -p "$B/${i}_${path.basename(t.live)}" "${rel(t.live)}"`));
  lines.push("RB");
  targets.forEach((t) => lines.push(`cp "${t.staged.split(path.sep).join("/")}" "${rel(t.live)}"`));
  lines.push(`echo "deployed ${mk.map}; backup $B"`);
  fs.writeFileSync(path.join(outDir, "deploy.sh"), lines.join("\n") + "\n");
  const report = ["# Update " + mk.map, "", `Kópia: ${copy}`, `Pripravené: ${new Date().toISOString()}`, "", "## Zmenené súbory",
    ...diff.changes.map((c) => `- ${c.textureSet ? "sada textúr " + c.member : c.terrain + "/" + c.file}${c.isNew ? " (nový)" : ""}`), "", "## Objekty",
    ...Object.entries(diff.objects).map(([t, o]) => `- ${t}: pôvodných ${o.before}, zachovaných presne ${o.kept}, zmenených/zmazaných ${o.removedOrChanged}, pridaných ${o.added}`),
    "", "## Poznámky", ...(diff.notes.length ? diff.notes.map((n) => "- " + n) : ["- žiadne"]), "", "## Súbory v hre, ktoré deploy.sh prepíše (najprv ich zálohuje)",
    ...targets.map((t) => `- ${rel(t.live)}`), "", "Nasadenie: zavri klienta a spusti `bash deploy.sh`. Vrátenie: ROLLBACK.md v zálohe."];
  fs.writeFileSync(path.join(outDir, "report.md"), report.join("\n") + "\n");
  return { outDir, diff, targets: targets.map((t) => ({ live: rel(t.live), staged: t.staged })), deploy: path.join(outDir, "deploy.sh"), report: path.join(outDir, "report.md") };
}

module.exports = { liveMaps, importLiveMap, diffLiveMap, stageLiveUpdate, readMarker, MARKER };
