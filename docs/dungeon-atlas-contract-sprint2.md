# Dungeon Atlas Sprint 2: contract additions (reference loot, quests, wishlist)

Additive only. Every field in `docs/dungeon-atlas-contract.md` keeps its meaning.
Missing data is `null` / `[]`. Nothing is guessed: no drop chances, no invented
stats, no invented item ids.

## Changes from initial contract

None: every field name and shape below is as first written. The notes at the
end (Implementation notes) only pin down values and add optional fields.

## Terms

- **Observed loot**: the existing loot catalog (Guildweaver telemetry). `boss.loot`
  (item keys into `sources[].items`) is unchanged and stays authoritative.
- **Reference loot**: checked-in, versioned Classic reference data
  (`backend/src/Atlas/data/...`). Never claimed verified for WoW Forever.
  When an item is both, `observed: true` and the observed facts win.

## ReferenceItem

```
{
  itemId: int, itemKey: "i:<itemId>",
  name: string, qualityId: int|null, iconFileDataId: int|null,
  slot: string|null,            // same slot strings as catalog item records ("Head", "Two-Hand", ...)
  itemLevel: int|null, requiredLevel: int|null,
  itemClass: string|null, itemSubclass: string|null,   // "Armor"/"Weapon"/..., "Plate"/"Sword"/...
  classes: string[]|null,       // class restriction, null = none known
  bindType: string|null,        // "BoP" | "BoE" | ... | null
  armor: int|null,
  weapon: { minDamage, maxDamage, speed, dps } | null,
  stats: [{ stat: string, value: int }] | null,   // e.g. { stat: "Stamina", value: 7 }; null = unknown
  setName: string|null,
  kind: "gear" | "set" | "rare" | "boe" | "material" | "quest-reward" | "other",
  observed: bool,               // also in the Guildweaver observed catalog for this dungeon
  verifiedForForever: bool,     // true only when observed
  provenance: [Provenance]      // same Provenance shape as the existing contract
}
```

No `dropChance` field. Ever.

## GET /api/player/loot/dungeons  (list; `atlas` gains)

```
referenceLootCount: int,        // distinct reference items (boss + trash + rares + quest rewards)
referenceItemIds: int[],        // all of them, for wishlist matching without loading details
referenceSlots: string[]        // distinct slots among them
```

Present on `dungeons[].atlas` and on `atlasDungeons[].atlas`.

## GET /api/player/loot/dungeons/:instanceId  (detail; `atlas` gains)

```
bosses[].referenceLoot: [ReferenceItem]     // sorted quality desc, then itemLevel desc
rares[].referenceLoot:  [ReferenceItem]
dungeonLoot: [ReferenceItem & { sourceName: string|null, npcId: int|null }]   // trash / shared drops not tied to a boss
referenceVersion: { dataset: string, revision: string, importedAt: string }  // e.g. { dataset: "atlas-reference-loot", revision: "...", importedAt: ISO }
quests[] (existing fields kept) gains:
  objective: string|null,
  prerequisites: [{ questId: int, name: string|null }],
  rewards: [ReferenceItem & { choice: bool }],   // choice = one-of reward
  location: { zoneName: string|null, mapId: int|null, x: number|null, y: number|null } | null,  // giver location, uiMapID + 0-1 coords
  provenance: [Provenance]
```

Abilities keep their shape. Classification fixes change values only.

## Wishlist (existing endpoints, no new system)

- `PUT /api/player/wishlists/:characterId/items/:itemKey` accepts any item that
  is in the observed catalog **or** the reference catalog. Unknown ids are still
  rejected exactly as today. Body may pass `sourceDungeon`, `sourceInstanceId`
  as today.
- `GET /api/player/wishlists/:characterId` rows for reference-only items get
  name/quality/icon/slot/etc. from the reference catalog (not `"Item <id>"`),
  and their `sources` include `{ instanceId, dungeonName, bossName, npcId, reference: true }`.
- `GET /wishlists/:characterId/ai-prompt?dungeons=…` includes reference loot of
  the selected dungeons, labeled as Classic reference.
- `POST /wishlists/:characterId/import` validates reference item ids as known items.

## Fixtures

Frontend fixtures (`frontend/src/Player/Dungeons/__fixtures__/`) must use real
item ids from the dungeons they describe, e.g. Deadmines:
Edwin VanCleef 5193 Cape of the Brotherhood, 5191 Cruel Barb, 5202 Corsair's Overshirt, 10399 Blackened Defias Armor (Defias set).
Agent A's data is the source of truth; fixtures are shape examples.

## Implementation notes (backend, Agent A)

Values, and optional additions; no field above was renamed or removed.

- `itemSubclass` is the client's verbose subclass name: `"One-Handed Swords"`,
  `"Two-Handed Axes"`, `"Plate"`, `"Cloth"`, `"Shields"` (the same strings the
  catalog's item records use), not the short `"Sword"`.
- `bindType`: `"BoP" | "BoE" | "BoU" | "Quest" | null` (`null` = no binding).
  `slot` is `null` for non-equippable items (materials, recipes, quest items).
- `stats`: base attributes (`Stamina`, `Strength`, `Agility`, `Intellect`,
  `Spirit`, `Health`, `Mana`) and resistances (`Fire Resistance`, …). `[]` = the
  client lists none; `null` = unknown (random-suffix items). Equip/Use effects
  are not included. `armor` is `null` when the item has none.
- `weapon.speed` in seconds (2.8), `weapon.dps` rounded to 1 decimal.
- `kind` precedence: `set` > `boe` > `rare` (gear only rare spawns drop) >
  `gear` > `material` > `quest-reward` (only a quest reward) > `other`.
- Observed items: the first `provenance` line is
  `{ source: "guildweaver-loot-catalog", tier: "official-client", … }`; the
  catalog's name, quality, icon, slot, levels, class, subclass, classes and
  binding win. Reference-only items carry
  `[{ tier: "classic-reference", source: "wago-classic-era" }, { tier: "community-unverified", source: "azerothcore" }]`.
- `dungeonLoot[]`: `npcId` and `sourceName` are set when exactly one source
  drops the item. Chests have `npcId: null` and the chest's name as
  `sourceName` (e.g. `"Cache of the Firelord"`, `"Chest of The Seven"`); several
  sources give `null` / `null`. An item a boss drops is listed only under that
  boss.
- `referenceVersion.revision` is `"<client build> + <AzerothCore commit>"`;
  `importedAt` is the extracts' retrieval time (stable across re-imports).
- `quests[].location` for a giver inside a dungeon is
  `{ zoneName: "<dungeon>", mapId: null, x: null, y: null }`; several or no
  spawns give `null`. `objective` is the quest log's one-line objective (`$N`
  etc. shown as `<name>`, `<class>`, `<race>`). `rewards` only list items the
  Classic Era client has.
- Wishlist `GET` rows of reference-only items: `item` has the catalog item
  shape (`bindType` numeric there, as in catalog records) plus
  `item.reference = { kind, armor, weapon, stats, setName, bindType, tier: "classic-reference", verifiedForForever: false }`.
  Reference `sources[]` entries also carry the catalog source keys
  (`dungeon`, `source`, `sourceKind: "reference"`, `confidence: "candidate"`,
  `difficultyIds: []`, `sightings: 0`) and `sourceType`
  (`"boss" | "rare" | "trash" | "quest"`; quest entries add `questId`,
  `questName`). They appear only for dungeons where the catalog has not
  observed the item, so `GET /loot/items` search results gain them too.
- Real Deadmines ids for fixtures, from the data: Edwin VanCleef (encounter
  2747, npc 639) 5191, 5193, 5202, 10399 (+ 2874 An Unsent Letter, kind
  `other`); Captain Greenskin (npc 647) 5200, 5201, 10403 (Defias set belt);
  Mr. Smite (npc 646) 5192, 5196, 7230; `dungeonLoot` 10400, 10401, 10402
  (Defias Leather set), 1930 Stonemason Cloak (Defias Miner), 1937 Buzz Saw
  (Sneed's Shredder), 1951 Blackwater Cutlass (several sources: `null`).
