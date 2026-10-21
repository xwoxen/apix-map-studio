# Nočná práca na APIX Map Studio – 22. 10. 2026

Vetva **`night/2026-10-22`** (z `main`, pushnutá na GitHub, **do `main` nemergnutá**). Všetkých 7 úloh zo zadania je
hotových a k nim 4 vylepšenia navyše. Každá vec má vlastný commit, test a `npm test` prešiel po každom commite.

Práca trvala približne 1 hodinu, nie 5: úlohy boli hotové a otestované skôr. Radšej som skončil s overeným
stavom, než aby som pridával zmeny len na vyplnenie času.

**Čo som nerobil (podľa pravidiel):**
- Žiadne nasadenie, žiadny zásah do `apix-server/`, `apix-client/` ani Dockeru (server a klient som len čítal).
- Tvoje otvorené Map Studio som nereštartoval ani naň nevolal MCP zápisy, beží stále verzia z `main`.
- Mapy vo `we_remix_v59__20260716-1745` som nemenil. Všetky testy bežali na kópiách v scratchpade.
- Testovacie stagingy z `APIX\_map_exports` som po testoch zmazal; ostal len pôvodný `apix_pvp_arena_20261021`.

## Ako to vyskúšať

```
cd C:\Users\micha\Documents\APIX\apix-map-studio
git checkout night/2026-10-22
npm test
```

Potom reštartovať Map Studio (urobím to na tvoj pokyn, ako vždy). Návrat na pôvodnú verziu: `git checkout main`.

## Hotové

| # | Čo | Commit | Ako vyskúšať | Čím overené |
|---|----|--------|--------------|-------------|
| 1 | **Kolízie objektov na serveri**: export zapíše do `server_attr` flag OBJECT (128) pod objektmi podľa ich skutočných kolíznych tvarov z klientskych súborov `.mdatr` (roviny, valce, gule, boxy) do výšky 2,2 m nad základňou; stromy kmeňom. Prepínač `--no-object-collision`, Town nesmie byť pod objektom. Export pribalí `server_attr_preview.png`. | `86ee7a0` | `node mapgen/export-game.js …` alebo tlačidlo **Do hry…**, potom pozri `server_attr_preview.png` (žlté = objekty) | Aréna: 698 buniek OBJECT. Každý ohniskový kôš (8), stĺp (12), stan (2), ohnisko a 57 testovaných borovíc má bunky pri sebe, žiadna bunka nie je ďalej ako 8 m od objektu, Town ostal voľný. `test/export.js` |
| 2 | **Tiene terénu**: tlačidlo **Export** spočíta tieň zo slnka prostredia (`.msenv`) na teréne aj modeloch a zapíše `shadowmap.raw` (R5G5B5, 16–31) a `shadowmap.dds` (DXT1, hlavička ako Sands). Export do hry ich pribalí, bez nich dá plne osvetlené. | `325bc48` | Export v Map Studiu → `000000\shadowmap.raw` | `test/shadow-demo.js`: 91 % terénu na slnku, tiene stromov, stanov, stĺpov a kameňov sú vidieť. Plne osvetlená verzia je bajtovo zhodná s tým, čo je v hre nasadené. Zobrazenie editora po exporte sa nezmenilo. |
| 3 | **Spawny**: nová karta **Spawny**, zoznam monštier a NPC z `mob_proto` servera s menami. Klik na terén položí monštrá / skupinu / agresívnu skupinu / NPC s počtom, polomerom a respawnom. Uloženie do `<mapa>\_studio\spawns.json`, export do `regen.txt` / `npc.txt`, MCP `mapstudio_list/add/update/delete_spawns`. | `7c1ff48` | Karta Spawny → vyber „Wild Dog“ → klik na terén → Ctrl+S | `test/spawn-demo.js` (klik, API, Späť/Znova, uloženie). Riadky exportu majú presne formát `regen.txt` servera a sú kontrolované podľa `regen.cpp` v `test/export.js`. |
| 4 | **Postava**: objekty blokujú chôdzu (rovnaké tvary ako v exporte, pri prekážke sa postava šmýka), **medzerník** = skok, v lište výber **bojovník / ninja / sura / šaman**. | `2211444` | **P** → klik → beh do stĺpa | `test/walk-objects-demo.js`: stĺp zastaví postavu 0,9 m od stredu, noclip prejde, skok ~0,9 m a dopad, ninja má všetky 3 animácie. `test/walk-demo.js` bez zmeny. |
| 5 | **Pokladanie**: ghost sa prepočíta max. 1× za snímku, žltý obrys stopy na zemi, **Shift+R** otočí o 15° (pri výbere zarovná rotáciu na 15°), zoznam **Posledné** v knižnici. | `cb78fd2` | Pokladaj lampu, Shift+R | `test/place-extras-demo.js` (obrys viditeľný, 2× Shift+R = 30°, 52° → 45°, „Posledné“), `test/free-place-demo.js` stále prechádza |
| 6 | **Zóny a Town**: **Z** / tlačidlo Zóny ukáže atribúty servera s legendou (blok, voda, bez PvP; bez farby = PvP). V karte Spawny sa klikom nastaví **Town**. Kontrola mapy hlási chýbajúci Town, Town na bloku alebo v PvP, spawny na bloku, NPC v PvP a monštrá pri Towne. MCP `mapstudio_set_town`. | `b55a36c` | Z, karta Spawny → „Nastaviť Town“, Kontrola | `test/zones-demo.js` (legenda, Town na námestí bez varovania, Town na lúke → `town_pvp`, spawn na múre → `spawn_blocked`) |
| 7 | **Test exportu v `npm test`**: export kópie arény, hashe podľa manifestu, dekódovanie každého sektora `server_attr`, zhoda s `attr.atr` bunka po bunke, OBJECT pri objektoch, voľný Town, riadky regen/npc, formát tieňov. | `419e891` | `npm test` | prechádza |

### Navyše

| Čo | Commit | Overené |
|----|--------|---------|
| Dialóg **Do hry…**: navrhne index a voľné miesto vo svete (číta `map/index`, `Setting.txt` máp a `atlasinfo.txt`; aréna si ponechá index 90 a svoju polohu), uloží, vykreslí minimapu, atlas a tiene, pripraví staging do `APIX\_map_exports\<mapa>_<čas>` a ukáže report. Nič nenasadzuje. MCP `mapstudio_game_export`. Export varuje, keď Town nie je nastavený. | `26f50ba` | `test/game-export-demo.js` (dialóg, export cez API aj cez formulár, report) |
| **Ťahanie spawnu** myšou, jeden krok Späť na jedno ťahanie | `c6b4d49` | `test/spawn-drag-demo.js` |
| Pri spawne sa zobrazí **model monštra/NPC** v čakacej animácii (priečinok z klientskeho `npclist.txt`) | `4b388ad` | `test/spawn-models-demo.js`, screenshot (vlk, pes, kováč) |
| Manifest rozlíši **novú mapu** a **aktualizáciu** mapy, ktorá už v hre je (pri aréne len nahradiť súbory, index/GAME_MAP_ALLOW/Index/atlasinfo ostávajú) | `427dd20` | export kópie arény → `mode: update`, s iným indexom → `mode: new` |
| README (aj opravené stratené spätné lomky v cestách) a `APIX_KNOWLEDGE.json` | `44dcba4` | – |

Pod kapotou: čítanie assetov a knižnice sa presunulo z `main.js` do `assets.js`, aby ho mohli používať aj nástroje
z príkazového riadku. Staršie UI testy po tejto zmene prechádzajú: `controls`, `gizmo`, `selection`, `place-click`, `paint`.

## Čo nefunguje / obmedzenia

- **Nič z toho nie je overené v hre.** Kolízie objektov, tiene aj spawny sú overené len formátom súborov a testami.
  Aréna v hre je stále verzia z 21. 10. (bez OBJECT, plne osvetlená, bez spawnov).
- Modely bez `.mdatr` (napr. machové kamene pri jazere) nemajú kolíziu, rovnako ako v hre. Počet je v manifeste
  (`serverAttr.objectCollision.noCollision`).
- Kontrola mapy v Map Studiu kontroluje Town a spawny len proti atribútom terénu. Objekty kontroluje až export.
- Skupiny (`g`, `ga`) berú vnum skupiny z `group.txt`, Map Studio ho zatiaľ neponúka v zozname (treba ho zadať ručne).
- `free-place-demo.js` je napísaný pre arénu (hľadá stan). Na inej mape zlyhá, nie je to chyba aplikácie.
- Pri viacerých spawnoch naraz cez MCP je každý samostatný krok Späť.

## Čo navrhujem ďalej

1. **Nasadiť arénu znova** s kolíziami, tieňmi a spawnmi. V Map Studiu nastaviť Town (námestie), prípadne spawny,
   **Do hry…**, a potom nasadenie podľa manifestu (`mode: update`) – s tvojím súhlasom a zatvoreným klientom.
2. Overiť v hre: tiene pri stĺpoch a stromoch, že sa nedá prejsť cez stĺpy a stany, spawn na námestí.
3. Zoznam skupín z `group.txt` v karte Spawny (s menami monštier v skupine).
4. Teleport do arény v GM paneli (zmena klientskeho `root`) – vyžaduje zásah do klienta, preto som ho v noci nerobil.
5. Zlúčiť vetvu do `main` po tvojej kontrole.
