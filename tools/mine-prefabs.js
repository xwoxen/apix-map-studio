// Mines object compositions from finished maps and saves them as Map Studio prefabs (%APPDATA%\APIX Map Studio\prefabs),
// so new maps reuse arrangements made by map designers instead of guessed ones:
//   set   - a building / monument / light / wall with the small props and rocks around it (within 14 m, chained 8 m)
//   rocks - 3+ rocks within 8 m of each other
//   grove - 3+ trees within 12 m with the plants and rocks under them
// Only objects usable in game (asset catalog) are kept; heights are stored as lift above the source ground.
// usage: node tools/mine-prefabs.js <name>=<map dir> [...] [--per 12] [--dry]
const fs = require("fs"), path = require("path");
const { loadMap } = require("../mapread");
const { getCatalog } = require("../catalog");

const args = process.argv.slice(2), per = Number((args.find((a) => a.startsWith("--per=")) || "--per=12").slice(6)), dry = args.includes("--dry");
const specs = args.filter((a) => a.includes("=") && !a.startsWith("--"));
const cat = getCatalog();
if (!cat) throw new Error("catalog missing: node tools/build-catalog.js");
const PREFABS = path.join(process.env.APPDATA, "APIX Map Studio", "prefabs");
const kind = (e) => (e.type === "Tree" ? (e.category === "plant" || (e.size && e.size[2] < 6) ? "plant" : "tree") : e.category);
const summary = [];

for (const spec of specs) {
  const [label, dir] = spec.split("=");
  const m = loadMap(dir);
  const objs = m.objects.map((o, i) => ({ ...o, i, e: cat.items[o.crc] })).filter((o) => o.e && (o.e.usable || o.e.usableAfterPacking) && o.e.type !== "Effect" || (o.e && o.e.type === "Effect"));
  const usable = objs.filter((o) => o.e && (o.e.usable || o.e.type === "Effect"));
  const G = 8, grid = new Map(), key = (x, y) => `${Math.floor(x / G)},${Math.floor(y / G)}`;
  for (const o of usable) { const k = key(o.x, o.y); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(o); }
  const near = (o, r) => { const out = []; const n = Math.ceil(r / G); for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) for (const p of grid.get(`${Math.floor(o.x / G) + dx},${Math.floor(o.y / G) + dy}`) || []) if (p !== o && Math.hypot(p.x - o.x, p.y - o.y) <= r) out.push(p); return out; };
  const taken = new Set(), found = [];
  const grow = (seed, accept, link, maxR) => {
    const group = [seed], seen = new Set([seed.i]);
    for (let q = 0; q < group.length; q++) for (const p of near(group[q], link)) {
      if (seen.has(p.i) || taken.has(p.i) || !accept(p) || Math.hypot(p.x - seed.x, p.y - seed.y) > maxR) continue;
      seen.add(p.i); group.push(p);
    }
    return group;
  };
  const isAnchor = (o) => ["building", "monument", "light", "wall", "bridge"].includes(o.e.category) && o.e.type !== "Tree" && o.e.size && Math.max(o.e.size[0], o.e.size[1]) >= 1.5 && Math.max(o.e.size[0], o.e.size[1]) <= 30;
  const small = (o) => o.e.type !== "Tree" ? (o.e.size ? Math.max(o.e.size[0], o.e.size[1]) <= 12 : true) : kind(o.e) === "plant";
  for (const a of usable.filter(isAnchor).sort((x, y) => (y.e.size[0] * y.e.size[1]) - (x.e.size[0] * x.e.size[1]))) {
    if (taken.has(a.i)) continue;
    const g = grow(a, (p) => p.e.type === "Effect" || small(p) || isAnchor(p), 8, 14);
    if (g.length >= 3 && new Set(g.map((p) => p.crc)).size >= 2) { g.forEach((p) => taken.add(p.i)); found.push({ type: "set", g }); }
  }
  for (const a of usable.filter((o) => o.e.category === "rock")) {
    if (taken.has(a.i)) continue;
    const g = grow(a, (p) => p.e.category === "rock" || kind(p.e) === "plant" || p.e.type === "Effect", 8, 14);
    if (g.filter((p) => p.e.category === "rock").length >= 3) { g.forEach((p) => taken.add(p.i)); found.push({ type: "rocks", g }); }
  }
  for (const a of usable.filter((o) => kind(o.e) === "tree")) {
    if (taken.has(a.i)) continue;
    const g = grow(a, (p) => kind(p.e) === "tree" || kind(p.e) === "plant" || p.e.category === "rock" || p.e.type === "Effect", 12, 22);
    if (g.filter((p) => kind(p.e) === "tree").length >= 3) { g.forEach((p) => taken.add(p.i)); found.push({ type: "grove", g }); }
  }
  const score = (f) => new Set(f.g.map((p) => p.crc)).size * 2 + Math.min(f.g.length, 20);
  const byType = { set: [], rocks: [], grove: [] };
  for (const f of found.sort((a, b) => score(b) - score(a))) byType[f.type].push(f);
  const written = [];
  for (const [type, list] of Object.entries(byType)) list.slice(0, type === "set" ? per : Math.ceil(per / 2)).forEach((f, n) => {
    const cx = f.g.reduce((s, p) => s + p.x, 0) / f.g.length, cy = f.g.reduce((s, p) => s + p.y, 0) / f.g.length;
    const items = f.g.map((p) => ({ crc: p.crc, dx: +(p.x - cx).toFixed(3), dz: +(p.y - cy).toFixed(3), lift: +(p.z - m.at(p.x, p.y)).toFixed(3), yaw: p.yaw }));
    const radius = Math.max(...f.g.map((p) => Math.hypot(p.x - cx, p.y - cy) + (p.e.size ? Math.max(p.e.size[0], p.e.size[1]) / 2 : 1)));
    const name = `src_${label}_${type}_${String(n + 1).padStart(2, "0")}`;
    const kinds = [...new Set(f.g.map((p) => p.e.name))];
    if (!dry) { fs.mkdirSync(PREFABS, { recursive: true }); fs.writeFileSync(path.join(PREFABS, name + ".json"), JSON.stringify({ name, created: new Date().toISOString(), source: { map: m.name, x: +cx.toFixed(1), y: +cy.toFixed(1) }, radius: +radius.toFixed(1), kinds, items }, null, 1)); }
    written.push({ name, objects: items.length, radius: +radius.toFixed(1), at: [Math.round(cx), Math.round(cy)], kinds: kinds.slice(0, 6) });
  });
  summary.push({ map: label, objects: m.objects.length, usable: usable.length, found: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.length])), written });
}
fs.writeFileSync(path.join(process.env.APPDATA, "APIX Map Studio", "prefabs-mined.json"), JSON.stringify(summary, null, 1));
for (const s of summary) {
  console.log(`${s.map}: ${s.objects} objects (${s.usable} usable) -> sets ${s.found.set}, rocks ${s.found.rocks}, groves ${s.found.grove}`);
  for (const w of s.written) console.log(`  ${w.name} ${w.objects} obj r ${w.radius} m @${w.at} ${w.kinds.join(", ")}`);
}
