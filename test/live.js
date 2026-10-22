// Live-map flow on a scratch editor root: import a client map from its pack ZIP, no difference right after import,
// an edit (one object, one texture cell, a new texture) shows up in the diff and in the staged ZIPs - and nothing else.
// The client is never touched (staging goes to a temp folder). Run: node test/live.js
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert");
const L = require("../mapgen/live-map");
const { readZip } = require("../mapgen/zipfile");
const { parseAreaData, formatAreaData, parseTextureSet, formatTextureSet } = require("../maplib");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mapstudio-live-"));
try {
  const r = L.importLiveMap("metin2_map_a1", { editorRoot: root });
  assert.ok(!r.existed && r.files > 100, "imported " + r.files);
  assert.strictEqual(L.diffLiveMap(r.copy).changes.length, 0, "fresh copy equals the game");
  assert.ok(L.importLiveMap("metin2_map_a1", { editorRoot: root }).existed, "second import opens the copy");

  const t = path.join(r.copy, "002002");
  const ad = path.join(t, "areadata.txt"), objs = parseAreaData(fs.readFileSync(ad, "latin1"), "002002");
  objs.push({ ...objs[0], x: objs[0].x + 300, yaw: 90, extra: undefined });
  fs.writeFileSync(ad, formatAreaData(objs), "latin1");
  const tile = fs.readFileSync(path.join(t, "tile.raw")); tile[1000] = tile[1000] === 1 ? 2 : 1; fs.writeFileSync(path.join(t, "tile.raw"), tile);
  const tsText = fs.readFileSync(r.marker.textureSet.copy, "latin1"), ts = parseTextureSet(tsText);
  ts.push({ index: ts.length + 1, file: "d:/ymir work/terrainmaps/b/test/test.dds", uScale: 4, vScale: 4 });
  fs.writeFileSync(r.marker.textureSet.copy, formatTextureSet(ts), "latin1");

  const d = L.diffLiveMap(r.copy);
  assert.deepStrictEqual(d.changes.map((c) => c.textureSet ? "textureset" : `${c.terrain}/${c.file}`).sort(), ["002002/areadata.txt", "002002/tile.raw", "textureset"]);
  const o = d.objects["002002"];
  assert.ok(o.kept === o.before && o.added === 1 && o.removedOrChanged === 0, JSON.stringify(o));
  assert.ok(d.notes.some((n) => /minimapa/.test(n)), "stale minimap noted");

  const s = L.stageLiveUpdate(r.copy, path.join(root, "stage"));
  const live = readZip(r.marker.binZip), staged = readZip(path.join(root, "stage", "bin", path.basename(r.marker.binZip)));
  assert.strictEqual(staged.length, live.length, "same members");
  const changed = live.filter((e, i) => staged[i].name !== e.name || !staged[i].data.equals(e.data)).map((e) => e.name);
  assert.deepStrictEqual(changed.sort(), ["metin2_map_a1/002002/areadata.txt", "metin2_map_a1/002002/tile.raw"]);
  const tsTargets = s.targets.filter((x) => /textureset/i.test(x.live));
  assert.ok(tsTargets.length >= 1, "texture set staged");
  const deploy = fs.readFileSync(s.deploy, "utf8");
  assert.ok(deploy.indexOf("cp -p") < deploy.indexOf('cp "'), "deploy.sh backs up before copying");
  console.log(`ok: live map import, diff and staging (${s.targets.length} targets: ${s.targets.map((x) => path.basename(x.live)).join(", ")})`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
