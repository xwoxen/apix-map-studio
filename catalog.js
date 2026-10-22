// Asset catalog (tools/build-catalog.js writes %APPDATA%\APIX Map Studio\catalog.json): real size, collision, textures,
// category, game availability and hand rating per library object. Shared by Map Studio (main.js) and the MCP server.
const fs = require("fs");
const path = require("path");

const CATALOG = path.join(process.env.APPDATA || "", "APIX Map Studio", "catalog.json");
let catalog = null, catalogMtime = 0;
function getCatalog() {
  try {
    const m = fs.statSync(CATALOG).mtimeMs;
    if (!catalog || m !== catalogMtime) { catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8")); catalogMtime = m; }
  } catch { catalog = null; }
  return catalog;
}

const catalogBrief = (e) => e && ({ size: e.size, category: e.category, usable: e.usable, usableAfterPacking: e.usableAfterPacking, warnings: e.warnings, rating: e.rating, reason: e.reason });

// filters: query (name/folder/model), category, type, source (client|fem|editor), usable (fem counts when usable after
// packing), minSize / maxSize (largest horizontal side, m), maxHeight (m), collision (shapes|none|trunk), limit
function queryCatalog({ query = "", category, type, source, usable, minSize, maxSize, maxHeight, collision, limit = 50 } = {}) {
  const c = getCatalog();
  if (!c) return { error: "Katalóg chýba: spusti node tools/build-catalog.js" };
  const q = query.toLowerCase();
  const hits = Object.values(c.items).filter((e) => {
    if (q && !`${e.name} ${e.folder} ${e.model}`.toLowerCase().includes(q)) return false;
    if (category && e.category !== category) return false;
    if (type && e.type !== type) return false;
    if (source && e.source !== source) return false;
    if (usable !== undefined && Boolean(e.usable || e.usableAfterPacking) !== usable) return false;
    const side = e.size ? Math.max(e.size[0], e.size[1]) : null;
    if (minSize !== undefined && (side === null || side < minSize)) return false;
    if (maxSize !== undefined && (side === null || side > maxSize)) return false;
    if (maxHeight !== undefined && (!e.size || e.size[2] > maxHeight)) return false;
    if (collision && (!e.collision || e.collision.kind !== collision)) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { total: hits.length, generated: c.generated, counts: c.counts, items: hits.slice(0, limit) };
}

module.exports = { CATALOG, getCatalog, catalogBrief, queryCatalog };
