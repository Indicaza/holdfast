# Public item catalog and game facts

The first dataset journey is `/items` → item → observed sources → crafting uses. Anyone can browse it without Discord sign-in. Facts are scoped to an explicit client build and locale; the interface picks the newest observed scope when the URL has no scope. Item and recipe links retain that scope.

## Read-only API

| Endpoint | Purpose |
| --- | --- |
| `/api/game-data/v1/icons/132889` | Public icon redirect, restricted to observed item FileDataIDs |
| `/api/game-data/v1/scopes` | Available build/locale pairs and item counts; at most 100 scopes |
| `/api/game-data/v1/items?build=70338&locale=en_US&q=linen` | Search names or an exact item ID |
| `/api/game-data/v1/items/2589?build=70338&locale=en_US` | Base definition, sources, recipes, and approximate map cells |

`build` and `locale` are required on item endpoints. Canonical locales look like `en_US`; `und` means language unknown. Unknown-language history is included in a requested locale, while localized definitions take precedence. An unknown-language scope is hidden when that build has localized data. Search is case-insensitive, treats SQL wildcard characters literally, and accepts up to 100 characters. Results sort by item ID; `after` is the exclusive ID cursor and `nextAfter` is null at the end. Default page size is 40; `limit` is 1–100. Item pages cap sources and each recipe relationship at 50, with explicit truncation flags, and map cells at 100. Missing items return 404; invalid queries return 400. JSON responses use ETags and 60-second public cache headers. JSON reads have a 120-request/minute/IP limiter; icons have a separate 1,200-request/minute/IP limiter and no public mutation routes.

This API is usable by a future read-only chat integration without exposing a player profile. Public pages are client-rendered; providing a JSON endpoint does not automatically register a ChatGPT tool or guarantee crawler indexing.

## Evidence contract

`mob_loot` payload v1 has one numeric NPC source, its exact source GUID, and positive item quantities assigned by the client's per-slot GUID/quantity pairs. The addon never assigns an entire area-loot window to the current target. Names are optional; NPC IDs remain searchable evidence when a source was never targeted. Pick Pocket, skinning, herbalism/mining on creatures, container/object loot, coins/currencies, incomplete mappings, and empty windows do not become corpse drop observations.

The server hashes a corpse identity scoped by region, realm, and build, then stores each item once with its **maximum observed quantity**. Duplicate bridge retries, corpse reopens, later partial views, and multiple party observers do not add quantity or another sighting. Additional items can extend a cumulative corpse report. New corpse facts are language-independent; bounded localized labels live in the existing text columns and are resolved into plain requested-language strings on reads. Legacy locale-scoped keys and plain labels remain compatible without a migration. GUID lifetime is client/server-defined; these are best-effort unique-corpse sightings, not an authoritative kill census.

Sources remain separated by activity, gathering discipline, numeric source identity, map, instance, and difficulty. The corpus has visibility, quest-eligibility, and submission biases. A source table's sightings are positive observations for that item, never a denominator of eligible kills. Empty/unseen loot is not a zero drop. The first release exposes no drop percentages. Loot-window units describe what was offered, not proof of acquisition. These are client-reported, unverified game facts.

## Public boundary

Public readers query dedicated fact tables, not private telemetry, character snapshots, or arbitrary catalog metadata. A separate `game_item_definition` stream scans a bare `item:<id>` reference with a rendered `SetHyperlink` tooltip. The ingest handler requires that reference, capture basis, and renderer; item-instance links are rejected. The projection whitelists static fields and strips identity hyperlinks, raw GUIDs, and creator lines. Existing rich bag/equipment `item_definition` tooltips are never exported.

Recipe projections include only IDs, game names, profession identity, output quantities, requirements, and reagent IDs/quantities. They omit known/craftable flags, owner identity, inventory availability, cooldowns, instance links, and observed-item tooltips. Seeing an item in a bag provides no source attribution.

Public responses omit player/member/guild/character/device/installation identities, raw corpse GUIDs, private observation keys, exact capture timestamps, individual sessions, inventories, and paths. Precise UI-map coordinates stay in private observations. Public map cells are 2% wide, report the cell center, and require at least three distinct contributing members in the same source/map/instance/difficulty/position-kind cell. Duplicate observers of a shared corpse count conservatively as one contributor. Positions mean **player at looting/cast**, not a measured NPC/node spawn position. Unsupported coordinates remain missing.

## Persistence and rollout

Migration 11 adds the fact tables and indexes without changing released migrations or private economic tables. New projections commit atomically with telemetry ingest. Facts survive bounded raw-history pruning. Startup performs an idempotent, transactionally marked backfill from durable gathering observations and canonical profession states in bounded batches. Existing gathering records have unknown locale (`und`); private item-instance definitions are deliberately excluded. A startup backup remains required before migrations; allow time for the first backfill on a large corpus.

Merge/deploy the website first, then distribute the addon; the bridge contract PR verifies compatibility and needs no runtime configuration change. Older addons continue to upload their existing event types. New item base descriptions fill on subsequent item sightings or inventory refreshes.

## Verification

Automated checks cover exact allocations, duplicate/reopen/reload suppression, shared-corpse aggregation, mixed sources, skinning exclusion, invalid coordinates, privacy whitelists, build/locale isolation, stale and sparse reports, rollback, migration/backfill, pagination, public browser search/deep links, recipe navigation, empty states, mobile layout, and bridge retries.

Live-client testing remains required after the game returns: loot an ordinary corpse; area-loot two NPC types with a shared stack; compare two party observers; reopen/reload; skin a previously looted corpse; loot a dungeon boss; observe an uncached item; use a map that cannot return player coordinates. Reload/logout to flush SavedVariables, run the bridge, and verify `/items`. The first release does not add an in-addon search UI, MCP server, chat app, or expiring player snapshots.
