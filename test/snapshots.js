// snapshots on a scratch copy of an editor map: save, diff after an edit, restore (with safety snapshot), diff empty.
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert");
const S = require("../mapgen/snapshots");
const src = "C:/Users/micha/Documents/we_remix_v59__20260716-1745/apix_dungeon_01";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "mapstudio-snap-"));
try {
  const d = path.join(root, "apix_dungeon_01");
  fs.cpSync(src, d, { recursive: true, filter: (p) => !/_studio_backup|_studio_snapshots|[\/]_export/.test(p) });
  fs.mkdirSync(path.join(root, "textureset")); fs.copyFileSync(path.join(path.dirname(src), "textureset", "apix_dungeon_01.txt"), path.join(root, "textureset", "apix_dungeon_01.txt"));
  const a = S.saveSnapshot(d, "zaklad");
  const f = path.join(d, "000000", "AreaData.txt");
  fs.writeFileSync(f, fs.readFileSync(f, "latin1").replace(/Start Object000[\s\S]*?End Object\r?\n/, ""), "latin1");
  fs.appendFileSync(path.join(root, "textureset", "apix_dungeon_01.txt"), "\r\n");
  const diff = S.diffSnapshot(d, a.id);
  assert.deepStrictEqual(diff.changed.map((c) => c.file).sort(), ["000000/AreaData.txt", "@textureset"]);
  assert.strictEqual(diff.objects["000000"].removedOrChanged, 1);
  const r = S.restoreSnapshot(d, a.id);
  assert.strictEqual(S.diffSnapshot(d, a.id).changed.length, 0, "restored");
  assert.ok(S.listSnapshots(d).some((s) => s.id === r.safety), "safety snapshot kept");
  console.log(`ok: snapshots save / diff / restore (${a.files} files)`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
