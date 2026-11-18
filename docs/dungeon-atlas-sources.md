# Dungeon Atlas: sources, licensing, coverage

## Pipeline

```
upstream (network, by hand)          checked-in                         served
wago.tools Classic Era DB2 ─┐   backend/src/Atlas/data/sources/*.json   backend/src/Atlas/data/atlas.json
AzerothCore world DB ───────┴─► (trimmed extracts with source,        ─► backend/src/Atlas/data/reference-loot.json
  fetchDungeonAtlasSources.mjs     revision, retrievedAt, license)        (normalized; provenance per fact)
                                                                          importDungeonAtlas.mjs
```

- `cd backend && node scripts/fetchDungeonAtlasSources.mjs [--azerothcore-ref <sha>] [--content-only | --loot-only] [--from <dir>]`
  refreshes the extracts (only rows the atlas uses). `--content-only` refreshes
  just the content extracts (spawns, creature spells, spell facts);
  `--loot-only` just the reference-loot extracts (loot links, quest details,
  item facts; it reads the current `atlas.json` for the bosses, rares and
  quests to attach them to, so run it after an import); `--from` reads
  already-downloaded upstream files instead of the network (wago tables as
  `<Table>.csv`, AzerothCore tables as `<table>.sql`).
- `cd backend && node scripts/importDungeonAtlas.mjs` re-normalizes offline
  and writes both served files. Idempotent: the same extracts always write
  byte-identical files. `--check` fails if either file is stale or breaks an
  invariant (`atlasProblems`, `referenceLootProblems`; also checked by
  `test/dungeonAtlas.test.js` and `test/dungeonAtlasReferenceLoot.test.js`).
- No database storage, so no migration. The data ships inside `backend/src`, so
  the existing Dockerfile includes it.
- Adapters: `backend/src/Atlas/atlasNormalize.js` (`adaptWagoClassicEra`,
  `adaptAzerothCore`, `normalize`, `atlasProblems`); content (layout, rares,
  trash, abilities) in `atlasContent.js` (`extractCreatureContent`,
  `extractSpellContent`, `classifySpell`, `spellInterruptible`, `adaptContent`);
  reference loot and quest details in `atlasLoot.js` (`extractItemFacts`,
  `extractReferenceLoot`, `extractQuestDetails`, `curateItem`,
  `normalizeReferenceLoot`, `questDetailsOf`, `referenceLootProblems`); readers in
  `atlasSources.js` (CSV, mysqldump, C++ script spell enums). Served by
  `atlasRepository.js` (atlas) and `referenceLoot.js` (reference items, also used
  by the loot catalog and wishlists).

## Sources

| Source | What we take | Tier / confidence | Licence / attribution |
|---|---|---|---|
| wago.tools DB2 export, `product=wow_classic_era` (client build 1.15.8.x at retrieval) | `Map` (names, kind, size), `LFGDungeons` (level bands, wings), `DungeonEncounter` (boss list + order, difficulty 0/1 only), `AreaTrigger` (entrance trigger positions), `UiMapAssignment` + `UiMap` (zone frames), `AreaTable` (dungeon zone area ids) | `classic-reference`, high (entrances: medium) | Factual data from Blizzard's World of Warcraft Classic Era client, via https://wago.tools. Names and numbers only; no art, text bodies or models are redistributed. |
| wago.tools DB2 export, `product=wow_classic_era` (content extract `wago-classic-era-spells.json`) | `SpellName`, `Spell` (description), `SpellMisc` (cast time, passive, channeled attribute, school), `SpellCastTimes`, `SpellInterrupts` (interrupt and channel-interrupt flags), `SpellCategories` (dispel type, mechanic, prevention type), `SpellEffect` (effects, auras, targets) for the spells dungeon creatures cast; `AreaTable` continent areas named after a dungeon (their parent area is the dungeon's zone) | `classic-reference`; ability category/priority derived by rule: low | As above. Spell names, numbers and the client's own short descriptions only. |
| wago.tools DB2 export, `product=wow_classic_era` (extract `wago-classic-era-items.json`, revision named after the newest build column of `ItemSparse`) | `ItemSparse` (name, quality, item level, required level, class restriction, binding, armour, resistances, weapon damage and speed, stats, set, quest it starts), `Item` (class, subclass, icon file id), `ItemSet` (set name), `ItemClass` / `ItemSubClass` (class and subclass names) — only for the items the reference loot and the quest rewards use | `classic-reference`, high | As above. Item names and numbers only; no tooltip text, art or models. |
| AzerothCore world DB, same commit (extract `azerothcore-loot.json`) | `creature_loot_template` + `reference_loot_template` (which creature drops which item; drop chances are **not** kept), `gameobject_loot_template` + `gameobject_template` + `gameobject` (chests), `creature` (where loot sources stand), `quest_template` (objective line `LogDescription`, `RewardItem1-4`, `RewardChoiceItemID1-6`), `quest_template_addon` (`PrevQuestID`), `creature_queststarter` + `creature` (giver spawn) | `community-unverified`, medium | GPL-2.0, as below. |
| AzerothCore world DB, same commit (content extract `azerothcore-creatures.json`) | `creature` (spawn positions in the vanilla dungeon maps), `creature_template` (name, rank, levels, script name), `smart_scripts` (cast actions), `creature_template_spell`, the `SPELL_* = id` enums of C++ creature scripts under `src/server/scripts/{EasternKingdoms,Kalimdor}/<dungeon>/` (only files that register exactly one creature script), `instance_encounters` (boss list where the client has none) | `community-unverified`, medium | GPL-2.0, as below. |
| AzerothCore `azerothcore-wotlk` world DB, commit `6ffb62abb867dabb258de6813ff5d06d6b011543` | `areatrigger_teleport` (which trigger enters which map), `quest_template` (quests whose QuestSortID is the dungeon's zone, ids ≤ 9299, placeholders dropped), `creature_queststarter`, `creature_template` (names; boss npc ids by unique exact name) | `community-unverified`, medium | GPL-2.0 (the repository's `LICENSE` at that commit), © AzerothCore contributors, https://github.com/azerothcore/azerothcore-wotlk. A WotLK 3.3.5 emulator database; vanilla content as the emulator models it. |

Neither source is the Forever client, so nothing is tiered `official-client` or
`forever-reference`, and nothing claims `verifiedForForever`. The loot catalog's
own addon evidence (`loot_window`, `encounter_journal`, …) remains the Forever
source of truth for loot; bosses link to it, not the other way round. When the
catalog has observed a reference item in that dungeon, the served item says
`observed: true`, `verifiedForForever: true`, takes the catalog's facts, and
carries an `official-client` provenance line (`guildweaver-loot-catalog`) first.

## Reference loot (`reference-loot.json`)

Dataset `atlas-reference-loot`, schema 1, revision `<items revision> + <AzerothCore commit>`.
Items are stored once (`items`, keyed by item id) with one shared `provenance`
(the client for facts, the emulator for who drops it); each dungeon lists item
ids by boss (`encounterId`, `npcId`), rare (`npcId`) and `dungeonLoot` (trash
and chests, with `npcId`/`sourceName` when exactly one source drops it). One
item / dungeon per line, so a refresh reviews as a readable diff.

**What is kept** (`curateItem`): an item a creature or chest of a vanilla
dungeon drops, when **nothing spawned outside the vanilla dungeons drops it**
(that keeps world drops and world-drop reference tables out), and it is

- a weapon or armour piece of uncommon (green) quality or better,
- a bag or quiver of uncommon quality or better,
- a set item (any quality) or any item of rare (blue) quality or better,
- a trade good, reagent or recipe of uncommon quality or better,
- or an item that starts a quest;

plus every reward item of the atlas's quests. Grey and white gear, consumables,
plain trade goods and quest objectives (`QuestRequired` rows) are left out;
loot modes other than normal are ignored. An item the Classic Era client does
not have (emulator-only, or a later expansion's) is left out whatever the
emulator says.

**Linking:** a boss's loot is its atlas `npcId`'s, else the loot of the one
creature with the boss's exact name that has loot in that dungeon. Bosses and
rares the emulator summons instead of spawning are placed by the atlas.
An item a boss drops is listed under that boss only (not again as trash);
chests are listed by their own name, never attributed to a boss.

**Kinds:** `set` (part of an item set) > `boe` (gear, binds on equip) > `rare`
(gear only rare spawns drop) > `gear` > `material` (trade goods, reagents) >
`quest-reward` (only a quest reward) > `other` (recipes, bags, quest starters,
other rare+ items).

**Facts** (`referenceItemOf`): only what the client row says. `stats` are the
base attributes (`Stamina`, `Strength`, `Agility`, `Intellect`, `Spirit`,
`Health`, `Mana`) and resistances (`Fire Resistance`, …); Equip/Use effects are
not stats and are not included. `stats` is `null` for random-suffix items ("of
the Monkey") and for any stat code this reader does not name; `[]` means the
client lists none. `armor` is `null` when 0; `weapon` only for weapons with
damage (`dps` is the tooltip's average damage / speed, 1 decimal). `classes` is
`null` unless the client restricts the item to some of the nine classes.
`bindType`: `BoP`, `BoE`, `BoU`, `Quest` or `null` (no binding). `slot` uses the
catalog's slot strings; `itemSubclass` is the client's verbose subclass name
(`One-Handed Swords`, `Plate`).

## Quest details (in `atlas.json`)

Each atlas quest gains `objective` (the quest log's objective line; `$B` becomes
a space, `$N`/`$C`/`$R` become `<name>`/`<class>`/`<race>`; the story text is
not shipped), `prerequisites` (`PrevQuestID` when positive and vanilla, with its
title), `rewards` (`{ itemId, choice }`, items the client has; served as
ReferenceItems), `location` (the giver's only spawn: a continent spawn becomes
`{ zoneName, mapId: uiMapID, x, y }` 0–1 like entrances; a spawn inside a vanilla
dungeon `{ zoneName: <dungeon>, mapId: null, x: null, y: null }`; several spawns
or none: `null`) and `provenance`.

## Abilities: how they are derived

Which creature casts which spell is the emulator's (community-unverified).
What a spell does is the Classic Era client's (cast time, channeling,
interrupt flags, prevention type, dispel type, mechanic, effects).
`classifySpell` turns those facts into a category and priority by fixed rules,
in order: loss-of-control mechanic → `crowd-control` (high); mana drain/burn or
area damage-over-time → `healer-danger` (high); a cast or channel the client
marks kickable → `interrupt` (high for heals, channels and casts ≥ 1.5 s);
dispellable enemy aura → `dispel`; enrage/frenzy or healing/armour debuffs →
`tank-danger`; area damage or knock-back → `positioning`; anything else →
`special-mechanic`. Cosmetic, passive and placeholder spells are dropped.
Descriptions with unresolved number tokens are left out (`details: null`).
Every ability is `source: "classic-reference"`, `verifiedForForever: false`.

**Kickable** (`spellInterruptible`) follows the rule the 1.12–3.3.5 servers
apply (AzerothCore `Spell::EffectInterruptCast`): the spell's
`SpellCategories.PreventionType` includes silence (bit 1), and its
`SpellInterrupts.InterruptFlags` (a cast) or `ChannelInterruptFlags_0` (a
channel, `SpellMisc.Attributes_1` & 0x44) carries the interrupt bit 0x08. An
instant that is not channeled is `null` (interrupting does not apply).

Sprint 2 audit: the earlier rule looked at `InterruptFlags` only and treated
channels as instants. With the prevention type and channel flags from the same
client tables, 75 ability entries (63 distinct spells) changed: 33 spells are
no longer called interruptible (pacify-only or no prevention type: melee
abilities such as Whirling Barrage, summons, Quick Flame Ward), 14 channels are
now interruptible, and 40 entries changed category as a result (most
`interrupt` → `special-mechanic` / `positioning`). Dangerous trash follows
(179 → 173 creatures). Nothing was marked interruptible without these flags.

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

## Coverage (at this commit)

- 26 vanilla dungeons and raids (Season of Discovery maps excluded).
- 23 with level bands (not AQ20, AQ40, Naxxramas: not in the client's LFG table).
- 23 with a world entrance (+ extra entrances for SM, Dire Maul, Stratholme,
  Maraudon, Uldaman, Gnomeregan, Molten Core). None for Blackwing Lair, Ruins of
  Ahn'Qiraj, Naxxramas (no outdoor trigger in the Classic Era client).
- 240 bosses (226 with npc ids; 203 placed on the spawn layout; 176 with
  abilities). Gnomeregan (4) and Sunken Temple (7) bosses come from
  AzerothCore's `instance_encounters`: the Classic Era client only carries their
  Season of Discovery encounters.
- 638 boss abilities, 173 dangerous-trash creatures (elites with a
  high-priority spell, up to 8 per dungeon), 27 rares (rank 2/4 spawns).
- 26 spawn layouts (one per dungeon; see below). 0 map art, 0 portraits, 0
  dungeon artwork.
- 373 quests across the dungeons' zones; 313 with an objective, 293 with reward
  items, 161 with a prerequisite, 263 with a giver location (370 with at least one).
- Reference loot: 2,027 items (1,009 gear, 274 set, 95 BoE, 64 rare-spawn gear,
  11 materials, 359 quest rewards only, 185 other) across all 26 dungeons
  (25 with boss loot); 203 of 240 bosses, all 27 rares, 310 trash/chest drops
  (23 chests).

## Known gaps and caveats

- **Onyxia's Lair and Naxxramas loot**: AzerothCore models both as the level-80
  Wrath of the Lich King raids, so their loot tables hold WotLK items the
  Classic Era client does not have. Onyxia has 1 reference item, Naxxramas none
  from bosses (its zone's vanilla quest rewards are kept). Needs another
  vanilla-era source.
- **Bosses without reference loot** (37): encounters that are events or groups
  rather than one creature (Ring of Law, The Seven, The Vault, The Lost Dwarves,
  Silithid Royalty, Twin Emperors, Edge of Madness, The Four Horsemen, …),
  bosses whose loot comes from a chest (Majordomo Executus → "Cache of the
  Firelord", The Seven → "Chest of The Seven": listed under `dungeonLoot` by the
  chest's name), names that match no single creature (Geilhast, Kirtonos,
  Ras Frostwhisperer, Ezra Grimm), and bosses whose own drops are all filtered
  out (Stockade bosses, Ragefire Chasm's Oggleflint and Bazzalan, Rethilgore,
  Aggem Thorncurse, Ribbly Screwspigot's plans also drop outdoors).
- **World drops are left out on purpose**: an item any outdoor creature can
  drop is not a dungeon's, even when the dungeon's bosses can drop it too.
- **Drop sources are the emulator's**; item facts are the Classic Era client's
  (current Classic Era tuning, which can differ from 1.12 and from Forever).
  Nothing is verified for Forever until the loot catalog observes it.
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
  Quests started by an item have no giver and no location.
- `recommendedLevel`, `strategy`, map art, portraits and artwork: not sourced.
