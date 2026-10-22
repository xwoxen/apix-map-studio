// Copies a map to a scratch folder, runs a second Map Studio on the copy with an --eval script and saves the result:
// <out>/result.json, and every data:image/png value under result.shots as <out>/<name>.png.
// usage: node test/run-eval.js <map dir> <eval script> <out dir>
const fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const [mapDir, script, outDir] = process.argv.slice(2);
const copy = path.join(os.tmpdir(), "mapstudio-eval-" + path.basename(mapDir));
fs.rmSync(copy, { recursive: true, force: true });
fs.cpSync(mapDir, copy, { recursive: true, filter: (p) => !/_studio_backup|[\\/]_export([\\/]|$)/.test(p) });
const app = path.join(__dirname, "..");
const out = execFileSync("cmd.exe", ["/c", path.join(app, "node_modules", ".bin", "electron.cmd"), ".", "--open", copy, "--eval", path.resolve(script), "--screenshot", path.join(copy, "window.png")],
  { cwd: app, encoding: "utf8", timeout: 900000, maxBuffer: 1 << 30 });
const line = out.split(/\r?\n/).find((l) => l.startsWith("[eval]"));
if (!line) { console.log(out.slice(-3000)); process.exit(1); }
const res = JSON.parse(line.replace(/^\[eval\]\s*/, ""));
fs.mkdirSync(outDir, { recursive: true });
for (const [name, data] of Object.entries(res.shots || {})) {
  const b64 = String(data).replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync(path.join(outDir, name + ".png"), Buffer.from(b64, "base64"));
  res.shots[name] = path.join(outDir, name + ".png");
}
fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
