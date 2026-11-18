# Dungeon Atlas: sources, licensing, coverage

## Pipeline

```
upstream (network, by hand)          checked-in                         served
wago.tools Classic Era DB2 ─┐   backend/src/Atlas/data/sources/*.json   backend/src/Atlas/data/atlas.json
AzerothCore world DB ───────┴─► (trimmed extracts with source,        ─► (normalized; provenance per fact)
  fetchDungeonAtlasSources.mjs     revision, retrievedAt, license)        importDungeonAtlas.mjs
```

- `cd backend && node scripts/fetchDungeonAtlasSources.mjs [--azerothcore-ref <sha>]`
  refreshes the extracts (only rows the atlas uses).
- `cd backend && node scripts/importDungeonAtlas.mjs` re-normalizes offline.
  Idempotent: the same extracts always write the same file. `--check` fails if
  the file is stale or breaks an invariant (also checked by
  `test/dungeonAtlas.test.js`).
- No database storage, so no migration. The data ships inside `backend/src`, so
  the existing Dockerfile includes it.
- Adapters: `backend/src/Atlas/atlasNormalize.js` (`adaptWagoClassicEra`,
  `adaptAzerothCore`, `normalize`, `atlasProblems`); readers in `atlasSources.js`.

## Sources

| Source | What we take | Tier / confidence | Licence / attribution |
|---|---|---|---|
| wago.tools DB2 export, `product=wow_classic_era` (client build 1.15.8.x at retrieval) | `Map` (names, kind, size), `LFGDungeons` (level bands, wings), `DungeonEncounter` (boss list + order, difficulty 0/1 only), `AreaTrigger` (entrance trigger positions), `UiMapAssignment` + `UiMap` (zone frames), `AreaTable` (dungeon zone area ids) | `classic-reference`, high (entrances: medium) | Factual data from Blizzard's World of Warcraft Classic Era client, via https://wago.tools. Names and numbers only; no art, text bodies or models are redistributed. |
| AzerothCore `azerothcore-wotlk` world DB, commit `6ffb62abb867dabb258de6813ff5d06d6b011543` | `areatrigger_teleport` (which trigger enters which map), `quest_template` (quests whose QuestSortID is the dungeon's zone, ids ≤ 9299, placeholders dropped), `creature_queststarter`, `creature_template` (names; boss npc ids by unique exact name) | `community-unverified`, medium | GPL-2.0, © AzerothCore contributors, https://github.com/azerothcore/azerothcore-wotlk. A WotLK 3.3.5 emulator database; vanilla content as the emulator models it. |

Neither source is the Forever client, so nothing is tiered `official-client` or
`forever-reference`, and nothing claims `verifiedForForever`. The loot catalog's
own addon evidence (`loot_window`, `encounter_journal`, …) remains the Forever
source of truth for loot; bosses link to it, not the other way round.

## Coverage (atlas.json at this commit)

- 26 vanilla dungeons and raids (Season of Discovery maps excluded).
- 23 with level bands (not AQ20, AQ40, Naxxramas: not in the client's LFG table).
- 23 with a world entrance (+ extra entrances for SM, Dire Maul, Stratholme,
  Maraudon, Uldaman, Gnomeregan, Molten Core). None for Blackwing Lair, Ruins of
  Ahn'Qiraj, Naxxramas (no outdoor trigger in the Classic Era client).
- 229 bosses (215 with npc ids). Gnomeregan and Sunken Temple have **no** boss list:
  the Classic Era client only carries their Season of Discovery encounters,
  which are left out.
- 373 quests across the dungeons' zones.
- 0 abilities, 0 rares, 0 dungeon floor maps, 0 art.

## Known gaps and caveats

- **Boss mechanics**: none published. No open, licensable, structured source was
  integrated in this pass (AzerothCore boss scripts are C++ and would need
  per-boss review). Any future Classic-derived ability must stay
  `verifiedForForever: false`.
- **Entrance zone names** near borders follow the site's map cells and can differ
  from the in-game zone: Blackfathom Deeps shows Darkshore (game: Ashenvale),
  Zul'Farrak shows Thousand Needles (game: Tanaris). The coordinates are exact
  world points regardless.
- **Quests** come from a WotLK-era emulator DB: some may have changed after 1.12,
  and dungeon-related quests whose zone is not the dungeon's are missed.
- `recommendedLevel`, `rares`, `creatures`, `maps`, `strategy`, art: not sourced.
