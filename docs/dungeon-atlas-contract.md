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
