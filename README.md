# APIX Map Studio

Moderný editor máp pre APIX (Metin2). Fáza 1: otvorenie mapy, zobrazenie terénu a objektov,
vkladanie, posúvanie, otáčanie, mazanie a uloženie späť do formátu WorldEditora.

## Spustenie

Dvojklik na `Spustit Map Studio.cmd`, alebo:

```
npm start
```

Prvé spustenie po inštalácii: `npm install` (Electron musí mať povolený inštalačný skript,
`package.json` → `allowScripts`).

## Čo vie

- Otvorí priečinok mapy (so `Setting.txt`) z WorldEditora aj z `mapgen`.
- Terén s miešaním textúr podľa `tile.raw`, voda z `water.wtr`.
- Objekty z `AreaData.txt`: budovy ako skutočné modely (GR2 → FBX cez
  `_codex_granny_compiled\GrannyExporter.exe`, cache v `%APPDATA%\APIX Map Studio\model-cache`),
  stromy (SpeedTree) zatiaľ ako zjednodušený strom v správnej veľkosti, efekty ako žltá značka,
  neznáme CRC ako fialová kocka.
- Knižnica ~3 200 objektov zo všetkých `apix-client\bin\pack\*\property` v poradí `Index`
  (prvý vlastník CRC vyhráva ako v klientovi) plus `property` z WorldEditora. Objekty, ktorých model v klientovi
  nie je, sa v zozname neukazujú (kontrola mapy ich však pozná).
  Každý objekt má 3D náhľad (vykreslí sa pri prvom zobrazení riadku, uloží sa do
  `%APPDATA%\APIX Map Studio\thumbs`), pri prejdení myšou sa ukáže veľký náhľad.
- Textúry, ktoré exportér nenájde (GR2 má uloženú cestu `d:\…`), sa dohľadajú vedľa zdrojového
  modelu v packu alebo podľa hernej cesty a prevedú cez texconv na PNG s názvom, ktorý čaká FBX.
- Voľné pokladanie: objekt sadne na to, čo je pod kurzorom (terén alebo iný objekt, napr. strecha), pri
  pohľade do oblohy sa položí do vzduchu. **Alt + koliesko** alebo **PgUp / PgDn** ho zdvihne / zníži
  (Shift po 2 m, Ctrl po 10 cm), **Home** ho vráti na povrch. Platí aj pre prefaby a pre už vybrané objekty
  (každé stlačenie = jeden krok Späť). Posun úchytmi do strán sleduje terén, ale objekt si drží svoju výšku nad ním
  (zdvihnutý objekt sa už nevráti na zem); test `test/lift-demo.js`.
- Pri pokladaní ukazuje žltý obrys stopy objektu na zemi, **Shift+R** otáča o 15° (R o 45°) a pri vybraných
  objektoch zarovná rotáciu na 15° mriežku. Knižnica má zoznam **Posledné** (naposledy položené objekty).
- Výber kliknutím, posun (W) a rotácia (E) úchytmi, položenie na terén (G), duplikovanie (Ctrl+D),
  mazanie (Del), späť/znova (Ctrl+Z / Ctrl+Y), presné hodnoty v paneli Vlastnosti.
- Uloženie (Ctrl+S) zapíše `AreaData.txt` každého terénu presne vo formáte editora
  (overené testom `npm test` – súbor po načítaní a uložení je bajt po bajte rovnaký).
  Pôvodné súbory sa pred uložením zálohujú do `<mapa>\_studio_backup\<čas>`.

### Terén (fáza 2, karta „Terén“ alebo kláves T)

- Nástroje: **Zdvihnúť / Znížiť / Vyhladiť / Zarovnať** výšku, **Textúra**, **Voda**, **Atribúty**
  (blokovanie, voda, bez PvP – zobrazujú sa farebne, keď je nástroj aktívny).
- Ľavé tlačidlo maľuje, Ctrl obráti (znížiť, zmazať), Alt + klik vezme výšku / textúru / hladinu
  z terénu. Pravé tlačidlo otáča kameru, stredné posúva. `[` a `]` menia veľkosť štetca.
- Textúry: paleta textúr mapy s náhľadmi; „Pridať textúru…“ ponúkne všetky textúry terénu
  z packov (`ymir work/terrainmaps`) a pridá ich do sady textúr mapy s hernou cestou `d:/ymir work/…`.
- Zobrazenie zvláda 12 textúr na jeden terén 256×256 m (najpoužívanejšie); viac sa uloží, ale
  nezobrazí.
- „Položiť všetky objekty na terén“ po zmene výšky.
- Uloženie zapíše len zmenené súbory (`height.raw`, `tile.raw`, `water.wtr` + `NumWater`
  v `AreaProperty.txt`, `attr.atr`, sada textúr) a zálohuje ich. Nepoužité výšky vody sa vynechajú.
- Späť / Znova funguje spoločne pre objekty aj terén (jeden ťah štetcom = jeden krok).

### Vzhľad a pohodlie (fáza 4)

- **Stromy**: skutočná geometria SpeedTree – `tools/spt2json` (malý x86 nástroj nad `SpeedTreeRT.dll` klienta,
  zdroj a `build.cmd` sú v repozitári) vypočíta strom rovnako ako klient (veľkosť zo `.spt`, seed 1) a uloží vetvy,
  listy a textúry do `model-cache\tree\<crc>\tree.json`. Listy sú karty natočené ku kamere ako v hre a pre tiene
  majú neviditeľné prekrížené karty. Keď nástroj alebo DLL chýba, ostáva náhradný strom z textúr.
- **Efekty** (`.mse`): častice sa simulujú ako v EffectLib (emitor, životnosť, gravitácia, odpor vzduchu, farba
  a priehľadnosť v čase, miešanie) a mesh prvky (`.mde`) sa prehrávajú po snímkach; v knižnici majú živé náhľady.
- **Dungeon bloky** sa načítajú ako modely (`dungeonblockfile`).
- **Ambience** (zvuky prostredia) sa čítajú a ukladajú do `AreaAmbienceData.txt` ako v klientovi (dosah, podiel plnej
  hlasitosti), na mape modrý reproduktor s kruhmi dosahu, v paneli Vlastnosti dosah a hlasitosť.
- **Prostredie** (`.msenv`): v paneli Vlastnosti (keď nie je vybraný objekt) sa vyberá prostredie
  mapy; zobrazí sa slnko, okolité svetlo, hmla a obloha (6 textúr alebo farebný prechod). Uloží sa do
  `Setting.txt` (`Environment`). Hmla je predvolene odsunutá pre pohľad z diaľky, „Hmla ako v hre“ zapne
  skutočné vzdialenosti.
- **Nová mapa** (Ctrl+N): názov, veľkosť v terénoch a šablóna – prázdna rovina so základnou textúrou,
  ostrov alebo **dungeon** (miestnosti a chodby vytesané 20 m do skaly, útesy blokované, boss miestnosť
  najďalej od štartu, prostredie `dark.msenv`; `mapgen/maps/dungeon.js`).
- **Viac objektov naraz**: Shift + klik pridá/odoberie, Shift + ťahanie vyberie obdĺžnikom, Ctrl+A všetko.
  Úchyty posúvajú a otáčajú celú skupinu okolo jej stredu. Ctrl+C / Ctrl+V kopíruje skupinu pod kurzor
  (každý kus sadne na terén), Ctrl+D duplikuje, Del maže.
- **Prefaby**: skupinu ulož v paneli Vlastnosti ako prefab; v knižnici pod „Prefaby“ ju vložíš celú
  (R otočí o 45°, Shift + klik viac kusov). Ukladajú sa do `%APPDATA%\APIX Map Studio\prefabs`.
- **PvP aréna** (`node mapgen/mapgen.js mapgen/maps/arena.js` → `apix_pvp_arena`): izolovaná dueľová plocha
  za múrom a priekopou (blokované), tribúny a námestie bez PvP, cesta, jazero a les v údolí.
- Overené aj mapy 2×2 (dungeon 512×512 m, terény na seba nadväzujú).

### Kontrola a export (fáza 3, tlačidlá v hornej lište)

- **Kontrola** pred nasadením: objekty mimo mapy, CRC mimo knižnice klienta, chýbajúce modely,
  objekty vo vzduchu / pod terénom / vo vode, chýbajúce textúry terénu, viac ako 12 textúr na terén,
  voda bez atribútu voda a naopak, neuložené zmeny. Pri položke „ukázať“ priblíži objekt.
- **Export** vykreslí mapu zhora (s objektmi):
  - `minimap.dds` do každého terénu (256×256, nekomprimovaný BGRX ako z WorldEditora; starý sa zálohuje),
  - atlas do `<mapa>\_export\atlas\` (`atlas.sub` + `<mapa>_atlas.dds` + `preview.png`);
    do klienta patrí do `d:/ymir work/ui/atlas/<mapa>/`.

### MCP pre Clauda

`mcp/server.mjs` je MCP server zaregistrovaný v `APIX\.mcp.json` ako `mapstudio`. Aplikácia pri štarte
otvorí lokálny ovládací kanál (127.0.0.1, náhodný port a token v
`%APPDATA%\APIX Map Studio\control-endpoint.json`) a MCP server cez neho volá tie isté funkcie ako UI,
takže funguje Späť aj označenie neuložených zmien.

Nástroje: `mapstudio_launch`, `_status`, `_open_map`, `_list_objects`, `_search_library`,
`_add_objects`, `_update_objects`, `_delete_objects`, `_terrain_height`, `_paint`, `_add_texture`,
`_ground_all_objects`, `_undo`, `_redo`, `_save`, `_screenshot` (3D pohľad do PNG, voliteľne s kamerou),
`_window_screenshot`, `_check_map`, `_export`, `_new_map` (šablóny empty / island / dungeon),
`_list_environments`, `_set_environment`, `_list_prefabs`, `_save_prefab`, `_place_prefab`, `_list_spawns`,
`_add_spawns`, `_update_spawns`, `_delete_spawns`, `_set_town`, `_game_export` (staging do `_map_exports`, nenasadzuje). Pozície sú v metroch od severozápadného rohu mapy
(x na východ, y na juh, z výška).

### Ovládanie kamery (noclip)

Kamera lieta voľne a terén neovplyvňuje jej pohyb: **W/S** let tam, kam sa pozeráš, **A/D** do strán,
**E / medzerník** hore, **Q / C** dole, **Shift** 3,5× rýchlejšie. **Pravé tlačidlo** = rozhliadanie
na mieste, **stredné** = posun, **koliesko** = let dopredu/dozadu. Rýchlosť sa riadi výškou nad terénom
(pri zemi pomaly a presne). Ľavé tlačidlo je len na prácu: výber, obdĺžnik, úchyty, štetce.
Úchyty posun/rotácia: **1 / 2**. Stratil si sa (v nebi, pod terénom)? **H** alebo tlačidlo „Mapa“ vráti kameru nad celú mapu.

### Postava (kláves P alebo tlačidlo „Postava“)

Klikni na terén a postaví sa tam postava – v lište vyberieš **bojovníka, ninju, suru alebo šamana** (model
začiatočníka, vlasy a animácie státia, chôdze a behu z `pc/<trieda>`, prevedené do `model-cache\pc\<trieda>`).
**WASD** beh, **Shift** chôdza, **medzerník** skok, **pravé tlačidlo** otáča kameru, **koliesko** približuje,
**P** postaví postavu inam, **Esc** späť do editora.
Blokované miesta, voda a **objekty** (ich kolízne tvary z `.mdatr`, rovnaké ako v exporte pre server) postavu
zastavia, pri prekážke sa šmýka pozdĺž nej; **Noclip (N)** cez všetko pustí a postava chodí po hladine.
Testy: `test/walk-demo.js`, `test/walk-objects-demo.js` na mape `apix_pvp_arena`.

### Spawny (karta „Spawny“)

- Zoznam monštier a NPC z `mob_proto.txt` servera s anglickými menami (server sa len číta). Vyber monštrum,
  nastav druh (monštrá, skupina, agresívna skupina, NPC), počet, polomer a respawn a **klikni na terén**.
- Značka ukazuje model monštra v jeho čakacej animácii, štítok a polomer na teréne. Klik na značku ju vyberie
  (polia ju upravia), **ťahaním** sa presunie, **Del** zmaže, Späť / Znova funguje.
- **Town** (kde sa hráči objavia, `Town.txt`) nastavíš tlačidlom a klikom na terén (zlatá značka).
- Ctrl+S uloží spawny aj Town do `<mapa>\_studio\spawns.json`; export z nich spraví `regen.txt` a `npc.txt`.
- **Zóny (Z)**: atribúty servera cez celý terén (červená blokované, modrá voda, zelená bez PvP, bez farby PvP).
- Kontrola mapy hlási chýbajúci Town, Town na blokovanej bunke alebo v PvP zóne, spawny na blokovaných bunkách,
  NPC v PvP zóne a monštrá do 10 m od Townu.

## Súradnice

Scéna je v metroch, os Y hore: `scéna = (x/100, z/100, −y/100)` z Metin2 cm (y v AreaData je záporné).
Terén: bunka × 2 m, výška = surová hodnota / 200. Formáty súborov: `mapgen/README.md`.

## Testovanie bez klikania

```
electron . --open <priečinok mapy> --screenshot <obrázok.png>
```

Otvorí mapu, počká na modely, uloží snímku okna a skončí. S `--eval <skript.js>` pred snímkou
spustí skript v okne (napr. `test/paint-demo.js` namaľuje ťahy všetkými štetcami, uloží a vráti
výsledok kontrol – spúšťaj ho len na kópii mapy). `npm test` overí, že všetky súbory mapy sa po
načítaní a uložení nezmenia.

### Export do hry (fáza 5)

Najjednoduchšie tlačidlom **Do hry…**: navrhne index mapy a voľné miesto vo svete (číta `map/index`, `Setting.txt`
máp servera a `atlasinfo.txt` klienta; mapa, ktorá už v hre je, si ponechá svoj slot), uloží mapu, vykreslí
minimapu, atlas a tiene a pripraví súbory do `APIX\_map_exports\<mapa>_<čas>` s reportom. **Nič nenasadzuje.**

Z príkazového riadku (najprv v Map Studiu **Export**):

```
node mapgen/export-game.js <priečinok mapy> --index 90 --base 665600 25600 --goto arena --out ..\_map_exports\<mapa>_<dátum>
```

Voľby: `--town <x> <y>` (inak Town z karty Spawny, inak stred mapy s varovaním), `--no-object-collision`.

Pripraví do stagingu (mimo hry nič nemení):
- `server/<mapa>/`: `Setting.txt` (BasePosition), `Town.txt` (spawn v metroch), `server_attr`
  (sektory 64 m, bunky 0,5 m, LZO; preložené z `attr.atr` – blokované, voda, bez PvP – plus **OBJECT (128)** pod
  objektmi podľa ich kolíznych tvarov z `.mdatr` klienta do výšky 2,2 m, stromy kmeňom), `regen.txt` a `npc.txt`
  zo spawnov, prázdne boss/stone,
- `client/<mapa>/`: pack s mapou, **tieňmi** (`shadowmap.raw/.dds` vypočítané Exportom zo slnka prostredia
  na teréne aj modeloch; bez Exportu plne osvetlené), sadou textúr a atlasom,
- `server_attr_preview.png` (1 px = 0,5 m: červená blok, modrá voda, zelená bez PvP, žltá objekty),
- `manifest.json`: hashe súborov, počty buniek, spawny, varovania a kroky nasadenia.

Kontroly: BasePosition násobok 25600, Town nesmie byť na blokovanej bunke ani pod objektom, `server_attr` sa dá
dekódovať (`mapgen/lzo.js`) a sedí bunka po bunke s `attr.atr` – overuje `npm test` (`test/export.js`).

### Podklady pre kvalitné mapy (fáza 6)

- **Katalóg assetov** `node tools/build-catalog.js` (prvýkrát ~5 min, potom z cache) → `%APPDATA%\APIX Map Studio\catalog.json`.
  Pre každý objekt knižnice: skutočné rozmery z modelu (`tools/gr2info`, klientska Granny 2.4; stromy cez `tools/spt2json`),
  kolízia z `.mdatr` (pôdorys do výšky postavy), textúry a či existujú, kategória, zdroj (client / fem / editor), či je v hre
  (pack v `Index`) a ručné hodnotenie z `data/ratings.json`. Varovania: `granny-v7` (Granny 2.4 klienta ho nenačíta – v hre
  neviditeľný; studňa, krámy, pavilóny, ruiny z dl2_*), `editor-only`, `texture-missing`, `huge`, `tiny`, `no-collision`,
  `needs-packing` (Fem). V knižnici sa pri objekte ukazuje veľkosť a ⚠ / ⓘ s dôvodom; MCP `mapstudio_catalog` filtruje podľa
  kategórie, veľkosti, kolízie a použiteľnosti (aj bez spusteného Map Studia).
- **Analýza máp** `node tools/analyze-maps.js <výstup> meno=<priečinok mapy> …` – hustota a rozostupy stromov, zhlukovanie
  (Clark-Evans), skladba objektov, prázdne plochy, výškové rozpätie a sklony, textúry podľa sklonu; porovnávacia tabuľka v `analysis.md`.
- **Cesty a rieky po krivke** – MCP `mapstudio_spline` (API `spline`): road vyrovná terén do plynulého profilu s obmedzeným
  stúpaním, nepravidelný okraj a krajnica; river vyreže koryto klesajúce po prúde, brehy, hladinu, atribút voda (+ block). Jeden krok Späť.
  Test: `node test/run-eval.js <mapa> test/spline-demo.js <výstup>` (beží na kópii mapy).
- Stromy, ktorých `.spt` uvádza textúru listov bez prípony (CompositeMapB1/B2, taoshuleaves, Bamboos…), sa už kreslia s textúrou
  (klient číta `<meno>.dds`); `.dds`, ktorý je v skutočnosti PNG (spruceleaves.dds), sa načíta podľa obsahu.

### Generovanie (fáza 7)

- **Terén** – MCP `mapstudio_terrain_generate` (`renderer/terraingen.js`): reliéf zo šumu (fBm, hrebene, warp), hory okolo
  hrateľného boxu (`rim`), menej reliéfu pri cestách (`calm`), erózia vodou (kvapky) a zosuvmi (talus), rovné plochy (`flats`),
  prechod do pôvodného terénu na okraji oblasti. Jeden krok Späť.
- **Textúry** – `mapstudio_auto_texture` (`renderer/autotexture.js`): pravidlá podľa sklonu, výšky, vzdialenosti od vody a šumu,
  prvé zhodné vyhrá, roztrhané okraje, `keep` nechá cesty / dlažbu.
- **Biómy** – `mapstudio_scatter` (`renderer/scatter.js`): vrstvy so zhlukmi (háje), maskou (lesné škvrny s rednúcim okrajom),
  podrastom pri stromoch inej vrstvy (`near`), presným počtom (`count`, dominanty), `blocked: "only"` (les na blokovaných kopcoch),
  zapustením skál (`sink`); rozostupy podľa skutočných rozmerov z katalógu, mimo ciest, vody a rezervovaných plôch. `dryRun` vráti
  dôvody odmietnutia.
- Testovacia inštancia (`--open … --eval …`) sa spustí aj na mape bez objektov. Test: `node test/gen.js` (v `npm test`).
- Ukážka: `_exports/apix_farm_01b/tools/build.js` postaví celú farmovaciu mapu za ~5 s; čísla porovnané s oficiálnymi mapami
  (`tools/analyze-maps.js`).

### Predlohy z oficiálnych máp (fáza 8)

- **Zdroje** – `mapstudio_list_sources` (`mapread.js`): oficiálne mapy z packu klienta a mapy WorldEditora; `loadMap` / `readRegion`
  čítajú výšky, textúry, atribúty, vodu a objekty bez Electronu.
- **Import oblasti** – `mapstudio_import_region` (`renderer/importregion.js`): skopíruje obdĺžnik inej mapy (terén, textúry,
  atribúty, vodu, objekty) na zvolené miesto, otočený po 90° v smere hodín, výškovo napojený na okraj (`heightOffset: "match"`)
  a rozmazaný do okolia nepravidelným okrajom. Objekty nepoužiteľné v hre (katalóg) vynechá, upozorní na > 12 textúr na terén.
  Test: `node test/run-eval.js <prázdna 2×1 mapa> test/import-demo.js <out> --inplace` (140/140 objektov na správnom mieste a s
  otočením).
- **Terén navrch** – `terrain_generate` s `mode: "add"` pridá reliéf alebo hory k existujúcemu terénu (bez erózie).
- **Atlas** – `python tools/map_atlas.py <mapa> <out.png> [--attr]`: minimapa s metrovou mriežkou a blokovanými bunkami, na
  výber oblastí.
- **Prefaby z máp** – `node tools/mine-prefabs.js a1=<dir> …`: nájde skupiny (budova s rekvizitami, skaly, háje) a uloží ich ako
  prefaby `src_<mapa>_<typ>_NN`.

## Ďalšie fázy

2. ~~Štetce terénu (výška, textúry, voda, atribúty).~~ Hotové.
3. ~~Kontrola, minimapa a atlas, MCP pre Clauda.~~ Hotové.
4. ~~Stromy, prostredie, nová mapa so šablónami, výber viacerých objektov, prefaby.~~ Hotové.
5. ~~Mapa do hry: serverové súbory, pack klienta, spawny, kolízie objektov, tiene.~~ Hotové.
