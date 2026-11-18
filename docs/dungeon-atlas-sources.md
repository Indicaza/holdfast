# Dungeon Atlas: sources, licensing, coverage

## Pipeline

```
upstream (network, by hand)          checked-in                         served
wago.tools Classic Era DB2 ─┐   backend/src/Atlas/data/sources/*.json   backend/src/Atlas/data/atlas.json
AzerothCore world DB ───────┴─► (trimmed extracts with source,        ─► (normalized; provenance per fact)
  fetchDungeonAtlasSources.mjs     revision, retrievedAt, license)        importDungeonAtlas.mjs
```

- `cd backend && node scripts/fetchDungeonAtlasSources.mjs [--azerothcore-ref <sha>] [--content-only] [--from <dir>]`
  refreshes the extracts (only rows the atlas uses). `--content-only` refreshes
  just the content extracts (spawns, creature spells, spell facts); `--from`
  reads already-downloaded upstream files instead of the network.
- `cd backend && node scripts/importDungeonAtlas.mjs` re-normalizes offline.
  Idempotent: the same extracts always write the same file. `--check` fails if
  the file is stale or breaks an invariant (also checked by
  `test/dungeonAtlas.test.js`).
- No database storage, so no migration. The data ships inside `backend/src`, so
  the existing Dockerfile includes it.
- Adapters: `backend/src/Atlas/atlasNormalize.js` (`adaptWagoClassicEra`,
  `adaptAzerothCore`, `normalize`, `atlasProblems`); content (layout, rares,
  trash, abilities) in `atlasContent.js` (`extractCreatureContent`,
  `extractSpellContent`, `classifySpell`, `adaptContent`); readers in
  `atlasSources.js` (CSV, mysqldump, C++ script spell enums).

## Sources

| Source | What we take | Tier / confidence | Licence / attribution |
|---|---|---|---|
| wago.tools DB2 export, `product=wow_classic_era` (client build 1.15.8.x at retrieval) | `Map` (names, kind, size), `LFGDungeons` (level bands, wings), `DungeonEncounter` (boss list + order, difficulty 0/1 only), `AreaTrigger` (entrance trigger positions), `UiMapAssignment` + `UiMap` (zone frames), `AreaTable` (dungeon zone area ids) | `classic-reference`, high (entrances: medium) | Factual data from Blizzard's World of Warcraft Classic Era client, via https://wago.tools. Names and numbers only; no art, text bodies or models are redistributed. |
| wago.tools DB2 export, `product=wow_classic_era` (content extract `wago-classic-era-spells.json`) | `SpellName`, `Spell` (description), `SpellMisc` (cast time, passive, school), `SpellCastTimes`, `SpellInterrupts` (interrupt flags), `SpellCategories` (dispel type, mechanic), `SpellEffect` (effects, auras, targets) for the spells dungeon creatures cast; `AreaTable` continent areas named after a dungeon (their parent area is the dungeon's zone) | `classic-reference`; ability category/priority derived by rule: low | As above. Spell names, numbers and the client's own short descriptions only. |
| AzerothCore world DB, same commit (content extract `azerothcore-creatures.json`) | `creature` (spawn positions in the vanilla dungeon maps), `creature_template` (name, rank, levels, script name), `smart_scripts` (cast actions), `creature_template_spell`, the `SPELL_* = id` enums of C++ creature scripts under `src/server/scripts/{EasternKingdoms,Kalimdor}/<dungeon>/` (only files that register exactly one creature script), `instance_encounters` (boss list where the client has none) | `community-unverified`, medium | GPL-2.0, as below. |
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
- 240 bosses (226 with npc ids; 203 placed on the spawn layout; 176 with
  abilities). Gnomeregan (4) and Sunken Temple (7) bosses come from
  AzerothCore's `instance_encounters`: the Classic Era client only carries their
  Season of Discovery encounters.
- 638 boss abilities, 179 dangerous-trash creatures (elites with a
  high-priority spell, up to 8 per dungeon), 27 rares (rank 2/4 spawns).
- 26 spawn layouts (one per dungeon; see below). 0 map art, 0 portraits, 0
  dungeon artwork.
- 373 quests across the dungeons' zones.

## Abilities: how they are derived

Which creature casts which spell is the emulator's (community-unverified).
What a spell does is the Classic Era client's (cast time, interrupt flag,
dispel type, mechanic, effects). `classifySpell` turns those facts into a
category and priority by fixed rules, in order: loss-of-control mechanic →
`crowd-control` (high); mana drain/burn or area damage-over-time →
`healer-danger` (high); a cast the client flags interruptible → `interrupt`
(high for heals and casts ≥ 1.5 s); dispellable enemy aura → `dispel`;
enrage/frenzy or healing/armour debuffs → `tank-danger`; area damage or
knock-back → `positioning`; anything else → `special-mechanic`. Cosmetic,
passive and placeholder spells are dropped. Descriptions with unresolved
`# Dungeon Atlas: sources, licensing, coverage

## Pipeline

```
upstream (network, by hand)          checked-in                         served
wago.tools Classic Era DB2 ─┐   backend/src/Atlas/data/sources/*.json   backend/src/Atlas/data/atlas.json
AzerothCore world DB ───────┴─► (trimmed extracts with source,        ─► (normalized; provenance per fact)
  fetchDungeonAtlasSources.mjs     revision, retrievedAt, license)        importDungeonAtlas.mjs
```

- `cd backend && node scripts/fetchDungeonAtlasSources.mjs [--azerothcore-ref <sha>] [--content-only] [--from <dir>]`
  refreshes the extracts (only rows the atlas uses). `--content-only` refreshes
  just the content extracts (spawns, creature spells, spell facts); `--from`
  reads already-downloaded upstream files instead of the network.
- `cd backend && node scripts/importDungeonAtlas.mjs` re-normalizes offline.
  Idempotent: the same extracts always write the same file. `--check` fails if
  the file is stale or breaks an invariant (also checked by
  `test/dungeonAtlas.test.js`).
- No database storage, so no migration. The data ships inside `backend/src`, so
  the existing Dockerfile includes it.
- Adapters: `backend/src/Atlas/atlasNormalize.js` (`adaptWagoClassicEra`,
  `adaptAzerothCore`, `normalize`, `atlasProblems`); content (layout, rares,
  trash, abilities) in `atlasContent.js` (`extractCreatureContent`,
  `extractSpellContent`, `classifySpell`, `adaptContent`); readers in
  `atlasSources.js` (CSV, mysqldump, C++ script spell enums).

## Sources

| Source | What we take | Tier / confidence | Licence / attribution |
|---|---|---|---|
| wago.tools DB2 export, `product=wow_classic_era` (client build 1.15.8.x at retrieval) | `Map` (names, kind, size), `LFGDungeons` (level bands, wings), `DungeonEncounter` (boss list + order, difficulty 0/1 only), `AreaTrigger` (entrance trigger positions), `UiMapAssignment` + `UiMap` (zone frames), `AreaTable` (dungeon zone area ids) | `classic-reference`, high (entrances: medium) | Factual data from Blizzard's World of Warcraft Classic Era client, via https://wago.tools. Names and numbers only; no art, text bodies or models are redistributed. |
| wago.tools DB2 export, `product=wow_classic_era` (content extract `wago-classic-era-spells.json`) | `SpellName`, `Spell` (description), `SpellMisc` (cast time, passive, school), `SpellCastTimes`, `SpellInterrupts` (interrupt flags), `SpellCategories` (dispel type, mechanic), `SpellEffect` (effects, auras, targets) for the spells dungeon creatures cast; `AreaTable` continent areas named after a dungeon (their parent area is the dungeon's zone) | `classic-reference`; ability category/priority derived by rule: low | As above. Spell names, numbers and the client's own short descriptions only. |
| AzerothCore world DB, same commit (content extract `azerothcore-creatures.json`) | `creature` (spawn positions in the vanilla dungeon maps), `creature_template` (name, rank, levels, script name), `smart_scripts` (cast actions), `creature_template_spell`, the `SPELL_* = id` enums of C++ creature scripts under `src/server/scripts/{EasternKingdoms,Kalimdor}/<dungeon>/` (only files that register exactly one creature script), `instance_encounters` (boss list where the client has none) | `community-unverified`, medium | GPL-2.0, as below. |
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
 number tokens are left out (`details: null`). Every ability is
`source: "classic-reference"`, `verifiedForForever: false`.

## Maps and art

The Classic Era client has no dungeon floor maps (its UiMap table holds no
dungeon floors), and Blizzard's map, portrait and loading-screen art is not
licensed for redistribution here, so none is shipped or hot-linked. Instead
each dungeon has a **spawn layout** (`maps[0]`, `floorId: "layout"`,
`kind: "spawn-layout"`, `imageUrl: null`): every AzerothCore spawn position in
the map projected top-down (north up), quantized to a 1% grid. The site draws
it. Height is ignored, so multi-level dungeons overlap. Bosses and rares with
exactly one spawn are placed on it; creatures with several spawns are not (a
kind of creature is not a place).

## Known gaps and caveats

- **Boss mechanics** are emulator spell lists with rule-derived categories, not
  hand-written strategy: no `strategy` text. Bosses scripted in C++ files that
  also script their adds (most raid bosses, e.g. Molten Core, Blackwing Lair,
  Zul'Gurub) get abilities only from SmartAI / `creature_template_spell`, so
  their lists can be short or empty. None of it is verified on Forever.
- **Entrance zone names** prefer the zone the client files the dungeon under
  (its same-named continent area's parent), so Blackfathom Deeps reads Ashenvale
  and Zul'Farrak Tanaris. Dungeons without such an area still follow the site's
  map cells.
- **Quests** come from a WotLK-era emulator DB: some may have changed after 1.12,
  and dungeon-related quests whose zone is not the dungeon's are missed.
- `recommendedLevel`, `strategy`, map art, portraits and artwork: not sourced.
