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
import { createRequire } from "node:module";
const { queryCatalog } = createRequire(import.meta.url)("../catalog.js");

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

server.registerTool("mapstudio_new_map", {
  title: "Nová mapa",
  description: "Vytvorí v koreni WorldEditora novú mapu a otvorí ju. template: empty (rovina 163,8 m s baseTexture, bez vody), island (ukážkový ostrov 1×1), dungeon (miestnosti a chodby vytesané do skaly, seed voliteľný). sizeX/sizeY v terénoch po 256 m.",
  inputSchema: { name: z.string(), sizeX: z.number().int().min(1).max(16).optional(), sizeY: z.number().int().min(1).max(16).optional(), baseTexture: z.string().optional(), template: z.enum(["empty", "island", "dungeon"]).optional(), seed: z.string().optional() }
}, tool((a) => call("new_map", a)));

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

server.registerTool("mapstudio_spline", {
  title: "Cesta, rieka alebo hrebeň po krivke",
  description: `Plynulá krivka cez body. road: terén vyrovnaný do plynulého profilu s obmedzeným stúpaním (maxGrade, m na m, predvolene 0,12), krajnica edge m, textúra jadra s nepravidelným okrajom, edgeTexture ako vyšliapaná krajnica. river: koryto, ktoré po prúde (od prvého bodu) len klesá, hĺbka depth m, svahy brehov edge m, hladina 70 % hĺbky, atribút voda, block = neprechodná (predvolene true), bedTexture dno, texture breh, water false = zamrznuté / suché koryto bez hladiny. ridge: zalesnený hrebeň medzi oblasťami (švy importov, hranice zón), vrchol height m (12) nad vyššou stranou, šírka width (30), svahy edge, texture + steepTexture na svahoch nad 30°, block (predvolene true). Textúry: číslo mapy alebo herná cesta. Jeden krok Späť. ${POS}`,
  inputSchema: { kind: z.enum(["road", "river", "ridge"]), height: z.number().positive().optional(), steepTexture: z.union([z.number(), z.string()]).optional(), points: z.array(point).min(2).max(500), width: z.number().positive().optional(), edge: z.number().positive().optional(),
    texture: z.union([z.number(), z.string()]).optional(), edgeTexture: z.union([z.number(), z.string()]).optional(), bedTexture: z.union([z.number(), z.string()]).optional(),
    depth: z.number().positive().optional(), water: z.boolean().optional(), maxGrade: z.number().positive().optional(), smooth: z.number().positive().optional(), block: z.boolean().optional(), seed: z.number().optional() }
}, tool((a) => call("spline", a)));

const box = z.tuple([z.number(), z.number(), z.number(), z.number()]);
server.registerTool("mapstudio_terrain_generate", {
  title: "Generovať terén",
  description: `Reliéf zo šumu + erózia v oblasti (jeden krok Späť). area [x0,y0,x1,y1] m (inak celá mapa), blend m (prechod do starého terénu), base m (stredná výška),
hills { amplitude m (8), scale m veľkosť tvarov (140), octaves (5), ridged 0–1 hrebene (0.15), warp m (25) },
rim { box [x0,y0,x1,y1] hrateľná plocha alebo open [{x,y,r} | {points,radius}] tvary údolí a ciest, width m (60), height m (30), ridged (0.6), scale (90) } = hory mimo boxu / tvarov, anchors [{x,y,h}] výškový plán (údolie stúpa podľa bodov),
calm [{ points, radius, factor 0–1 }] = menej reliéfu pri cestách / údoliach, flats [{ x, y, r, blend (12), height? }] = rovné plochy po erózii,
erosion { droplets (30000), strength (1), thermal (20), talus ° (35) }, seed. ${POS}`,
  inputSchema: { area: box.optional(), blend: z.number().optional(), base: z.number().optional(), seed: z.number().optional(), mode: z.enum(["replace", "add"]).optional().describe("add = pridá reliéf / hory k existujúcemu terénu"),
    hills: z.object({ amplitude: z.number(), scale: z.number(), octaves: z.number().int(), ridged: z.number(), warp: z.number() }).partial().optional(),
    anchors: z.array(z.object({ x: z.number(), y: z.number(), h: z.number() })).optional(),
    rim: z.object({ box: box.optional(), open: z.array(z.union([z.object({ x: z.number(), y: z.number(), r: z.number() }), z.object({ points: z.array(point), radius: z.number() })])).optional(), width: z.number().optional(), height: z.number().optional(), ridged: z.number().optional(), scale: z.number().optional() }).optional(),
    calm: z.array(z.object({ points: z.array(point).min(2), radius: z.number(), factor: z.number() })).optional(),
    flats: z.array(z.object({ x: z.number(), y: z.number(), r: z.number(), blend: z.number().optional(), height: z.number().optional() })).optional(),
    erosion: z.object({ droplets: z.number().int(), strength: z.number(), thermal: z.number().int(), talus: z.number() }).partial().optional() }
}, tool((a) => call("terrain_generate", a)));

const texRef = z.union([z.number(), z.string()]);
server.registerTool("mapstudio_auto_texture", {
  title: "Automatické textúry",
  description: `Textúry podľa pravidiel (jeden krok Späť); pre každú 1 m bunku vyhrá prvé pravidlo, ktoré sedí. Pravidlo: texture (číslo alebo herná cesta),
slope [min,max] °, height [min,max] m, water = max vzdialenosť od vody m, noise { scale m, min, max } (-1..1), jitter ° (3, roztrhaný okraj).
keep = textúry, ktoré sa neprepíšu (cesty, dlažba). area [x0,y0,x1,y1] m. ${POS}`,
  inputSchema: { rules: z.array(z.object({ texture: texRef, slope: z.tuple([z.number(), z.number()]).optional(), height: z.tuple([z.number(), z.number()]).optional(),
    water: z.number().optional(), noise: z.object({ scale: z.number(), min: z.number().optional(), max: z.number().optional() }).optional(), jitter: z.number().optional() })).min(1),
    keep: z.array(texRef).optional(), area: box.optional(), seed: z.number().optional() }
}, tool((a) => call("auto_texture", a)));

server.registerTool("mapstudio_scatter", {
  title: "Rozmiestniť biómy",
  description: `Rozmiestni objekty vo vrstvách ako prírodné mapy (jeden krok Späť, dryRun = len štatistika). Vrstva: name, items [{ crc|name, weight }], density na ha oblasti,
cluster { radius m, size } = háje (zhluky), near { layer, radius, chance } = podrast pri stromoch inej vrstvy, mask { scale m, min -1..1, fade } = lesné škvrny s rednúcim okrajom,
spacing m (v rámci vrstvy), clearance m (k iným objektom, 1), slope [min,max] °, height [min,max] m, onTextures / avoidTextures, sink 0–1 (zapustenie skál), maxGroundRange m (1,5), yaw.
Všetko: area [x0,y0,x1,y1], avoid [{x,y,r}] (rezervované plochy), avoidLines [{points,radius}] (cesty), avoidWater m (3), avoidBlocked (true), seed. Rozmery z katalógu assetov. ${POS}`,
  inputSchema: { area: box.optional(), seed: z.number().optional(), dryRun: z.boolean().optional(), avoidWater: z.number().optional(), avoidBlocked: z.boolean().optional(),
    avoid: z.array(z.object({ x: z.number(), y: z.number(), r: z.number() })).optional(),
    avoidLines: z.array(z.object({ points: z.array(point).min(2), radius: z.number() })).optional(),
    layers: z.array(z.object({ name: z.string(), items: z.array(z.object({ crc: z.number().optional(), name: z.string().optional(), weight: z.number().optional() })).min(1),
      density: z.number().optional(), count: z.number().int().optional().describe("presný počet (dominanty)"), blocked: z.enum(["avoid", "only", "any"]).optional(), cluster: z.object({ radius: z.number(), size: z.number() }).optional(), near: z.object({ layer: z.string(), radius: z.number(), chance: z.number().optional() }).optional(),
      mask: z.object({ scale: z.number(), min: z.number(), fade: z.number().optional(), seed: z.number().optional() }).optional(),
      spacing: z.number().optional(), clearance: z.number().optional(), slope: z.tuple([z.number(), z.number()]).optional(), height: z.tuple([z.number(), z.number()]).optional(),
      onTextures: z.array(texRef).optional(), avoidTextures: z.array(texRef).optional(), sink: z.number().optional(), maxGroundRange: z.number().optional(), yaw: z.number().optional() })).min(1) }
}, tool((a) => call("scatter", a)));

server.registerTool("mapstudio_list_sources", {
  title: "Zdrojové mapy",
  description: "Mapy z klientských packov a z WorldEditora, z ktorých sa dá importovať oblasť (názov, priečinok, veľkosť v terénoch po 256 m). Atlas na výber oblasti: python tools/map_atlas.py <priečinok> <out.png> 64 0.6 --attr.",
  inputSchema: { query: z.string().optional() }
}, tool((a) => call("list_sources", a)));

server.registerTool("mapstudio_import_region", {
  title: "Importovať oblasť z inej mapy",
  description: `Skopíruje obdĺžnik inej mapy (terén, textúry, atribúty block/voda, voda, objekty s výškou nad terénom) do otvorenej mapy. source = názov alebo priečinok mapy,
area [x0,y0,x1,y1] m v zdrojovej mape, to [x,y] ľavý horný roh v cieľovej, rotate 0–3 (× 90° v smere hodín), blend m (16, mäkký okraj s prechodom textúr),
heightOffset "match" (podľa okraja cieľa) alebo číslo m, parts { heights, textures, attributes, water, objects }, skipUnusable (true = vynechá objekty, ktoré hra nezobrazí).
Vráti počet objektov, preskočené, textúry na terén (max 12). Terén = jeden krok Späť, objekty druhý. ${POS}`,
  inputSchema: { source: z.string(), area: box, to: point, rotate: z.number().int().min(0).max(3).optional(), blend: z.number().optional(),
    heightOffset: z.union([z.literal("match"), z.number()]).optional(), skipUnusable: z.boolean().optional(), seed: z.number().optional(),
    parts: z.object({ heights: z.boolean(), textures: z.boolean(), attributes: z.boolean(), water: z.boolean(), objects: z.boolean() }).partial().optional() }
}, tool((a) => call("import_region", a)));

server.registerTool("mapstudio_catalog", {
  title: "Katalóg assetov",
  description: "Skutočné rozmery (m, šírka × hĺbka × výška z modelu), kolízia (.mdatr / kmeň), textúry, kategória (tree, plant, rock, building, wall, bridge, light, monument, prop, other), zdroj (client / fem / editor), dostupnosť v hre a ručné hodnotenie. usable = v hre funguje (Fem: po zabalení). Varovania: granny-v7 (hra ho bez prevodu nezobrazí), editor-only, texture-missing, huge, tiny, no-collision, needs-packing. Funguje aj bez spusteného Map Studia; obnova: node tools/build-catalog.js.",
  inputSchema: { query: z.string().optional(), category: z.string().optional(), type: z.string().optional(), source: z.enum(["client", "fem", "editor"]).optional(),
    usable: z.boolean().optional(), minSize: z.number().optional().describe("najväčšia vodorovná strana, m"), maxSize: z.number().optional(), maxHeight: z.number().optional(),
    collision: z.enum(["shapes", "none", "trunk"]).optional(), limit: z.number().int().optional() }
}, tool(async (a) => queryCatalog(a)));

server.registerTool("mapstudio_add_objects", {
  title: "Pridať objekty",
  description: `Pridá objekty podľa crc alebo názvu z knižnice. Bez z sa položia na terén. ${POS}`,
  inputSchema: { items: z.array(z.object({ crc: z.number().optional(), name: z.string().optional(), x: z.number(), y: z.number(), z: z.number().optional(), yaw: z.number().optional(),
    face: point.optional().describe("otočí prednú stranu (pri yaw 0 na juh) k bodu [x, y]"), ground: z.enum(["center", "min"]).optional().describe("min = päta na najnižšom bode pod pôdorysom (svah)"),
    sink: z.number().optional().describe("zapustenie do terénu v m"), lift: z.number().optional().describe("zdvihnutie nad terén v m") })).min(1).max(2000) }
}, tool((a) => call("add_objects", a)));

const zoneSchema = z.object({ name: z.string().optional(), circles: z.array(z.tuple([z.number(), z.number(), z.number()])).optional(), box: box.optional(),
  metins: z.array(z.number().int()).optional(), groups: z.array(z.number().int()).optional(), groupType: z.enum(["g", "ga", "m", "ma"]).optional(),
  metinRespawn: z.number().optional(), groupRespawn: z.number().optional(), groupRadius: z.number().optional() });
const avoidSchema = z.array(z.object({ x: z.number(), y: z.number(), r: z.number() }));
const linesSchema = z.array(z.object({ points: z.array(point).min(2), radius: z.number() }));

server.registerTool("mapstudio_reachability", {
  title: "Priechodnosť z Townu",
  description: `Kam dôjde hráč pešo z Townu (alebo from [x,y]) po atribútoch (bez block a vody): dosiahnuteľná a priechodná plocha v ha, oddelené plochy,
spawny, ku ktorým sa nedá dôjsť. png=true uloží obrázok (zelená = dosiahnuteľné, sivá = priechodné inde, červená = blok, modrá = voda, žltá = objekty) a vráti cestu. ${POS}`,
  inputSchema: { from: point.optional(), png: z.boolean().optional() }
}, tool((a) => call("reachability", a)));

server.registerTool("mapstudio_plan_spawns", {
  title: "Naplánovať metiny a skupiny",
  description: `Rozmiestni metiny a skupiny monštier po zónach: rovné miesto (rozdiel výšok v kruhu probe m ≤ metinRough 3,5 / groupRough 5), dosiahnuteľné z Townu, bez objektov
do metinClear m (6), mimo avoid a avoidLines (cesty), rozostupy metinSpacing (30) / groupSpacing (22). Metiny dostanú najrovnejšie miesta. Zóna: circles [[x,y,r]] alebo box,
metins [vnum], groups [vnum], groupType, respawny. apply=true ich pridá (inak len návrh). ${POS}`,
  inputSchema: { zones: z.array(zoneSchema).min(1), from: point.optional(), avoid: avoidSchema.optional(), avoidLines: linesSchema.optional(), metinSpacing: z.number().optional(),
    groupSpacing: z.number().optional(), metinClear: z.number().optional(), metinRough: z.number().optional(), groupRough: z.number().optional(), probe: z.number().optional(),
    step: z.number().optional(), seed: z.number().optional(), apply: z.boolean().optional() }
}, tool((a) => call("plan_spawns", a)));

server.registerTool("mapstudio_forest_edge", {
  title: "Les na okraji údolí",
  description: `Ako oficiálne mapy: súvislá stena stromov na blokovanej zemi pozdĺž priechodných údolí (edge { from 0,5, to 16 m od priechodnej zeme, chance 0,7, spacing 5,5 }),
skalné výchozy na strmých miestach okraja (rocks, rockChance 0,05), holé blokované svahy doplnené tam, kde do fill.radius (15) m nie je strom (fill { chance 0,4, spacing 7 } alebo false),
hranica lesa maxHeight m, maxSlope (50°). items = stromy [{crc|name, weight}]. Jeden krok Späť, dryRun = len štatistika. ${POS}`,
  inputSchema: { items: z.array(z.object({ crc: z.number().optional(), name: z.string().optional(), weight: z.number().optional() })).min(1),
    rocks: z.array(z.object({ crc: z.number().optional(), name: z.string().optional() })).optional(), area: box.optional(),
    edge: z.object({ from: z.number().optional(), to: z.number().optional(), chance: z.number().optional(), spacing: z.number().optional() }).optional(),
    fill: z.union([z.literal(false), z.object({ radius: z.number().optional(), chance: z.number().optional(), spacing: z.number().optional() })]).optional(),
    rockChance: z.number().optional(), maxHeight: z.number().optional(), maxSlope: z.number().optional(), avoid: avoidSchema.optional(), avoidLines: linesSchema.optional(),
    sink: z.number().optional(), step: z.number().optional(), seed: z.number().optional(), dryRun: z.boolean().optional() }
}, tool((a) => call("forest_edge", a)));

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

const SPAWN = { type: z.enum(["m", "g", "ga", "npc"]).optional().describe("m = monštrá (count kusov), g = skupina, ga = agresívna skupina, npc = NPC do npc.txt"),
  vnum: z.number().int().positive(), radius: z.number().positive().optional().describe("polomer v m (predvolene 10)"),
  count: z.number().int().positive().optional(), respawn: z.number().int().positive().optional().describe("sekundy (predvolene 120)") };

server.registerTool("mapstudio_list_spawns", {
  title: "Zoznam spawnov",
  description: `Spawny monštier a NPC mapy (ukladajú sa do <mapa>/_studio/spawns.json, export ich zapíše do regen.txt / npc.txt). ${POS}`,
  inputSchema: {}
}, tool(() => call("list_spawns")));

server.registerTool("mapstudio_add_spawns", {
  title: "Pridať spawny",
  description: `Pridá spawny (vnum z mob_proto servera). Uloží ich mapstudio_save. ${POS}`,
  inputSchema: { items: z.array(z.object({ x: z.number(), y: z.number(), ...SPAWN })).min(1) }
}, tool((a) => call("add_spawns", a)));

server.registerTool("mapstudio_update_spawns", {
  title: "Upraviť spawny",
  description: "Zmení polia spawnov podľa id (x, y, type, vnum, radius, count, respawn).",
  inputSchema: { items: z.array(z.object({ id: z.number().int(), x: z.number().optional(), y: z.number().optional(), ...SPAWN, vnum: z.number().int().positive().optional() })).min(1) }
}, tool((a) => call("update_spawns", a)));

server.registerTool("mapstudio_game_export", {
  title: "Export do hry (staging)",
  description: "Uloží mapu, vykreslí minimapu/atlas/tiene a pripraví súbory pre server a klient do APIX/_map_exports/<mapa>_<čas> s manifest.json. Server ani klient nemení. Bez index/base navrhne voľný slot (existujúca mapa si ponechá svoj).",
  inputSchema: { index: z.number().int().positive().optional(), base: z.array(z.number().int().nonnegative()).length(2).optional(), goto: z.string().regex(/^[a-z0-9_]*$/).optional(), objectCollision: z.boolean().optional() }
}, tool(async (a) => {
  const slot = a.index && a.base ? null : await call("suggest_game_slot");
  return call("game_export", { ...a, index: a.index || slot.index, base: a.base || slot.base });
}));

server.registerTool("mapstudio_set_town", {
  title: "Nastaviť Town",
  description: `Town.txt mapy: kde sa hráči objavia po teleporte (uloží mapstudio_save, export ho použije bez --town). ${POS}`,
  inputSchema: { x: z.number(), y: z.number() }
}, tool((a) => call("set_town", a)));

server.registerTool("mapstudio_delete_spawns", {
  title: "Zmazať spawny",
  description: "Zmaže spawny podľa id (dá sa vrátiť cez mapstudio_undo).",
  inputSchema: { ids: z.array(z.number().int()).min(1) }
}, tool((a) => call("delete_spawns", a)));

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

server.registerTool("mapstudio_list_prefabs", {
  title: "Zoznam prefabov",
  description: "Uložené skupiny objektov (prefaby) s počtom objektov.",
  inputSchema: {}
}, tool(() => call("list_prefabs")));

server.registerTool("mapstudio_save_prefab", {
  title: "Uložiť prefab",
  description: "Uloží objekty podľa id ako prefab (relatívne rozloženie, výška nad terénom).",
  inputSchema: { name: z.string(), ids: z.array(z.number().int()).min(1) }
}, tool((a) => call("save_prefab", a)));

server.registerTool("mapstudio_place_prefab", {
  title: "Položiť prefab",
  description: `Položí prefab so stredom v bode x, y a otočením yaw; každý objekt sedne na terén. ${POS}`,
  inputSchema: { name: z.string(), x: z.number(), y: z.number(), yaw: z.number().optional() }
}, tool((a) => call("place_prefab", a)));

server.registerTool("mapstudio_list_environments", {
  title: "Zoznam prostredí",
  description: "Prostredia (.msenv z d:/ymir work/environment) – obloha, svetlo, hmla. Filter podľa časti názvu.",
  inputSchema: { query: z.string().optional() }
}, tool((a) => call("list_environments", a)));

server.registerTool("mapstudio_set_environment", {
  title: "Nastaviť prostredie mapy",
  description: "Nastaví prostredie mapy (napr. a1.msenv), hneď ho zobrazí a pri uložení zapíše do Setting.txt. Prázdny názov = žiadne.",
  inputSchema: { name: z.string() }
}, tool((a) => call("set_environment", a)));

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
