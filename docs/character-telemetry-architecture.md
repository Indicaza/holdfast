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
- Rates are always successes over every eligible observation under the same
  filters, with a Wilson interval and a confidence label
  (`Economy/farmingStatistics.js`).

To add a collector (mining, skinning, fishing…): emit the same
source / outputs / context shape under a new `discipline`, add its event type
to `ECONOMIC_EVENT_TYPES` and register a handler like `gatheringLoot.js`.
The source browser and modal pick it up unchanged.
