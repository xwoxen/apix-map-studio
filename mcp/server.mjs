// MCP server for APIX Map Studio: lets Claude read and edit the map that is open in the running app.
// It talks to the app's local control bridge (127.0.0.1, token in %APPDATA%\APIX Map Studio\control-endpoint.json).
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENDPOINT = path.join(process.env.APPDATA || "", "APIX Map Studio", "control-endpoint.json");

function readEndpoint() {
  try { return JSON.parse(fs.readFileSync(ENDPOINT, "utf8")); } catch { return null; }
}

function post(ep, method, params, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ token: ep.token, method, params });
    const req = http.request({ host: ep.host, port: ep.port, method: "POST", path: "/", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout: timeoutMs }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => { try { const m = JSON.parse(data); m.ok ? resolve(m.result) : reject(new Error(m.error)); } catch (e) { reject(e); } });
    });
    req.on("timeout", () => req.destroy(new Error("Map Studio neodpovedá")));
    req.on("error", reject);
    req.end(body);
  });
}

async function call(method, params = {}) {
  const ep = readEndpoint();
  if (!ep) throw new Error("Map Studio nebeží. Spusti ho (nástroj mapstudio_launch alebo 'Spustit Map Studio.cmd').");
  return post(ep, method, params);
}

const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const fail = (e) => ({ content: [{ type: "text", text: `Chyba: ${e.message || e}` }], isError: true });
const tool = (fn) => async (args) => { try { return text(await fn(args)); } catch (e) { return fail(e); } };

const server = new McpServer({ name: "apix-map-studio", version: "0.3.0" });
const point = z.tuple([z.number(), z.number()]);
const POS = "Pozície sú v metroch od severozápadného rohu mapy: x na východ, y na juh, z výška.";

server.registerTool("mapstudio_launch", {
  title: "Spustiť Map Studio",
  description: "Spustí APIX Map Studio (ak nebeží) a voliteľne otvorí mapu (priečinok so Setting.txt).",
  inputSchema: { map: z.string().optional() }
}, tool(async ({ map }) => {
  if (readEndpoint()) {
    try { await post(readEndpoint(), "status", {}, 5000); return map ? call("open_map", { dir: map }) : call("status"); } catch { /* stale endpoint, start again */ }
  }
  const electron = path.join(APP_DIR, "node_modules", "electron", "dist", "electron.exe");
  const args = [APP_DIR, ...(map ? ["--open", map] : [])];
  spawn(electron, args, { cwd: APP_DIR, detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const ep = readEndpoint();
    if (ep) { try { return await post(ep, "status", {}, 5000); } catch { /* window still loading */ } }
  }
  throw new Error("Map Studio sa nespustilo do 30 s");
}));

server.registerTool("mapstudio_status", {
  title: "Stav Map Studia",
  description: "Otvorená mapa, veľkosť v metroch, počet objektov, neuložené zmeny, textúry terénu.",
  inputSchema: {}
}, tool(() => call("status")));

server.registerTool("mapstudio_open_map", {
  title: "Otvoriť mapu",
  description: "Otvorí mapu (absolútna cesta k priečinku so Setting.txt). Neuložené zmeny v aktuálnej mape sa stratia.",
  inputSchema: { dir: z.string() }
}, tool((a) => call("open_map", a)));

server.registerTool("mapstudio_list_objects", {
  title: "Zoznam objektov",
  description: `Objekty na mape (id, crc, názov, typ, x, y, z, yaw, výška terénu pod nimi). Filter podľa okolia, CRC alebo názvu. ${POS}`,
  inputSchema: { x: z.number().optional(), y: z.number().optional(), radius: z.number().optional(), crc: z.number().optional(), name: z.string().optional(), limit: z.number().int().optional() }
}, tool((a) => call("list_objects", a)));

server.registerTool("mapstudio_search_library", {
  title: "Hľadať v knižnici objektov",
  description: "Hľadá objekty (property) podľa názvu alebo priečinka. Typy: Building, Tree, Effect, DungeonBlock…",
  inputSchema: { query: z.string(), type: z.string().optional(), limit: z.number().int().optional() }
}, tool((a) => call("search_library", a)));

server.registerTool("mapstudio_add_objects", {
  title: "Pridať objekty",
  description: `Pridá objekty podľa crc alebo názvu z knižnice. Bez z sa položia na terén. ${POS}`,
  inputSchema: { items: z.array(z.object({ crc: z.number().optional(), name: z.string().optional(), x: z.number(), y: z.number(), z: z.number().optional(), yaw: z.number().optional() })).min(1).max(2000) }
}, tool((a) => call("add_objects", a)));

server.registerTool("mapstudio_update_objects", {
  title: "Upraviť objekty",
  description: `Posunie / otočí objekty podľa id. Pri zmene x/y bez z sa objekt položí na terén; ground=true položí na terén. ${POS}`,
  inputSchema: { items: z.array(z.object({ id: z.number().int(), x: z.number().optional(), y: z.number().optional(), z: z.number().optional(), yaw: z.number().optional(), ground: z.boolean().optional() })).min(1).max(5000) }
}, tool((a) => call("update_objects", a)));

server.registerTool("mapstudio_delete_objects", {
  title: "Zmazať objekty",
  description: "Zmaže objekty podľa id (dá sa vrátiť cez mapstudio_undo).",
  inputSchema: { ids: z.array(z.number().int()).min(1) }
}, tool((a) => call("delete_objects", a)));

server.registerTool("mapstudio_terrain_height", {
  title: "Výška terénu",
  description: `Výška terénu, hladina vody (null = sucho) a atribúty (1 blok, 2 voda, 4 bez PvP) v bodoch. ${POS}`,
  inputSchema: { points: z.array(point).min(1).max(5000) }
}, tool((a) => call("terrain_height", a)));

server.registerTool("mapstudio_paint", {
  title: "Štetec terénu",
  description: `Jeden ťah štetcom po bodoch (jeden krok Späť). tool: raise, lower, smooth, flatten, texture, water, attr. radius v m, strength 1–10.
texture: číslo textúry mapy alebo herná cesta d:/ymir work/terrainmaps/... (pridá sa sama). waterLevel a flattenTo v metroch (bez nich z prvého bodu).
attr: {block, water, banpk}. invert = znížiť / zmazať. ${POS}`,
  inputSchema: {
    tool: z.enum(["raise", "lower", "smooth", "flatten", "texture", "water", "attr"]),
    points: z.array(point).min(1).max(20000),
    radius: z.number().optional(), strength: z.number().optional(), texture: z.union([z.number(), z.string()]).optional(),
    waterLevel: z.number().optional(), flattenTo: z.number().optional(),
    attr: z.object({ block: z.boolean().optional(), water: z.boolean().optional(), banpk: z.boolean().optional() }).optional(),
    invert: z.boolean().optional()
  }
}, tool((a) => call("paint", a)));

server.registerTool("mapstudio_add_texture", {
  title: "Pridať textúru terénu",
  description: "Pridá textúru (d:/ymir work/terrainmaps/...) do sady textúr mapy a vráti jej číslo.",
  inputSchema: { game: z.string() }
}, tool((a) => call("add_texture", a)));

server.registerTool("mapstudio_ground_all_objects", {
  title: "Položiť objekty na terén",
  description: "Nastaví výšku všetkých objektov na terén pod nimi.",
  inputSchema: {}
}, tool(() => call("ground_all_objects")));

server.registerTool("mapstudio_undo", { title: "Späť", description: "Vráti posledný krok (objekty aj terén).", inputSchema: {} }, tool(() => call("undo")));
server.registerTool("mapstudio_redo", { title: "Znova", description: "Zopakuje vrátený krok.", inputSchema: {} }, tool(() => call("redo")));

server.registerTool("mapstudio_save", {
  title: "Uložiť mapu",
  description: "Uloží objekty a zmenený terén do súborov mapy (so zálohou v _studio_backup).",
  inputSchema: {}
}, tool(() => call("save")));

server.registerTool("mapstudio_screenshot", {
  title: "Snímka 3D pohľadu",
  description: `Vykreslí 3D pohľad a uloží PNG; vráti cestu k súboru (otvor ho nástrojom Read). Voliteľne nastaví kameru:
x, y = bod, na ktorý sa pozerá; distance v m; yaw 0 = pohľad na sever, 90 = na západ; pitch 90 = zhora. attr=true ukáže atribúty. ${POS}`,
  inputSchema: { x: z.number().optional(), y: z.number().optional(), distance: z.number().optional(), yaw: z.number().optional(), pitch: z.number().optional(), attr: z.boolean().optional() }
}, tool((a) => call("screenshot", a)));

server.registerTool("mapstudio_window_screenshot", {
  title: "Snímka celého okna",
  description: "Uloží PNG celého okna Map Studia (panely, správy) a vráti cestu.",
  inputSchema: {}
}, tool(() => call("window_screenshot")));

server.registerTool("mapstudio_check_map", {
  title: "Kontrola mapy",
  description: "Kontrola pred nasadením: objekty mimo mapy, neznáme CRC, chýbajúce modely, objekty vo vode alebo vo vzduchu, chýbajúce textúry, voda bez atribútu.",
  inputSchema: {}
}, tool(() => call("check_map")));

server.registerTool("mapstudio_export", {
  title: "Export minimapy a atlasu",
  description: "Vykreslí zhora minimapu každého terénu (minimap.dds) a atlas mapy (_export/atlas/atlas.sub + <mapa>_atlas.dds).",
  inputSchema: {}
}, tool(() => call("export")));

await server.connect(new StdioServerTransport());
