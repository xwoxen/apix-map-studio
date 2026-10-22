// Read-only loader for whole maps (client pack folders or WorldEditor maps) and rectangular regions of them.
// Used by the map analysis tool, region import (Map Studio) and prefab mining. Plain Node.
const fs = require("fs"), path = require("path");
const { parseAreaData, parseTextureSet, decodeAttr, decodeWater } = require("./maplib");
const { PACK_ROOT, EDITOR_ROOT } = require("./assets");

const findCi = (dir, file) => { try { return fs.readdirSync(dir).find((f) => f.toLowerCase() === file.toLowerCase()) || null; } catch { return null; } };
const readCi = (dir, file) => { const f = findCi(dir, file); return f ? fs.readFileSync(path.join(dir, f)) : null; };

function textureSetFor(setting, dir) {
  const rel = (setting.match(/TextureSet\s+(\S+)/) || [])[1] || "";
  const name = path.basename(rel.replace(/\\/g, "/"));
  const cands = [path.join(PACK_ROOT, "textureset", name), path.join(PACK_ROOT, "textureset", "textureset", name), path.join(EDITOR_ROOT, "textureset", name), path.join(EDITOR_ROOT, rel)];
  const f = cands.find((c) => name && fs.existsSync(c));
  return f ? parseTextureSet(fs.readFileSync(f, "latin1")) : [];
}

// whole map: heights on 2 m nodes (metres), tile index and attr flags per 1 m, water level per 2 m cell (metres, NaN = none)
const cache = new Map();
function loadMap(dir) {
  const key = path.resolve(dir).toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const setting = readCi(dir, "setting.txt");
  if (!setting) throw new Error("setting.txt missing in " + dir);
  const text = setting.toString("latin1");
  const [, sx, sy] = text.match(/MapSize\s+(\d+)\s+(\d+)/);
  const W = +sx, H = +sy, cw = W * 128, ch = H * 128, mw = cw * 2, mh = ch * 2;
  const height = new Float32Array((cw + 1) * (ch + 1)), tile = new Uint8Array(mw * mh), attr = new Uint8Array(mw * mh), water = new Float32Array(cw * ch).fill(NaN);
  const objects = [];
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
    const k = String(tx).padStart(3, "0") + String(ty).padStart(3, "0"), sub = findCi(dir, k);
    if (!sub) continue;
    const td = path.join(dir, sub);
    const ad = readCi(td, "areadata.txt");
    if (ad) for (const o of parseAreaData(ad.toString("latin1"), k)) objects.push({ x: o.x / 100, y: -o.y / 100, z: o.z / 100, crc: o.crc >>> 0, yaw: o.yaw });
    const hr = readCi(td, "height.raw");
    if (hr) for (let j = 0; j <= 128; j++) for (let i = 0; i <= 128; i++) {
      const gx = tx * 128 + i, gy = ty * 128 + j;
      if (gx <= cw && gy <= ch) height[gy * (cw + 1) + gx] = hr.readUInt16LE(((j + 1) * 131 + (i + 1)) * 2) / 200;
    }
    const tr = readCi(td, "tile.raw");
    if (tr) for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) tile[(ty * 256 + r) * mw + tx * 256 + c] = tr[(r + 1) * 258 + (c + 1)];
    const at = readCi(td, "attr.atr");
    if (at) { const a = decodeAttr(at); for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) attr[(ty * 256 + r) * mw + tx * 256 + c] = a[r * 256 + c]; }
    const wt = readCi(td, "water.wtr");
    if (wt) { const w = decodeWater(wt); for (let r = 0; r < 128; r++) for (let c = 0; c < 128; c++) { const i = w.idx[r * 128 + c]; if (i !== 255 && w.levels[i] !== undefined) water[(ty * 128 + r) * cw + tx * 128 + c] = w.levels[i] / 200; } }
  }
  const m = { dir, name: path.basename(dir), W, H, cw, ch, mw, mh, height, tile, attr, water, objects, textures: textureSetFor(text, dir), environment: (text.match(/Environment\s+(\S+)/) || [])[1] || "" };
  m.at = (x, y) => { const cx = Math.max(0, Math.min(cw - 1e-6, x / 2)), cy = Math.max(0, Math.min(ch - 1e-6, y / 2)), x0 = Math.floor(cx), y0 = Math.floor(cy), fx = cx - x0, fy = cy - y0, s = cw + 1;
    return height[y0 * s + x0] * (1 - fx) * (1 - fy) + height[y0 * s + x0 + 1] * fx * (1 - fy) + height[(y0 + 1) * s + x0] * (1 - fx) * fy + height[(y0 + 1) * s + x0 + 1] * fx * fy; };
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  cache.set(key, m);
  return m;
}

// region [x0, y0, x1, y1] metres (snapped to 2 m); arrays are region-local, objects in region metres with lift above ground
function readRegion(dir, [x0, y0, x1, y1]) {
  const m = loadMap(dir);
  x0 = Math.max(0, Math.floor(x0 / 2) * 2); y0 = Math.max(0, Math.floor(y0 / 2) * 2); x1 = Math.min(m.mw, Math.ceil(x1 / 2) * 2); y1 = Math.min(m.mh, Math.ceil(y1 / 2) * 2);
  const w = x1 - x0, h = y1 - y0, nw = w / 2 + 1, nh = h / 2 + 1;
  const heights = new Array(nw * nh), tiles = new Array(w * h), attrs = new Array(w * h), water = new Array((w / 2) * (h / 2));
  for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) heights[j * nw + i] = +m.height[(y0 / 2 + j) * (m.cw + 1) + x0 / 2 + i].toFixed(3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = (y0 + y) * m.mw + x0 + x; tiles[y * w + x] = m.tile[k]; attrs[y * w + x] = m.attr[k]; }
  for (let y = 0; y < h / 2; y++) for (let x = 0; x < w / 2; x++) { const v = m.water[(y0 / 2 + y) * m.cw + x0 / 2 + x]; water[y * (w / 2) + x] = Number.isNaN(v) ? null : +v.toFixed(3); }
  const objects = m.objects.filter((o) => o.x >= x0 && o.y >= y0 && o.x < x1 && o.y < y1)
    .map((o) => ({ crc: o.crc, x: +(o.x - x0).toFixed(2), y: +(o.y - y0).toFixed(2), lift: +(o.z - m.at(o.x, o.y)).toFixed(2), yaw: o.yaw }));
  return { source: m.name, dir, area: [x0, y0, x1, y1], w, h, heights, tiles, attrs, water, objects, textures: m.textures.map((t) => ({ index: t.index, file: t.file })) };
}

// every map folder with a setting.txt in the client pack (and the WorldEditor root)
function listSourceMaps() {
  const out = [];
  const scan = (dir, depth) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (ents.some((e) => e.isFile() && e.name.toLowerCase() === "setting.txt")) {
      const t = fs.readFileSync(path.join(dir, findCi(dir, "setting.txt")), "latin1"), mm = t.match(/MapSize\s+(\d+)\s+(\d+)/);
      if (mm) out.push({ name: path.basename(dir), dir, size: [+mm[1], +mm[2]], source: dir.startsWith(PACK_ROOT) ? "client" : "editor" });
      return;
    }
    if (depth > 0) for (const e of ents) if (e.isDirectory() && !/^(_|ymir work|property|textureset|root|locale|icon|effect|sound|bgm)/i.test(e.name)) scan(path.join(dir, e.name), depth - 1);
  };
  scan(PACK_ROOT, 3);
  scan(EDITOR_ROOT, 1);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { loadMap, readRegion, listSourceMaps };
