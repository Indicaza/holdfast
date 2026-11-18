# Dungeon loot, character wishlists and loot alerts

One feature across three repositories:

| Repository | Part |
| --- | --- |
| `holdfast` (this one) | The loot catalog, character wishlists, the AI import, the valuable-BoE watchlist, and the snapshot the bridge fetches |
| `guildweaver-bridge` | Fetches the snapshot and writes it into the add-on folder, with its own change tracking |
| `guildweaver` (add-on) | Matches Need/Greed rolls against the wishlist and the watchlist, glows and chimes, and reports rolls and journal loot back |

Code: `backend/src/Loot/`, `frontend/src/Player/DungeonLoot.jsx`, `WishlistImport.jsx`, `lootModel.js`. The page is **Dungeon runs → Loot & wishlist** (`/dashboard/dungeons?view=loot`).

## The loot catalog

Dungeon → Boss/Source → Items, built from three kinds of evidence that are never added together:

| Provenance | What it proves | Where it comes from |
| --- | --- | --- |
| `loot_window` | The item was in that creature's loot window | `mob_loot` telemetry inside a party or raid instance (already collected) |
| `group_roll` | The item was put up for a Need/Greed roll in that dungeon | `loot_roll` telemetry. The creature is recorded only when the looter's own client saw the item on exactly one corpse |
| `encounter_journal` | The client's journal lists the item for that boss | `loot_catalog_snapshot` telemetry (`/gw loot scan` in the add-on) |
| `external` | An outside table says so | Reserved. Nothing writes it yet; such rows would stay candidates |

An offer is not an acquisition: a sighting says the item was offered, never that the player (or anyone) received it. Not seeing an item proves nothing and changes nothing. Open-world loot and quest drops never enter the catalog (an instance counts only when its type is `party` or `raid`).

Each item under a source carries a confidence:

- **confirmed**: seen in that source's loot window.
- **advertised**: listed by the journal; nobody has reported seeing it.
- **reported**: seen in a roll in the dungeon; the source is not known.
- **candidate**: only an outside table.
- **delisted**: the journal stopped listing it and it has not been seen since.

Bosses are the ones the client named: journal encounters, and kills reported in players' runs (`ENCOUNTER_END`, `BOSS_KILL`). A creature with the same name as one of those is shown as that boss, with both kinds of evidence. Nothing is called a boss by rank or guesswork.

Item facts (name, quality, level, slot, type, tooltip, binding) come from the website's existing item index (`market_item_meta`, `public_game_items`, the Blizzard item catalog). The Blizzard item API describes items; it does not provide boss drop tables, and nothing here treats it as if it did. Class restrictions are read only from a `Classes:` line in a tooltip the game rendered.

### Versioning

- `dungeon_loot_entries`: one row per dungeon, difficulty, source, item and provenance, with first and last sighting, first and last game build, an evidence count, status and the catalog revision of its last status change. Rows are marked `removed`, never deleted.
- `dungeon_loot_changes`: append-only. Kinds: `new_item`, `new_source`, `observed`, `advertised_added`, `potentially_removed`, `restored`, `conflict`.
- `dungeon_loot_snapshots`: every distinct journal list a client sent, kept whole.
- The catalog revision (`app_meta.dungeon_loot_revision`) moves once per ingest that changes what the catalog claims. More evidence for a known claim does not move it.

An advertised item is marked removed only when a journal list for the same boss and difficulty is **complete, unfiltered (all classes), not empty, taken later than the entry was last seen, and from the same or a newer build**, and no longer has it. A partial, class-filtered, empty or older list removes nothing. An item listed again is `restored` (`conflict` when it is the same build that dropped it); an item seen dropping after it was delisted is `conflict`, and the sighting wins.

Migration 23 fills the catalog from the corpse loot already recorded inside dungeons players ran.

### Classic reference loot

Beside the catalog, the Dungeon Atlas ships checked-in Classic reference loot
(`backend/src/Atlas/data/reference-loot.json`; sources, filter and gaps in
[dungeon-atlas-sources.md](dungeon-atlas-sources.md), API shape in
[dungeon-atlas-contract-sprint2.md](dungeon-atlas-contract-sprint2.md)). It is
not evidence and never enters `dungeon_loot_entries`: no `external` rows are
written, the catalog's confidence rules are unchanged, and no drop chances are
kept.

- **Observed wins.** In the atlas detail a reference item the catalog holds for
  that dungeon is `observed: true`, `verifiedForForever: true` and takes the
  catalog's facts; every other reference item is `observed: false`,
  `verifiedForForever: false`, tiered `classic-reference` (facts) /
  `community-unverified` (who drops it).
- **Known items.** `lootItemFactsInDatabase` falls back to the reference facts
  (with a `reference` block: kind, armour, weapon, stats, set, tier) only when
  the site's item index does not know the item by name, so a reference item can
  be wished for, imported and alerted on like a catalog item. Unknown ids are
  still refused.
- **Sources.** `lootSourcesForItemsInDatabase` adds the reference sources of an
  item (`reference: true`, `sourceKind: "reference"`, `confidence: "candidate"`,
  `dungeonName`, `bossName`, `npcId`, `sourceType`: `boss`/`rare`/`trash`/`quest`)
  for dungeons where the catalog has not observed it.
- **AI prompt.** With `?dungeons=…`, each chosen dungeon's reference gear that
  the catalog has not observed there is listed under its boss, marked
  `[Classic reference: not yet observed on Forever]`, within the same level,
  class and size limits. Without a dungeon choice the prompt is the catalog only.

## Character wishlists

`character_wishlist_items`: one row per account, character and item identity (`i:<itemId>`, or a variant key such as `i:15210:s-1081`). Priority (`high`, `normal`, `low`), a note (140 characters), an optional source dungeon, where it came from (`manual`, `ai_import`), a position and a state. Not the Auction House favorites, which are account-wide and about prices.

Every route takes the account from the session; another account's character answers 404. A change saves at once and bumps the character's revision and the account's (`character_wishlist_revisions`). Nothing depends on the add-on being connected.

States are kept apart:

| | Meaning | Proof |
| --- | --- | --- |
| wanted | On the list | |
| seen | In a loot window this account reported | `game_loot_observations` |
| offered | In a roll this character saw | `loot_roll_events` |
| won | The game told the character it received the item of a roll | `loot_roll` with `outcome: won` |
| owned | In the bags or equipped at the last sync | the character read model |

Only **won** and **owned** mark an item acquired (or the player's own "Got it"). Acquired items stay on the list; **Want another** makes one wanted again, starting from what the character owns then. Until bags or gear have synced, ownership is unknown, not zero.

## AI wishlist builder

No AI is called and no AI key is needed. The page offers two actions:

1. **Copy AI planning prompt** (`GET /api/player/wishlists/:characterId/ai-prompt`): the character (name, level, class, race, stats, equipped gear), the wishlist so far, the catalog's gear with item ids, sources and levels, and the output format. It tells the AI to ask for the build, consider alternatives and lateral upgrades, keep notes short, use only listed ids and return JSON only.
2. **Import AI wishlist JSON** (`POST /api/player/wishlists/:characterId/import` with `{ text, commit, updateExisting, skipInvalid }`).

```json
{
  "schemaVersion": 1,
  "character": "Rook Shepard",
  "catalogRevision": 41,
  "items": [
    { "itemId": 12345, "name": "Example Blade", "priority": "high", "note": "Tank-oriented upgrade", "sourceDungeon": "Example Dungeon" }
  ]
}
```

The id and names above are illustrative. `items[].variant` (a variant key) and `catalogRevision` are optional; any other field is an error.

The answer is never trusted. It is checked for: JSON syntax (with line and column), size (100 KB, 200 items), schema version, the selected character, unknown fields, id type and range, variant identity, priority, text lengths, duplicates, and the catalog: an id the website does not know is `unknown_item`, and an id whose known name is not the name given is `item_name_mismatch` (what an invented id looks like). A name that fits several items is `item_name_ambiguous` with candidate ids. Nothing ever creates an item record to make an import pass.

Each error has `code`, `category` (`json`, `schema`, `limit`, `catalog`), `path`, `received`, `expected`, `message`, `suggestion` and, for names, `candidates`. A response with errors also carries `repairPrompt`: the attempt, the exact errors (catalog errors set apart, with the instruction not to produce an id), the format, and the rule to keep valid items as they were.

A preview (`commit: false`) changes nothing. A commit is one transaction: any error rejects the whole list (HTTP 422) unless the player chose `skipInvalid` and every error concerns a single item. New items are added; matching entries are changed only with `updateExisting`; entries the import does not name are never touched; nothing is ever deleted.

## Valuable Bind-on-Equip watchlist

`backend/src/Loot/boeWatchlist.js` computes, per auction house, a list of at most 300 items worth a gold alert. An item qualifies only when:

- a player's game reported it as **Binds when equipped** (bind type 2). Quality, vendor price or item level never stand in for that;
- its summary on **that one market** is not stale (24 h) and not a low-confidence reading;
- the estimate is backed by more than one asking price: at least two listings, or a 14-day reference price from three or more days;
- the value is at least 1g (the add-on's own threshold starts above that).

The value is the lowest of the lowest ask, the typical ask and the reference price. Asking prices are not sales, so the cautious figure is used, and it is always an estimate. Variants are valued by their exact key and never lend a price to the base item. A character's market is its own faction's house on its own realm; unknown faction or no data means no market and no gold alerts.

## Bridge contract (schema 1)

`GET /api/bridge/loot/snapshot`, authenticated with the paired device's key. `If-None-Match: "<digest>"` answers 304.

```json
{
  "schemaVersion": 1,
  "generatedAt": 1791761400,
  "revision": 12,
  "digest": "9f2c41aa07d3b6e1",
  "characters": [
    {
      "id": "guildweaver-id:character-rook", "name": "Rook Shepard", "realm": "Live Realm", "region": "US",
      "aliases": ["character-rook"],
      "marketKey": "game:us:live-realm:alliance",
      "wishlist": { "revision": 5, "updatedAt": 1791761000, "items": [
        { "itemId": 5191, "itemKey": "i:5191", "priority": "high", "note": "Main hand", "name": "Cruel Barb", "qualityId": 3, "source": "The Deadmines" }
      ] }
    }
  ],
  "boe": {
    "floorCopper": 10000, "maxAgeSeconds": 259200,
    "markets": { "game:us:live-realm:alliance": { "name": "Live Realm Alliance", "items": [
      { "itemKey": "i:6694", "itemId": 6694, "value": 250000, "observedAt": 1791760800, "confidence": "medium" }
    ] } }
  }
}
```

- `revision` is the account's wishlist counter; `digest` covers everything except `generatedAt`. The bridge rewrites the add-on's file when the digest changes, independently of quests.
- `aliases` are the add-on's own ids for the character; the add-on matches the logged-in character by alias, then by name and realm.
- Only items still wanted are sent. Reading the snapshot reconciles the wishlists first, so an item the character now owns stops alerting after the next sync.
- Bounds: 20 characters, 200 wishlist items each, 4 markets, 300 watchlist items each, notes of 140 characters.

## Telemetry the add-on sends (payload schema 1)

`loot_roll` (event, stream `loot_roll:<characterId>:<rollKey>`): `{ schemaVersion, rollKey, evidence: "group_roll", outcome: "offered" | "won" | "not_won", startedAt, item: { itemId, itemKey, name?, qualityId?, quantity?, bindOnPickUp? }, acquired?: { basis: "chat_loot_self" }, context?: { instance, source?: { npcId, name, basis: "loot_window_single_source" }, encounter?, dungeonRun? } }`. Resent with the outcome when it is known; a resend is the same roll.

`loot_catalog_snapshot` (event, stream `loot_catalog:<journalInstanceId>:<difficultyId>`): `{ schemaVersion, sourceApi: "encounter_journal", complete, difficultyId, filters?: { classId, specId }, instance: { instanceId, journalInstanceId, name, type }, encounters: [{ journalEncounterId, name, complete, items: [{ itemId, name?, qualityId?, iconFileDataId? }] }] }`.

Both are optional. Older add-ons keep working: `mob_loot` alone feeds the catalog.

## Merge order and release dependencies

1. **Holdfast** first. It adds tables, routes and two telemetry handlers; nothing existing changes shape. Until the other two ship, the page works on its own (browse, wishlists, AI import).
2. **Bridge** second. It needs `/api/bridge/loot/snapshot`; against an older website the endpoint answers 404 and the bridge skips loot sync without touching quest sync or telemetry.
3. **Add-on** last. Without the bridge's file it has no wishlist and stays silent; with an older website its `loot_roll` and `loot_catalog_snapshot` events are stored as unhandled telemetry and are harmless.

Any order is safe; that order is the one in which each step is useful. Migration 23 is additive and runs under the usual pre-migration backup.

## Not built yet

- Automatic upgrade detection (the add-on reserves the blue "potential upgrade" category).
- External loot tables as catalog evidence (`external` provenance). Classic reference loot is served beside the catalog instead (see above), never as evidence.
- Drop rates in the catalog: sightings are positive evidence only, with no count of kills that dropped nothing.
- Variant-aware ownership: an owned item is matched by item id, so owning one variant counts for another variant of the same item.
