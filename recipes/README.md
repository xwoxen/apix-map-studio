# Recepty máp

Overené stavebné skripty z hotových máp. Sú to šablóny: skopíruj, zmeň názov mapy, súradnice a zóny a spusti v Map Studiu:

    node test/run-eval.js <priečinok mapy> recipes/<recept>.js <výstup> --inplace

Bez `--inplace` beží na dočasnej kópii (aj so sadou textúr), čo sa hodí na skúšku nanečisto.

| Recept | Z ktorej mapy | Čo stavia |
|---|---|---|
| `farm_valley.js` | apix_farm_02 (Priesmyk Bieleho vlka) | farmovacia mapa ako príbeh: výškový plán údolia, hory okolo zón a ciest, zamrznutá rieka, cesty, paleta textúr, osada, dominanty zón, les na okraji údolí, plánovač metinov a skupín, zábery |
| `kitbash_official.js` | apix_farm_01c | mapa poskladaná z výrezov oficiálnych máp: import oblastí s otočením, hrebene na švoch, priesmyky, mesto z dediny a1 |
| `dungeon_arenas.js` | apix_dungeon_01 (Ľadová jaskyňa) | päť variant arény na jednej mape, stropy, regen súbory stagov a `arenas.json` |
| `dungeon_quest.js` | apix_dungeon_01 | quest dungeonu so stagmi z `arenas.json` (presun partie, vlny, pečate, boss s prídavkami) |
| `cave_ceiling.py` | apix_dungeon_01 | vlastný model klenby jaskyne (GR2 cez Fem zapisovač) |
| `live_square.js` | Yongan – námestie | úprava živej mapy: dlažba okolo bodu, lampy, lavice, záhony, lampy popri cestách, stánok; režim DRY |
| `live_bridge_post.js` | Yongan – most | malá úprava živej mapy s hľadaním miesta pre každý objekt; režim DRY |

## Postup (overený)

1. **Koncept:** príbeh, poradie zón, dominanty, výhľad z mesta na cieľ. Najprv nákres, potom terén.
2. **Paleta:** `mapstudio_palette` (snow, village_spring, autumn_farm, ice_dungeon). Nové assety najprv na hárok: `node tools/asset-sheet.js out.png <mená> --ground snow`.
3. **Terén a cesty:** `terrain_generate` (anchors, rim.open), `spline` (road / river / ridge), `auto_texture`.
4. **Objekty:** dominanty ručne s `face`, výplň cez `place_near` (najbližšie dobré miesto, `offPath`), les cez `forest_edge`, biómy cez `scatter`.
5. **Hranie:** `plan_spawns`, `reachability`.
6. **Kontrola:** `check_map` (rozpočet objektov, nedosiahnuteľné spawny, nepoužiteľné objekty), `tools/analyze-maps.js` oproti oficiálnej mape rovnakej témy, `shot_sheet` zábery.
7. **Varianty:** `mapstudio_snapshot` save / diff / restore pred každým väčším pokusom.
8. **Živá mapa:** Z hry… → úprava → Uložiť → Do hry… (rozdiel, balík, `deploy.sh` so zálohou) → nasadenie až po schválení.

## Čísla oficiálnych máp (cieľ)

- 7–10 objektov a 5–9 stromov na ha hrateľnej plochy, stromy v hájoch (Clark-Evans 0,45–0,6).
- Najviac 12 textúr na terén (Yongan má v sade 17).
- Objekty na terén: 30–250 (kontrola hlási nad 450).
- Rotácia v AreaData: zvislé otočenie je tretie číslo; Studio to rieši samo.
