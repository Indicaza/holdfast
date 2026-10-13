# Character telemetry architecture

How Guildweaver telemetry becomes what the website shows for a character, and
how to add a new kind of telemetry without breaking the rest.

## The rule

Every write path ends in one place, the **character read model**
(`backend/src/Character/ReadModel/`), and every character read (the character
cards, the character modal, the craft finder) comes from it. Nothing renders
from raw telemetry history.

```
addon streams ─┐                                   ┌─ GET /api/intelligence           (cards)
               ├─ ingest ─ raw record (bounded) ─┐ │
legacy         │          latest state per stream├─┼─ GET /api/intelligence/characters/:id (modal)
character  ────┘                                 │ │
snapshot                    projectors ─ writer ─┴─┴─ craft finder / recipe search
                                 │
                       character_sections  (one row per character × section)
                       character_cards     (the list's columns)
                       talent_tree_definitions
```

- **Sections.** A character is a set of sections: `identity`, `stats`,
  `equipment`, `talents`, `professions`, `profession_books`, `inventory`.
  Each telemetry stream projects into the sections it describes
  (`projectors.js`). Per section, **the newest capture wins** (ties go to the
  later arrival), whichever stream sent it. A late or replayed older capture
  never rolls a section back.
- **Weak sections.** A section the addon marked partial or unavailable, or one
  that arrived empty, only fills a gap. Login-time and teardown captures can
  never blank real data.
- **Identity.** A character's own `character` / `character_snapshot` stream is
  enough to create it. Streams that arrive before the website knows the
  character wait in their latest state and are replayed onto it when it is
  created (`replayPendingTelemetryInDatabase`). A second computer's anonymous
  id joins the same character by member, name and realm.
- **Derived rows** (the card, the `characters` display columns, the craft
  finder's profession and recipe rows) are refreshed from the sections whenever
  one changes.
- **Rebuild.** The read model can always be rebuilt from stored telemetry
  through the same writer (`rebuildReadModel.js`). Bump `READ_MODEL_VERSION` to
  rebuild it on the next start.

## Live updates

The writer reports which sections changed. `Live/characterChangeEvents.js`
coalesces a bridge sync's burst into one `character.changed` event per
character, naming the sections, and sends nothing when nothing changed.

The frontend never remounts intelligence pages for live updates.
`useLiveResource` refetches in the background and keeps the last good data on
screen; the character modal refetches only for its own character. The open
character is in the URL (`?character=`), so nothing can lose it.

## Revisions

The addon keeps each state stream's revision counter apart from its outbound
record (pruning removes session events first), and the bridge resends a
stream whose content changed even when its revision went backwards. The
server accepts that new content at a reused revision. A wiped SavedVariables
or a recreated stream therefore never freezes a section.

## Adding a telemetry domain

1. Addon: a `TelemetryDomain` (`Telemetry/Domains/`), registered in
   `Telemetry/Registry.lua`.
2. Website: a handler (`Telemetry/handlers/`) that validates the payload and,
   if the website needs a stable shape, canonicalizes it.
3. Website: a case in `sectionsFromTelemetry` mapping it to a section (a new
   one goes in `SECTIONS`), and, for a new section, its place in
   `composeCharacterArmory`.
4. Tests: ingest it, then read it back through `readCharacterArmoryFromReadModel`.

Nothing else reads it, so nothing else can disagree about it.

## Events: economic observations

Not all telemetry is character state. `gathering_loot` (and later fishing,
creature loot, disenchanting and crafting) is an **event**: something that
happened once, with a unique stream key per observation. Events never touch
the character read model.

```
gathering_loot ─ ingest ─ raw record (bounded, for debugging)
                    └─ handler.recordEvent ─ economic_observations         (one row per gather)
                                             economic_observation_outputs  (one row per item)
                                                   │
                         Economy/farmingRepository ┴─ GET /api/intelligence/farming/sources[/:sourceKey]
```

- A handler with `recordEvent` (`Telemetry/handlers/gatheringLoot.js`) is
  how an event reaches its domain; the transport stays generic. Every
  well-formed envelope is accepted (so the raw record is kept); payloads the
  domain cannot analyse are skipped.
- `Economy/economicObservationModel.js` normalizes a payload into one
  observation (source, context, build) and its merged outputs. A source is
  identified by discipline, kind and name (`herbalism:herb-node:peacebloom`),
  so the several game objects of one herb are one source, and an unnamed node
  joins the named source with the same object id.
- Observations are idempotent by `observationId`; raw records are pruned but
  observations are kept. Raw economic events that predate a collector are
  backfilled on startup.
- Bountiful Harvest (one Legacy Professions talent shared by Herbalism,
  Mining and Skinning) is stored per observation whatever the discipline; a
  missing rank is unknown, not rank 0.
- Each newly recorded observation publishes a `farming` live update naming
  its source, so the farming browser and an open source window refresh in
  place as the bridge syncs.
- `GET /api/intelligence/farming/status` (site admins) answers "is gathering
  telemetry reaching Farming?": raw economic events received (within raw
  retention), how many became observations, and the record ids of any that
  could not be analysed. A resent gather re-links its observation to the
  newest raw copy, so resends never look like losses.
- Rates are always successes over every eligible observation under the same
  filters, with a Wilson interval and a confidence label
  (`Economy/farmingStatistics.js`).

To add a collector (mining, skinning, fishing…): emit the same
source / outputs / context shape under a new `discipline`, add its event type
to `ECONOMIC_EVENT_TYPES` and register a handler like `gatheringLoot.js`.
The source browser and modal pick it up unchanged.

## Farming sessions and map observations

`farming_session` is an envelope-v1 event domain. Sequence-numbered cumulative records keep `sessionId`, mode, start/end, elapsed seconds, optional AFK seconds and expected harvest count. The durable projection is keyed by member + installation + session id; stale checkpoints cannot replace a final run. Gather observations join by `context.farming.sessionId`, independently of arrival order. Material rates remain unavailable until the completed run has all expected harvests and meets the 20-minute/10-harvest minimum. Yields currently mean items offered in a loot window, not verified acquisition.

`GET /api/intelligence/farming/sessions` returns up to 100 recent runs, filtered by realm, build or mode, without member/device/character identities. Timed runs measure the declared interval; automatic runs estimate first-to-last gathering and split on gaps above ten minutes. Travel/waiting remains included between observations. AFK-excluded rates require a separately sufficient non-AFK window. Interrupted/open runs never produce hourly rates. The Farming page exposes both timing modes and short/incomplete samples.

`GET /api/intelligence/farming/sources/:sourceKey/locations` returns up to 2,000 aggregated map points (default 500), with optional mapId/realm/region/build filters. Coordinates use UI map ids and `[0,1]` normalized positions; response points round to four decimal places while the facts retain the collector's five decimals. Locations describe `player_at_cast`, not exact object positions. Missing, null, partial, nonfinite, unsupported-system and out-of-range positions are excluded. `truncated` indicates further map cells exist. Responses include realm/build context and observation counts, not player identities or movement trails. Both endpoints require authentication.

Deployment order: website first, bridge contract tests second, addon third. Existing envelope/SavedVariables versions and gathering events remain compatible. Migration 10 adds session/context fields without changing previous migration bodies or deleting data. Old observations remain useful for drop tables; they are not retroactively assigned invented farming durations.
