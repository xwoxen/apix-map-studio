# APIX mapgen

Generátor máp pre WorldEditor Remix / Metin2: mapu zapíše priamo do súborov, bez editora.
Editor slúži už len na prezeranie, minimapu, tiene a export.

Overené 2026-10-21: `maps/ostrov.js` vytvorí `apix_gen_ostrov` (1×1, 87 objektov) a editor ho
načíta celý – terén, 4 textúry, more, atribúty aj objekty.

## Použitie

```
node mapgen/mapgen.js mapgen/maps/ostrov.js
node mapgen/mapgen.js <spec.js> --name <nazov_mapy> --out <koreň editora>
```

- Predvolený výstup je koreň editora `C:\Users\micha\Documents\we_remix_v59__20260716-1745`
  (`<nazov>\…` a `textureset\<nazov>.txt`).
- Do existujúceho priečinka zapíše len vtedy, ak ho predtým vytvoril mapgen (súbor `.mapgen`),
  takže ručne robené mapy neprepíše.
- V editore potom **Load** → priečinok mapy. Editor musí byť spustený cez
  `scripts\worldeditor\start.ps1` (jednotka D: pre modely a textúry).
- Po pregenerovaní stačí v editore **Reload**; pri otázke na uloženie daj **Nie**.

## Spec mapy

Modul, ktorý exportuje:

| pole | význam |
| --- | --- |
| `name`, `sizeX`, `sizeY` | názov a veľkosť v terénoch (1 terén = 128 buniek = 256 m) |
| `height(x, y)` | surová výška v bunke; 32767 = rovina, 1 m = 200. Volá sa aj pre okraj −1 … size×128+1 |
| `textures` | zoznam `{ file: "d:/ymir work/terrainmaps/…" }`; poradie = číslo textúry od 1 |
| `texture(x, y, heightAt)` | číslo textúry pre polbunku (x, y môžu byť x.5) |
| `water` | `{ level, covers(x, y, heightAt) }`; level v surových jednotkách |
| `attr(x, y, heightAt)` | pole z `"block"`, `"water"`, `"banpk"` pre každý meter |
| `objects()` | `[{ crc, cx, cy, yaw }]` v bunkách; výšku z dopočíta generátor z terénu |
| `environment` | voliteľne `.msenv` |

Súradnice v spec sú vždy globálne bunky (1 bunka = 2 m). Generátor ich sám prevedie na
formáty jednotlivých súborov.

## Formáty súborov (overené na uložení z editora v59)

| súbor | obsah |
| --- | --- |
| `height.raw` | 131×131 uint16 LE na terén; `raw(i, j)` = bunka `(i−1, j−1)`, rám sa prekrýva so susedmi |
| `tile.raw` | 258×258 bajtov, číslo textúry na polbunku; `tile(c, r)` = bunka `((c−1)/2, (r−1)/2)` |
| `attr.atr` | `u16 0x0A4A, u16 256, u16 256` + 256×256 bajtov príznakov (1 block, 2 voda, 4 bez PvP) |
| `water.wtr` | `u16 0x1532, u16 128, u16 128, u8 počet` + 128×128 indexov (255 = bez vody) + počet × int32 výška |
| `AreaData.txt` | objekty: `x  −y  z` v cm (y záporné, z = výška/2), CRC, `yaw#pitch#roll`, bias; **na konci `ObjectCount N`**, inak editor objekty nenačíta |
| `AreaProperty.txt` | `NumWater` = počet výšok vody |
| `Setting.txt`, `MapProperty.txt`, `textureset\*.txt` | text s CRLF |

Všetky mriežky majú rovnakú orientáciu (riadok = bunka y).

## Čo zatiaľ chýba

- Mapy väčšie ako 1×1 sú pripravené v kóde (okraje terénov sa prekrývajú), ale ešte neboli
  overené v editore.
- Minimapa, tiene (`shadowmap`) a export pre klienta/server – stále cez editor.
- Serverové súbory (`regen.txt`, `server_attr`) generátor zatiaľ nepíše.
