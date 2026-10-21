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

## Súradnice

Scéna je v metroch, os Y hore: `scéna = (x/100, z/100, −y/100)` z Metin2 cm (y v AreaData je záporné).
Terén: bunka × 2 m, výška = surová hodnota / 200. Formáty súborov: `mapgen/README.md`.

## Testovanie bez klikania

```
electron . --open <priečinok mapy> --screenshot <obrázok.png>
```

Otvorí mapu, počká na modely, uloží snímku okna a skončí.

## Ďalšie fázy

2. Štetce terénu (výška, textúry, voda, atribúty).
3. Export: minimapa a atlas z vlastného vykresľovania, serverové súbory.
4. MCP do aplikácie (úpravy s Claudom naživo), šablóny dungeonov, spawny, skutočné stromy.
