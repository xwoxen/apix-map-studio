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
  (prvý vlastník CRC vyhráva ako v klientovi) plus `property` z WorldEditora.
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
3. Export: minimapa a atlas z vlastného vykresľovania, serverové súbory.
4. MCP do aplikácie (úpravy s Claudom naživo), šablóny dungeonov, spawny, skutočné stromy.
