# Dungeon Atlas: API contract

The atlas adds an `atlas` object to the loot catalog's dungeon responses. Every
existing field of those responses is unchanged. Data is served from the
checked-in `backend/src/Atlas/data/atlas.json`; no request ever calls an outside
service.

Missing data is `null` (scalars/objects) or `[]` (lists). Nothing is filled in by
guesswork: no averaged levels, no estimated coordinates, no inferred loot or
mechanics.

## GET /api/player/loot/dungeons

Each entry of `dungeons` gains:

```
atlas: {
  levelMin, levelMax,          // int | null  (client LFGDungeons band; wings merged)
  recommendedLevel,            // null        (no source yet)
  zoneName, zoneMapId,         // string | null, uiMapID | null (zone of the first entrance)
  entrance: { mapId, x, y } | null,
  artworkUrl,                  // null        (no licensed art)
  bossCount,                   // int
  rareCount,                   // int | null  (rare spawns; 0 is a known zero, null = no spawn data)
  questCount,                  // int
  kind: "dungeon" | "raid",
  lootSlots: string[]          // optional addition: distinct `slot` strings of the catalog's active loot
                               // for this dungeon (same strings as the catalog item records); [] if none
} | null                       // null when the atlas does not know the instance
```

**Optional addition:** top-level `atlasDungeons: [{ instanceId, name, type, atlas }]`
lists atlas dungeons the loot catalog has not seen yet (no loot evidence), so an
atlas UI can show every dungeon. `type` uses the catalog's `"party" | "raid"`.

## GET /api/player/loot/dungeons/:instanceId

Gains `atlas`:

```
atlas: {
  description,                 // string | null
  kind, levelMin, levelMax, recommendedLevel, zoneName, zoneMapId, artworkUrl,   // as in the list
  wings?: [{ name, levelMin, levelMax }],   // optional: client LFG wings (Dire Maul, Blackrock Spire)
  maps: [{ floorId, name, imageUrl, width, height, kind?, points? }],
                               // today: one spawn layout per dungeon (see Units)
  bosses: [Boss],
  creatures: [{ npcId, name, levelMin, levelMax, count, abilities: [Ability] }],   // dangerous elite trash, ≤ 8
  rares: [{ npcId, name, levelMin, levelMax, elite, floorId, mapPosition, abilities: [Ability] }],
  quests: [{ questId, name, level, minLevel, faction, giver }],
  entrance: { mapId, x, y } | null,
  entrances?: [{ mapId, zoneName, x, y, label, areaTriggerId }],   // optional: every known entrance
  provenance: [Provenance]
}
```

- `faction`: `"alliance" | "horde" | "both"`. `giver`: `{ npcId, name }` or `null`.
- **Optional addition:** for an instance the atlas knows but the loot catalog has
  never seen, the detail endpoint now answers **200** (previously 404) with the
  catalog fields empty (`sources: []`, `changes: []`, `difficulties: {}`,
  `instance.firstSeenAt: null`) plus `atlas`. Unknown to both: still 404.

### Boss

```
{ encounterId, npcId, name, order, portraitUrl, floorId, mapPosition: {x,y} | null,
  abilities: [Ability], loot: [itemKey], strategy: { tank?, healer?, dps?, summary? } | null, provenance: [Provenance] }
```

- `encounterId`: the client's DungeonEncounter id. `npcId` is set only when a
  creature name matched exactly one creature (else `null`).
- `order` (optional addition): the client's OrderIndex, for sorting.
- `name`: when the loot catalog has a source group for this boss (same npc id,
  encounter id, or normalized name), `name` is that group's `sources[].name`
  exactly, so boss ↔ source matching by name works. `atlasName` (optional
  addition) keeps the atlas source's own spelling.
- `loot`: wishlist item keys (`"i:<itemId>"`) the loot catalog already holds for
  this boss (matched by npc id, encounter id, or normalized name). Look the items
  up in the same response's `sources[].items`. Never invented.
- `strategy`: `null` today.

### Ability

```
{ spellId, name, category, priority: "high"|"medium"|"low", interruptible: bool|null,
  summary, details, source, verifiedForForever: bool }
```

`category` is one of `interrupt`, `tank-danger`, `healer-danger`, `positioning`,
`dispel`, `crowd-control`, `special-mechanic`. `source` is a provenance tier.
Anything not from `official-client` or `forever-reference` has
`verifiedForForever: false` (enforced by `atlasProblems`). No abilities are
published yet (see gaps in `dungeon-atlas-sources.md`).

### Provenance

```
{ source, revision, confidence: "high"|"medium"|"low", tier, retrievedAt, url, note? }
```

`tier` is one of `official-client`, `forever-reference`, `classic-reference`,
`community-unverified`.

## Units

- **World entrance** (`entrance`, `entrances[]`): `mapId` is the zone's
  **uiMapID** (the ids in `frontend/src/Player/Map/atlas.js`, e.g. 1436 Westfall),
  and `x`, `y` are the game's **normalized zone-map coordinates, 0–1 from the top
  left** — the same convention the farming map records positions in. Multiply by
  100 for the in-game "38.0, 77.5" style. To place on the world map in world
  units (1002 × 668), use the frontend's
  `projectPoint(atlasZone(mapId), x, y)`. The importer only emits this unit, or
  `null` when no entrance is sourced (`atlasProblems` rejects anything outside 0–1).
- `zoneMapId`/`zoneName` are the zone of the first entrance, chosen like the
  site's map borders (a city rectangle wins, else the nearest zone centre). Near
  zone borders this can differ from the game's own zone; the point itself is
  exact either way.
- **In-dungeon** `mapPosition`: normalized 0–1 (from the top left) on the floor
  map `floorId`, or `null` when unknown. Today the only floor is the spawn
  layout: `{ floorId: "layout", kind: "spawn-layout", imageUrl: null, width,
  height, points: [[x, y], …] }`, where `width`/`height` are the world extent in
  yards (aspect ratio) and `points` are the 0–1 cells holding any spawn. A map
  with `imageUrl` is art; one with `points` is drawn by the client.

## Dungeon identities and wings

Some dungeons are several dungeons on one game map: each wing has its own
entrance and is run on its own, but every wing reports the same numeric
instance ID. The atlas gives every dungeon a stable **dungeon key** and every
such wing a **wing key**; the numeric instance ID stays the game's map ID and is
never a wing's identity.

```
dungeonKey   "deadmines", "scarlet-monastery"          a dungeon (slug of its atlas name)
             "scarlet-monastery:library"                a wing: <parent key>:<wing slug>
parentKey    "scarlet-monastery"                        the dungeon a wing belongs to
instanceId   189                                        shared by every wing of the dungeon
```

Wings (curated in `backend/src/Atlas/atlasWings.js`, each fact with its source):

| Dungeon | Wings | Bosses and rares | Levels | Floors | Entrances |
| --- | --- | --- | --- | --- | --- |
| Scarlet Monastery (189) | graveyard, library, armory, cathedral | DungeonPlanner and InstanceJournal agree | InstanceJournal | OpenMap | the atlas's own trigger names |
| Dire Maul (429) | east, west, north | DungeonPlanner, InstanceJournal | client LFGDungeons | OpenMap | the atlas's own trigger names |
| Stratholme (329) | live, undead | DungeonPlanner | the dungeon's (no source per half) | OpenMap | shared (not sourced per half) |
| Blackrock Spire (229) | lower, upper | DungeonPlanner, InstanceJournal | client LFGDungeons | none (OpenMap's say Lower for every floor) | shared (one entrance) |

A boss or rare belongs to a wing only when a source places it there and none
places it elsewhere. Anything else stays on the dungeon as **unassigned**
(today: Lord Hel'nurath in Dire Maul; Black Guard Swordsmith, Crimson
Hammersmith, Ezra Grimm, Skul and Stonespine in Stratholme; Burning Felguard in
Blackrock Spire). No source used here attributes quests, trash or chest loot to
a wing: a wing shows them marked shared, never as its own.

### GET /api/player/loot/dungeons

- Every `atlas` gains `dungeonKey`; a dungeon with wings also gains
  `wingEntries: [{ dungeonKey, parentKey, instanceId, wing, name, levelMin, levelMax }]`.
- **Optional addition:** top-level `atlasWings`, one entry per wing:
  `{ instanceId, dungeonKey, parentKey, wing, name, instanceName, type, atlas }`.
  Its `atlas` is the list summary narrowed to the wing (`bossCount`,
  `rareCount`, `referenceItemIds` of its own bosses and rares plus the shared
  trash and quest loot, `levelMin`/`levelMax`/`levelSource`) plus
  `bossNpcIds`/`bossNames` (its bosses and rares) and `sharedQuestCount`.
  `lootSlots` is the instance's. The dungeon's own entry in `dungeons` is
  unchanged, so old clients see exactly what they saw before.

### GET /api/player/loot/dungeons/:id

`:id` is the numeric instance ID (unchanged: the whole dungeon), a dungeon key
(the same dungeon) or a wing key. Unknown ids answer 404.

A wing's detail is the dungeon's detail narrowed to the wing:

- `instance` stays the game's instance (instanceId 189): wishlist sources,
  gear planning and runs keep using it.
- `wing: { dungeonKey, parentKey, instanceId, wing, name, levelMin, levelMax, slug, parentName, levelSource, sourcesLeftOut, siblings }`.
- `sources`: catalog source groups that are one of the wing's bosses or rares
  (`wingAttribution: "wing"`), and ones that are no wing's boss, such as trash or
  unknown sources (`"shared"`). Source groups of a sibling wing's bosses are
  left out (`wing.sourcesLeftOut` counts them). Observed loot is never moved.
- `atlas`: `bosses` and `rares` of the wing only; `creatures`, `quests` and
  `dungeonLoot` marked `wingAttribution: "shared"`; `levelMin`/`levelMax` with
  `levelSource` (`instance-journal`, `wago-classic-era` or `parent`);
  `entrances` (the wing's, or every entrance with `entrancesShared: true`);
  `floors: [{ name, source }]` (names only, no art); `unassigned: { bosses, rares }`
  (names); `maps` is the dungeon's spawn layout; `provenance` adds the wing's sources.

### Runs (GET /api/player/dungeon-runs, /dungeon-runs/:id)

Each run's `dungeon` gains, read from the stored run and never written back:
`dungeonKey`, `parentKey` and `wing: { dungeonKey, wing, name, evidence: "boss_kills", bosses } | null`.
A run belongs to a wing only when every kill of a boss some wing owns is in
that one wing; a run with no such kill, or kills in two wings, stays on its
dungeon (`wing: null`). Stored runs, run IDs and every old field are unchanged.

### Website links

`?open=` holds a numeric instance ID (the whole dungeon, as old links always
did; its Overview lists the wings) or a wing key (`?open=scarlet-monastery%3Alibrary`).

### Wing manifest (for other programs)

`backend/src/Atlas/data/wing-manifest.json` is the same wing table as plain
data, generated by `node scripts/exportWingManifest.mjs` (`--check` fails when
it is out of date; a test does too). Per dungeon: `instanceId`, `dungeonKey`,
`name`, and for a dungeon played as wings its `wings` (`dungeonKey`,
`parentKey`, `slug`, `wing`, `name`, `levelMin`/`levelMax`/`levelSource`,
`bosses` and `rares` as `{ npcId, encounterId, name, sources }`, `floors`
(names), `entrancesShared`, `entrances` as `{ areaTriggerId, mapId, x, y }`)
and its `unassigned` bosses and rares. The Guildweaver add-on's exporter reads
it, so the add-on and the site never keep two rosters.

### Run payload: optional `wing`

A `dungeon_run` payload may carry `wing: { dungeonKey, evidence, encounterId? } | null`
(the add-on's own resolution). The validator ignores it, as it ignores every
key it does not know, so it is safe for any server version. The site does not
store it: it derives a run's wing from the stored boss checkpoints (above),
which is the same evidence.

## Reference loot sources (optional additions, sprint step 3A)

- A boss's and a rare's `referenceLoot[]` items gain `referenceSources`, which
  says who lists the item for that creature: `"azerothcore"`,
  `"dungeon-planner"` or both.
- `dungeonLoot[]` entries gain `sources: [{ npcId, name } | { objectId, name }]`,
  every creature or chest that drops the item. `sourceName` and `npcId` are
  unchanged: the single source, else null.
- `reference-loot.json` gains, per boss, `sources` (item ids by source) and
  `chests` (a boss's own chest), plus top-level `gaps` (listed items without
  client facts) and `excluded` (counts of world drops and filtered items).
  The served API shape is otherwise unchanged.

