// Map analysis: object density, spacing and clustering, kinds, terrain relief and texture use, measured on the playable
// (non-blocked) area. Compares official maps with our own. Uses the asset catalog for categories and sizes.
//
// usage: node tools/analyze-maps.js <out_dir> <name>=<map dir> [...]
//   map dir = folder with setting.txt and the terrain folders (client pack or WorldEditor map)
// writes <out_dir>/analysis.json and <out_dir>/analysis.md
const fs = require("fs"), path = require("path");
const { parseAreaData, parseTextureSet, decodeAttr, decodeWater } = require("../maplib");
const { getCatalog } = require("../catalog");
const { PACK_ROOT } = require("../assets");
const EDITOR_ROOT = "C:/Users/micha/Documents/we_remix_v59__20260716-1745";

const [outDir, ...specs] = process.argv.slice(2);
const cat = getCatalog();
if (!cat) throw new Error("catalog missing: node tools/build-catalog.js");
const ci = (name) => fs.readdirSync(name.dir).find((f) => f.toLowerCase() === name.file.toLowerCase());
const readCi = (dir, file) => { const f = ci({ dir, file }); return f ? fs.readFileSync(path.join(dir, f)) : null; };

function loadMap(dir) {
  const setting = readCi(dir, "setting.txt").toString("latin1");
  const [, sx, sy] = setting.match(/MapSize\s+(\d+)\s+(\d+)/);
  const tsRel = (setting.match(/TextureSet\s+(\S+)/) || [])[1] || "";
  const tsName = path.basename(tsRel.replace(/\\/g, "/"));
  const tsFile = [path.join(PACK_ROOT, "textureset", tsName), path.join(PACK_ROOT, "textureset", "textureset", tsName), path.join(EDITOR_ROOT, "textureset", tsName)].find((f) => fs.existsSync(f));
  const textures = tsFile ? parseTextureSet(fs.readFileSync(tsFile, "latin1")) : [];
  const W = +sx, H = +sy, objects = [];
  const cellsW = W * 128, cellsH = H * 128;
  const height = new Float32Array((cellsW + 1) * (cellsH + 1));      // 2 m cells, metres
  const tile = new Uint8Array(cellsW * 2 * cellsH * 2);                // 1 m half cells, texture index
  const attr = new Uint8Array(cellsW * 2 * cellsH * 2);
  const water = new Uint8Array(cellsW * cellsH);
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
    const key = String(tx).padStart(3, "0") + String(ty).padStart(3, "0");
    const td = path.join(dir, fs.readdirSync(dir).find((f) => f.toLowerCase() === key) || key);
    if (!fs.existsSync(td)) continue;
    const ad = readCi(td, "areadata.txt");
    if (ad) objects.push(...parseAreaData(ad.toString("latin1"), key));
    const hr = readCi(td, "height.raw");
    if (hr) for (let j = 0; j <= 128; j++) for (let i = 0; i <= 128; i++) {
      const gx = tx * 128 + i, gy = ty * 128 + j;
      if (gx <= cellsW && gy <= cellsH) height[gy * (cellsW + 1) + gx] = hr.readUInt16LE(((j + 1) * 131 + (i + 1)) * 2) / 200;
    }
    const tr = readCi(td, "tile.raw");
    if (tr) for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) tile[(ty * 256 + r) * cellsW * 2 + tx * 256 + c] = tr[(r + 1) * 258 + (c + 1)];
    const at = readCi(td, "attr.atr");
    if (at) { const a = decodeAttr(at); for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) attr[(ty * 256 + r) * cellsW * 2 + tx * 256 + c] = a[r * 256 + c]; }
    const wt = readCi(td, "water.wtr");
    if (wt) { const w = decodeWater(wt); for (let r = 0; r < 128; r++) for (let c = 0; c < 128; c++) if (w.idx[r * 128 + c] !== 255) water[(ty * 128 + r) * cellsW + tx * 128 + c] = 1; }
  }
  return { W, H, cellsW, cellsH, objects, height, tile, attr, water, textures };
}

const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);

function analyse(name, dir) {
  const m = loadMap(dir);
  const mW = m.cellsW * 2, mH = m.cellsH * 2;                         // metres
  const hAt = (x, y) => { const cx = Math.min(m.cellsW - 1, Math.max(0, Math.floor(x / 2))), cy = Math.min(m.cellsH - 1, Math.max(0, Math.floor(y / 2))); return m.height[cy * (m.cellsW + 1) + cx]; };
  const slopeAt = (cx, cy) => {                                       // degrees on a 2 m cell
    const i = cy * (m.cellsW + 1) + cx, dx = m.height[i + 1] - m.height[i], dy = m.height[i + m.cellsW + 1] - m.height[i];
    return Math.atan(Math.hypot(dx, dy) / 2) * 180 / Math.PI;
  };
  const open = (x, y) => !(m.attr[Math.floor(y) * mW + Math.floor(x)] & 1);
  // playable area: unblocked metres
  let openM2 = 0; for (let i = 0; i < m.attr.length; i++) if (!(m.attr[i] & 1)) openM2++;
  const ha = openM2 / 10000;
  // objects with catalog info, in map metres (AreaData x cm, y negative cm)
  const objs = m.objects.map((o) => { const e = cat.items[o.crc >>> 0]; return { x: o.x / 100, y: -o.y / 100, crc: o.crc >>> 0, e, cat: e ? e.category : "unknown", type: e ? e.type : "unknown" }; })
    .filter((o) => o.x >= 0 && o.y >= 0 && o.x < mW && o.y < mH);
  const inPlay = objs.filter((o) => open(o.x, o.y));
  const byCat = {}; for (const o of objs) byCat[o.cat] = (byCat[o.cat] || 0) + 1;
  const trees = objs.filter((o) => o.type === "Tree");
  const treesPlay = trees.filter((o) => open(o.x, o.y));
  // spacing between trees (all trees, so the rim counts) via a grid hash
  const grid = new Map(), G = 10, key = (x, y) => `${Math.floor(x / G)},${Math.floor(y / G)}`;
  for (const t of trees) { const k = key(t.x, t.y); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t); }
  const near = (t, r) => { const out = []; for (let dy = -Math.ceil(r / G); dy <= Math.ceil(r / G); dy++) for (let dx = -Math.ceil(r / G); dx <= Math.ceil(r / G); dx++) for (const u of grid.get(`${Math.floor(t.x / G) + dx},${Math.floor(t.y / G) + dy}`) || []) if (u !== t) { const d = Math.hypot(u.x - t.x, u.y - t.y); if (d <= r) out.push(d); } return out; };
  const nn = trees.map((t) => { const d = near(t, 40); return d.length ? Math.min(...d) : 40; });
  const treeDensity = trees.length / (mW * mH);
  const clarkEvans = trees.length > 2 ? (nn.reduce((a, b) => a + b, 0) / nn.length) / (0.5 / Math.sqrt(treeDensity)) : null;
  const clustered = trees.length ? trees.filter((t) => near(t, 8).length >= 3).length / trees.length : null;
  // props near buildings: small props within 12 m of a building (composition), and lone props
  const buildings = objs.filter((o) => o.cat === "building" || o.cat === "monument" || o.cat === "wall");
  const props = objs.filter((o) => ["prop", "light", "plant", "rock"].includes(o.cat));
  const propsNearBuilding = props.length ? props.filter((p) => buildings.some((b) => Math.hypot(b.x - p.x, b.y - p.y) < 12)).length / props.length : null;
  // openness: share of playable 10 x 10 m blocks with no object at all
  let blocks = 0, empty = 0;
  const occ = new Set(objs.map((o) => key(o.x, o.y)));
  for (let by = 0; by < mH; by += 10) for (let bx = 0; bx < mW; bx += 10) { if (!open(bx + 5, by + 5)) continue; blocks++; if (!occ.has(key(bx, by))) empty++; }
  // terrain on playable cells
  const slopes = [], heights = [];
  for (let cy = 0; cy < m.cellsH; cy++) for (let cx = 0; cx < m.cellsW; cx++) { if (!open(cx * 2 + 1, cy * 2 + 1)) continue; slopes.push(slopeAt(cx, cy)); heights.push(m.height[cy * (m.cellsW + 1) + cx]); }
  const meanH = heights.reduce((a, b) => a + b, 0) / (heights.length || 1);
  const stdH = Math.sqrt(heights.reduce((a, b) => a + (b - meanH) ** 2, 0) / (heights.length || 1));
  const share = (f) => slopes.filter(f).length / (slopes.length || 1);
  // textures on playable half cells: coverage and mean slope; textures per terrain
  const tex = {};
  for (let y = 0; y < mH; y++) for (let x = 0; x < mW; x++) {
    if (!open(x, y)) continue;
    const t = m.tile[y * mW + x], s = slopeAt(Math.min(m.cellsW - 1, x >> 1), Math.min(m.cellsH - 1, y >> 1));
    const e = (tex[t] ||= { n: 0, slope: 0 }); e.n++; e.slope += s;
  }
  const texList = Object.entries(tex).map(([i, e]) => ({ index: +i, file: (m.textures[+i - 1] || {}).file || "?", share: e.n / (openM2 || 1), meanSlope: e.slope / e.n })).sort((a, b) => b.share - a.share);
  const perTerrain = [];
  for (let ty = 0; ty < m.H; ty++) for (let tx = 0; tx < m.W; tx++) { const s = new Set(); for (let y = ty * 256; y < ty * 256 + 256; y++) for (let x = tx * 256; x < tx * 256 + 256; x++) s.add(m.tile[y * mW + x]); perTerrain.push(s.size); }
  // top object kinds
  const kinds = {}; for (const o of objs) { const n = o.e ? o.e.name : `crc ${o.crc}`; kinds[n] = (kinds[n] || 0) + 1; }
  // water
  let wcells = 0; for (const w of m.water) wcells += w;
  return {
    name, dir, sizeTerrains: [m.W, m.H], sizeM: [mW, mH], playableHa: r1(ha), blockedShare: r1(100 * (1 - openM2 / (mW * mH))), waterShare: r1(100 * wcells / (m.cellsW * m.cellsH)),
    objects: objs.length, objectsPerHa: r1(inPlay.length / ha), byCategory: byCat, distinctKinds: Object.keys(kinds).length,
    trees: { total: trees.length, inPlayPerHa: r1(treesPlay.length / ha), nnMedian: r1(pct(nn, 0.5)), nnP10: r1(pct(nn, 0.1)), nnP90: r1(pct(nn, 0.9)), clarkEvans: r1(clarkEvans && clarkEvans * 100) / 100 || null, clusteredShare: r1(100 * clustered) },
    composition: { propsNearBuildingShare: r1(100 * propsNearBuilding), emptyBlocks10mShare: r1(100 * empty / (blocks || 1)) },
    terrain: { heightStd: r1(stdH), heightRange: [r1(pct(heights, 0.02)), r1(pct(heights, 0.98))], slopeMedian: r1(pct(slopes, 0.5)), slopeP90: r1(pct(slopes, 0.9)), flatShare: r1(100 * share((s) => s < 3)), gentleShare: r1(100 * share((s) => s >= 3 && s < 12)), steepShare: r1(100 * share((s) => s >= 25)) },
    textures: { used: texList.length, perTerrainMax: Math.max(...perTerrain), top: texList.slice(0, 8).map((t) => ({ file: t.file.replace(/^d:[\\/]ymir work[\\/]terrainmaps[\\/]/i, ""), share: r1(100 * t.share), meanSlope: r1(t.meanSlope) })) },
    topKinds: Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 15),
  };
}

const results = specs.map((s) => { const [name, dir] = s.split("="); process.stdout.write(`analysing ${name}...\n`); return analyse(name, dir); });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "analysis.json"), JSON.stringify(results, null, 1));
// markdown comparison table
const rows = [
  ["veľkosť (terény)", (r) => r.sizeTerrains.join("×")], ["hrateľná plocha (ha)", (r) => r.playableHa], ["blokované %", (r) => r.blockedShare], ["voda %", (r) => r.waterShare],
  ["objekty / ha (hrateľné)", (r) => r.objectsPerHa], ["druhov objektov", (r) => r.distinctKinds], ["stromy / ha (hrateľné)", (r) => r.trees.inPlayPerHa],
  ["strom → najbližší strom, medián (m)", (r) => r.trees.nnMedian], ["… 10. / 90. percentil (m)", (r) => `${r.trees.nnP10} / ${r.trees.nnP90}`],
  ["Clark-Evans R (<1 zhluky, 1 náhodne, >1 pravidelne)", (r) => r.trees.clarkEvans], ["stromy v zhluku (≥3 do 8 m) %", (r) => r.trees.clusteredShare],
  ["drobnosti pri budove (do 12 m) %", (r) => r.composition.propsNearBuildingShare], ["prázdne bloky 10×10 m %", (r) => r.composition.emptyBlocks10mShare],
  ["výška: smerodajná odchýlka (m)", (r) => r.terrain.heightStd], ["sklon medián / 90. perc. (°)", (r) => `${r.terrain.slopeMedian} / ${r.terrain.slopeP90}`],
  ["rovina <3° %", (r) => r.terrain.flatShare], ["mierny 3–12° %", (r) => r.terrain.gentleShare], ["strmý ≥25° %", (r) => r.terrain.steepShare],
  ["textúr spolu / max na terén", (r) => `${r.textures.used} / ${r.textures.perTerrainMax}`],
];
let md = `# Analýza máp\n\nHrateľná plocha = bunky bez atribútu block. Kategórie a veľkosti z katalógu assetov.\n\n| metrika | ${results.map((r) => r.name).join(" | ")} |\n|---|${results.map(() => "---").join("|")}|\n`;
for (const [label, f] of rows) md += `| ${label} | ${results.map((r) => f(r)).join(" | ")} |\n`;
for (const r of results) {
  md += `\n## ${r.name}\n\nKategórie: ${Object.entries(r.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}\n\n`;
  md += `Textúry (podiel hrateľnej plochy, priemerný sklon): ${r.textures.top.map((t) => `${t.file} ${t.share} % (${t.meanSlope}°)`).join("; ")}\n\n`;
  md += `Najčastejšie objekty: ${r.topKinds.map(([n, c]) => `${n} ${c}`).join(", ")}\n`;
}
fs.writeFileSync(path.join(outDir, "analysis.md"), md);
console.log(md.split("\n## ")[0]);
