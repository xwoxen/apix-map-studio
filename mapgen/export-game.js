// Game export: turns a Map Studio / WorldEditor map folder into staged server and client files.
// Nothing outside --out is written; deployment (map index, GAME_MAP_ALLOW, pack Index, atlasinfo) is a separate,
// confirmed step that the manifest lists.
//
// Usage: node mapgen/export-game.js <map dir> --index <n> --base <x> <y> --out <staging dir>
//          [--town <x> <y>]   spawn in meters from the map's north-west corner (default: the town set in Map Studio,
//                             else the map centre)
//          [--goto <alias>]   /goto alias for settings.lua (default: none)
//          [--no-object-collision]  leave OBJECT (128) out of server_attr
//
// Run Map Studio's Export first: it renders <map>/<terrain>/minimap.dds and <map>/_export/atlas.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { compress } = require("./lzo");
const { objectCells } = require("./collision");
const { litLevels, shadowRaw, shadowDds } = require("./shadow");
const { readSpawns, readSpawnFile, regenRows } = require("./spawns");
const { readIndex, readRects } = require("./game-slots");
const { parseAreaData } = require("../maplib");

const TERRAIN = 25600;                 // world units per terrain (CellScale 200 × 128 cells)
const SECTOR = 6400, CELL = 50;        // server sectree and attribute cell
const CELLS = SECTOR / CELL;           // 128 × 128 cells per sector
const CLIENT_TERRAIN_FILES = ["areaambiencedata.txt", "areadata.txt", "areaproperty.txt", "attr.atr", "height.raw", "tile.raw", "water.wtr", "minimap.dds"];

function readSetting(dir) {
  const text = fs.readFileSync(path.join(dir, "Setting.txt"), "latin1");
  const get = (key) => { const m = text.match(new RegExp(`^${key}\\s+(.+?)\\s*$`, "mi")); return m ? m[1].split(/\s+/) : null; };
  return { text, size: get("MapSize").map(Number), textureSet: get("TextureSet")[0], environment: (get("Environment") || [null])[0] };
}

function findFile(dir, name) {
  const hit = fs.readdirSync(dir).find((f) => f.toLowerCase() === name.toLowerCase());
  return hit ? path.join(dir, hit) : null;
}

// server_attr: int32 width, height in sectors; per sector int32 size + LZO of 128×128 DWORD cells (0.5 m).
// Client attr.atr pixels are 1 m, so each covers 2×2 server cells; the flag bits are the same.
function readObjects(dir, size) {
  const out = [];
  for (let ty = 0; ty < size[1]; ty++) for (let tx = 0; tx < size[0]; tx++) {
    const f = findFile(path.join(dir, `${String(tx).padStart(3, "0")}${String(ty).padStart(3, "0")}`), "AreaData.txt");
    if (f) out.push(...parseAreaData(fs.readFileSync(f, "latin1")));
  }
  return out;
}

// RGB preview of server_attr (1 px = 0.5 m): block red, water blue, no-PvP green, object yellow
function attrPreview(grid, w, h) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const v = grid[y * w + x];
      const c = v & 128 ? [235, 200, 40] : v & 1 ? [200, 50, 50] : v & 2 ? [50, 110, 220] : v & 4 ? [60, 160, 80] : [40, 40, 40];
      c.forEach((b, i) => { row[1 + x * 3 + i] = b; });
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) : crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
function crc32(b) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < b.length; n++) { c = (crc ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}

function serverAttr(dir, size, objectCollision = true) {
  const w = size[0] * (TERRAIN / SECTOR), h = size[1] * (TERRAIN / SECTOR);
  const attrs = new Map();
  for (let ty = 0; ty < size[1]; ty++) for (let tx = 0; tx < size[0]; tx++) {
    const t = path.join(dir, `${String(tx).padStart(3, "0")}${String(ty).padStart(3, "0")}`);
    const f = findFile(t, "attr.atr");
    if (!f) throw new Error(`missing attr.atr in ${t}`);
    const b = fs.readFileSync(f);
    if (b.readUInt16LE(0) !== 0x0a4a || b.readUInt16LE(2) !== 256 || b.readUInt16LE(4) !== 256) throw new Error(`unexpected attr.atr header in ${t}`);
    attrs.set(`${tx},${ty}`, b);
  }
  const parts = [Buffer.from(new Int32Array([w, h]).buffer)];
  const flags = { block: 0, water: 0, banpk: 0, object: 0 };
  const gw = w * CELLS, gh = h * CELLS, grid = new Uint8Array(gw * gh);
  const collision = objectCollision ? objectCells(readObjects(dir, size), size[0] * 256, size[1] * 256) : null;
  for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
    const cells = Buffer.alloc(CELLS * CELLS * 4);
    for (let cy = 0; cy < CELLS; cy++) for (let cx = 0; cx < CELLS; cx++) {
      const mx = (sx * SECTOR + cx * CELL) / 100, my = (sy * SECTOR + cy * CELL) / 100;   // meters from the NW corner
      const tx = Math.floor(mx / 256), ty = Math.floor(my / 256);
      let v = attrs.get(`${tx},${ty}`)[6 + Math.floor(my - ty * 256) * 256 + Math.floor(mx - tx * 256)] & 7;
      const gx = sx * CELLS + cx, gy = sy * CELLS + cy;
      if (collision && collision.cells.has(`${gx},${gy}`)) v |= 128;
      grid[gy * gw + gx] = v;
      if (v & 1) flags.block++; if (v & 2) flags.water++; if (v & 4) flags.banpk++; if (v & 128) flags.object++;
      cells.writeUInt32LE(v, (cy * CELLS + cx) * 4);
    }
    const z = compress(cells);
    const len = Buffer.alloc(4); len.writeInt32LE(z.length);
    parts.push(len, z);
  }
  return { data: Buffer.concat(parts), sectors: [w, h], cells: flags, grid, gridSize: [gw, gh], collision: collision && collision.report };
}

function attrAt(dir, xm, ym) {
  const tx = Math.floor(xm / 256), ty = Math.floor(ym / 256);
  const f = findFile(path.join(dir, `${String(tx).padStart(3, "0")}${String(ty).padStart(3, "0")}`), "attr.atr");
  return fs.readFileSync(f)[6 + Math.floor(ym - ty * 256) * 256 + Math.floor(xm - tx * 256)];
}

function exportGame(mapDir, { index, base, out, town, gotoAlias, editorRoot, objectCollision = true }) {
  const name = path.basename(mapDir);
  const setting = readSetting(mapDir);
  const [sw, sh] = setting.size;
  if (base[0] % TERRAIN || base[1] % TERRAIN) throw new Error("BasePosition must be a multiple of 25600");
  const studioTown = readSpawnFile(mapDir).town, townGiven = Boolean(town);
  town = town || (studioTown ? [studioTown.x, studioTown.y] : [sw * 128, sh * 128]);
  if (attrAt(mapDir, town[0], town[1]) & 1) throw new Error(`town ${town} is on a blocked cell`);
  if (fs.existsSync(out)) throw new Error(`${out} already exists; choose a new staging folder`);
  const files = [];
  const put = (rel, data) => {
    const dest = path.join(out, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
    files.push({ path: rel.replace(/\\/g, "/"), bytes: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex") });
  };

  /* server: data/map/<name>/ (LF like the existing server maps) */
  const srv = `server/${name}`;
  put(`${srv}/Setting.txt`, Buffer.from(["ScriptType\tMapSetting", "", "CellScale\t200", "HeightScale\t0.500000", "", "ViewRadius\t128", "",
    `MapSize\t${sw}\t${sh}`, `BasePosition\t${base[0]}\t${base[1]}`, `TextureSet\ttextureset\\${name}.txt`, ""].join("\n"), "latin1"));
  put(`${srv}/Town.txt`, Buffer.from(`${Math.round(town[0])} ${Math.round(town[1])}\n`, "latin1"));
  const attr = serverAttr(mapDir, setting.size, objectCollision);
  const townCell = attr.grid[Math.floor(town[1] * 2) * attr.gridSize[0] + Math.floor(town[0] * 2)];
  if (townCell & 129) throw new Error(`town ${town} is blocked in server_attr (flags ${townCell}); pick another --town`);
  put(`${srv}/server_attr`, attr.data);
  put("server_attr_preview.png", attrPreview(attr.grid, ...attr.gridSize));
  // spawns placed in Map Studio (<map>/_studio/spawns.json); a spawn centre on a blocked cell never spawns
  const spawns = readSpawns(mapDir), rows = regenRows(spawns), warnings = [];
  if (!townGiven && !studioTown) warnings.push(`town not set (Map Studio: Spawny > Town, or --town); the map centre ${town} is used`);
  for (const sp of spawns) {
    const v = attr.grid[Math.floor(sp.y * 2) * attr.gridSize[0] + Math.floor(sp.x * 2)];
    if (v & 129) warnings.push(`spawn ${sp.type} ${sp.vnum} at ${Math.round(sp.x)},${Math.round(sp.y)} stands on a blocked cell (flags ${v})`);
    else if (sp.type !== "npc" && !(v & 4) && Math.hypot(sp.x - town[0], sp.y - town[1]) < sp.radius + 10) warnings.push(`monsters ${sp.vnum} spawn within 10 m of the town`);
  }
  put(`${srv}/regen.txt`, Buffer.from(rows.regen, "latin1"));
  put(`${srv}/npc.txt`, Buffer.from(rows.npc, "latin1"));
  for (const f of ["boss.txt", "stone.txt"]) put(`${srv}/${f}`, Buffer.alloc(0));

  /* client pack apix_<name>: map folder (lower-case names like the shipped packs), texture set, atlas */
  const pack = `client/${name}`;
  const clientSetting = setting.text.replace(/^BasePosition\s+.*$/m, `BasePosition\t${base[0]}\t${base[1]}`);
  put(`${pack}/${name}/setting.txt`, Buffer.from(clientSetting, "latin1"));
  put(`${pack}/${name}/mapproperty.txt`, fs.readFileSync(findFile(mapDir, "MapProperty.txt")));
  const shadows = {};
  for (let ty = 0; ty < sh; ty++) for (let tx = 0; tx < sw; tx++) {
    const key = `${String(tx).padStart(3, "0")}${String(ty).padStart(3, "0")}`, t = path.join(mapDir, key);
    for (const f of CLIENT_TERRAIN_FILES) {
      const src = findFile(t, f);
      if (!src) throw new Error(`missing ${key}/${f}${f === "minimap.dds" ? " (run Export in Map Studio first)" : ""}`);
      put(`${pack}/${name}/${key}/${f}`, fs.readFileSync(src));
    }
    // shadows baked by Map Studio's Export (sun of the map's environment), otherwise a fully lit terrain
    const raw = findFile(t, "shadowmap.raw"), dds = findFile(t, "shadowmap.dds");
    const baked = raw && dds && fs.statSync(raw).size === 131072;
    put(`${pack}/${name}/${key}/shadowmap.raw`, baked ? fs.readFileSync(raw) : shadowRaw(litLevels()));
    put(`${pack}/${name}/${key}/shadowmap.dds`, baked ? fs.readFileSync(dds) : shadowDds(litLevels()));
    shadows[key] = baked ? "baked" : "lit";
  }
  const tsName = setting.textureSet.replace(/\\/g, "/").split("/").pop();
  if (tsName.toLowerCase() !== `${name}.txt`) throw new Error(`texture set ${setting.textureSet} must be textureset\\${name}.txt`);
  put(`${pack}/textureset/${name}.txt`, fs.readFileSync(path.join(editorRoot, "textureset", tsName)));
  const atlasDir = path.join(mapDir, "_export", "atlas");
  const atlasDds = findFile(atlasDir, `${name}_atlas.dds`);
  if (!atlasDds) throw new Error("missing _export/atlas (run Export in Map Studio first)");
  put(`${pack}/ymir work/ui/atlas/${name}/atlas.sub`, fs.readFileSync(path.join(atlasDir, "atlas.sub")));
  put(`${pack}/ymir work/ui/${name}_atlas.dds`, fs.readFileSync(atlasDds));

  const manifest = {
    map: name, index, basePosition: base, mapSize: setting.size, town, environment: setting.environment,
    shadows,
    spawns: { regen: spawns.filter((x) => x.type !== "npc").length, npc: spawns.filter((x) => x.type === "npc").length, warnings },
    serverAttr: { sectors: attr.sectors, cells: attr.cells, objectCollision: attr.collision || "off" },
    deploy: deploySteps({ name, index, base, town, gotoAlias, sw, sh }),
    files
  };
  put("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
  return manifest;
}

// A map already in the game (same name in map/index with the same index and atlas position) is updated in place:
// only its files are replaced. A new map also needs its index, GAME_MAP_ALLOW, Index and atlasinfo lines.
function deploySteps({ name, index, base, town, gotoAlias, sw, sh }) {
  const own = readIndex().find((e) => e.name === name), rect = readRects().find((r) => r.name === name);
  const update = own && own.index === index && rect && rect.x === base[0] && rect.y === base[1];
  const gotoLine = gotoAlias ? [`add_goto_info("${gotoAlias}", 0, ${index}, ${Math.round(base[0] / 100 + town[0])}, ${Math.round(base[1] / 100 + town[1])}) in apix-server/gamefiles/data/settings.lua (if missing)`] : [];
  if (update) {
    return {
      mode: "update",
      server: [`replace apix-server/gamefiles/data/map/${name}/* with server/${name}/* (index ${index} and GAME_MAP_ALLOW stay), recreate containers`, ...gotoLine],
      client: [`replace apix-client/bin/pack/${name}/ with client/${name}/ and rebuild ${name}.zip in bin/pack and dist/pack (Index and atlasinfo stay)`]
    };
  }
  return {
    mode: "new",
    server: [
      `copy server/${name} -> apix-server/gamefiles/data/map/${name}`,
      `append "${index} ${name}" to apix-server/gamefiles/data/map/index`,
      `add ${index} to GAME_MAP_ALLOW (auth and ch1) in apix-server/local-deploy/docker-compose.yml, recreate containers`,
      ...gotoLine
    ],
    client: [
      `pack client/${name} -> apix-client/bin/pack/${name}/ + ${name}.zip, and dist/pack/${name}.zip`,
      `append "${name}\\tZIP" to bin/pack/Index and dist/pack/Index`,
      `append "${name}\\t${base[0]}\\t${base[1]}\\t${sw}\\t${sh}" to root atlasinfo.txt (bin/pack/root, root.zip in bin and dist)`
    ]
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (k, n = 1) => { const i = args.indexOf(k); return i < 0 ? null : args.slice(i + 1, i + 1 + n); };
  const mapDir = path.resolve(args[0]);
  const m = exportGame(mapDir, {
    index: Number(opt("--index")[0]), base: opt("--base", 2).map(Number), out: path.resolve(opt("--out")[0]),
    town: opt("--town", 2) ? opt("--town", 2).map(Number) : null, gotoAlias: opt("--goto") ? opt("--goto")[0] : null,
    objectCollision: !args.includes("--no-object-collision"),
    editorRoot: path.dirname(mapDir)
  });
  console.log(`staged ${m.map} (index ${m.index}, base ${m.basePosition}, ${m.files.length} files)`);
  console.log(JSON.stringify(m.serverAttr), "town", m.town);
}

module.exports = { exportGame, serverAttr };
