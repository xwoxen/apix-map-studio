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
- Knižnica ~3 900 objektov zo všetkých `apix-client\bin\pack\*\property` v poradí `Index`
  (prvý vlastník CRC vyhráva ako v klientovi) plus `property` z WorldEditora. Objekty, ktorých model v klientovi
  nie je, sa v zozname neukazujú (kontrola mapy ich však pozná).
  Každý objekt má 3D náhľad (vykreslí sa pri prvom zobrazení riadku, uloží sa do
  `%APPDATA%\APIX Map Studio\thumbs`), pri prejdení myšou sa ukáže veľký náhľad.
- Textúry, ktoré exportér nenájde (GR2 má uloženú cestu `d:\…`), sa dohľadajú vedľa zdrojového
  modelu v packu alebo podľa hernej cesty a prevedú cez texconv na PNG s názvom, ktorý čaká FBX.
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

- **Stromy**: SpeedTree (`.spt`) sa nedá vykresliť, preto Map Studio stavia náhradu z textúr kôry
  a lístia uložených vedľa `.spt` – kmeň a vetvy v tvare podľa druhu (ihličnan, listnáč, palma, ker).
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
`_list_environments`, `_set_environment`, `_list_prefabs`, `_save_prefab`, `_place_prefab`. Pozície sú v metroch od severozápadného rohu mapy
(x na východ, y na juh, z výška).

### Ovládanie kamery (noclip)

Kamera lieta voľne a terén neovplyvňuje jej pohyb: **W/S** let tam, kam sa pozeráš, **A/D** do strán,
**E / medzerník** hore, **Q / C** dole, **Shift** 3,5× rýchlejšie. **Pravé tlačidlo** = rozhliadanie
na mieste, **stredné** = posun, **koliesko** = let dopredu/dozadu. Rýchlosť sa riadi výškou nad terénom
(pri zemi pomaly a presne). Ľavé tlačidlo je len na prácu: výber, obdĺžnik, úchyty, štetce.
Úchyty posun/rotácia: **1 / 2**.

### Postava (kláves P alebo tlačidlo „Postava“)

Klikni na terén a postaví sa tam bojovník (model a animácie státia, chôdze a behu z `pc/warrior`,
prevedené do `model-cachepc`). **WASD** beh, **Shift** chôdza, **pravé tlačidlo** otáča kameru,
**koliesko** približuje, **P** postaví postavu inam, **Esc** späť do editora.
Blokované miesta a voda (atribúty mapy) zastavia postavu ako na serveri; **Noclip (N)** cez ne pustí
a postava chodí po hladine. Objekty zatiaľ nie sú pevné (kolízne tvary objektov sa nenačítavajú).
Test: `test/walk-demo.js` na mape `apix_pvp_arena`.

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

## Ďalšie fázy

2. ~~Štetce terénu (výška, textúry, voda, atribúty).~~ Hotové.
3. ~~Kontrola, minimapa a atlas, MCP pre Clauda.~~ Hotové.
4. ~~Stromy, prostredie, nová mapa so šablónami, výber viacerých objektov, prefaby.~~ Hotové.
5. Mapa do hry: serverové súbory (`server_attr`, `Town.txt`), pack klienta, spawny (`regen.txt`).
