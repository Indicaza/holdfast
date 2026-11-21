# Dungeon quest preparation planner

The planner turns a dungeon's quest catalog (`Atlas/atlasQuests.js`) and a
character's quest state (`docs/dungeon-quest-readiness.md`) into an ordered
checklist: what to collect, from whom, in what order, what a party member can
share, when the character is ready to enter, and what to turn in after.
It reuses `Atlas/atlasReadiness.js` for every quest state and for readiness.
Nothing is invented: a location, a prerequisite or a shareability the data
does not state stays unknown.

## Editorial quest data contract (schema 1)

The contract between the Dungeon Content Studio (CMS, Worktree A) and the
planner (Worktree B). The CMS publishes one document per dungeon. The planner
treats it as **optional**: without it the planner runs on the catalog alone.

```json
{
  "schemaVersion": 1,
  "instanceId": 36,
  "revision": "cms revision id or null",
  "entrance": { "mapId": 1436, "x": 0.4205, "y": 0.7183, "zoneName": "Westfall",
                "verified": true, "source": "who checked it, how" },
  "instructions": [
    { "section": "collect" | "share" | "enter" | "turnIn", "text": "≤ 200 chars",
      "verified": false, "source": "…" }
  ],
  "quests": [
    {
      "questId": 166,
      "relevance": "dungeon" | "optional",
      "shareable": "yes" | "no" | "unknown",
      "prerequisites": [155],
      "giver":  { "name": "Gryan Stoutmantle", "location": { "mapId": 1436, "x": 0.5633, "y": 0.4752, "zoneName": "Westfall" } },
      "turnIn": { "name": "Gryan Stoutmantle", "location": { "mapId": 1436, "x": 0.5633, "y": 0.4752, "zoneName": "Westfall" } },
      "steps": [ { "text": "≤ 200 chars" } ],
      "notes": "≤ 500 chars",
      "verified": true,
      "source": "who checked it, how"
    }
  ]
}
```

Rules:
- Every field except `schemaVersion`, `instanceId` and `quests[].questId` is
  optional. An absent field inherits the catalog. `null` is the same as absent.
- `quests` is an array. A `questId` listed twice is a validation problem, and
  only the first entry is used.
- `prerequisites`, when given, replaces the catalog's chain for that quest and
  marks the chain known. Only ids are allowed (positive integers; a negative id
  means "must be in the quest log at the same time", as in the catalog).
- `location`: `mapId` is a UiMap id (the client's `C_Map` ids, the same ids the
  atlas uses); `x` and `y` are 0–1 fractions. A location without a valid
  `mapId` or with x or y outside 0–1 is dropped, never guessed. The add-on
  only sets a waypoint after the client confirms the map
  (`C_Map.GetMapInfo(mapId)`).
- `verified` and `source` are carried into every step and waypoint built
  from the entry. Unverified editorial data is still used, and it is shown as
  unverified.
- Telemetry, readiness and observed facts are never overridden. The contract
  has no field for a quest's state.
- The version is `schemaVersion`. New optional fields keep schema 1. A change
  that alters the meaning of a field bumps the schema, and the planner keeps
  reading schema 1.

Example fixture: `backend/test/fixtures/editorial-quest-plan.deadmines.json`
(synthetic, marked `"synthetic": true`).

## The plan (engine `backend/src/Atlas/atlasQuestPlan.js`, plan schema 1)

`buildQuestPlan({ dungeon, quests, state, questLog, editorial, wingKey, party })`
is pure and deterministic: the same input gives a byte-identical plan (no
clock; every list in a fixed order; the catalog's input order does not
matter). Every quest state comes from `atlasReadiness.js` (`questState`,
`prerequisiteStatus`); `readiness` is `evaluateReadiness` over the catalog
with the editorial data laid over it.

```json
{
  "schemaVersion": 1,
  "dungeon": { "instanceId": 36, "dungeonKey": "deadmines", "name": "…", "wingKey": null, "zoneName": "Westfall" },
  "editorial": { "used": false, "revision": null },
  "party": null,
  "readiness": { "readiness": "missing", "required": 5, "counts": { "completed": 0, "…": 0 } },
  "next": "collect:q168:travel",
  "sections": [ { "key": "collect", "steps": [Step], "notes": [{ "text", "verified", "source" }] }, "…" ],
  "waypoints": [Waypoint],
  "counts": { "collect": { "total": 0, "done": 0, "todo": 0, "blocked": 0, "unknown": 0, "ineligible": 0 }, "…": {} },
  "hidden": { "ineligible": 3 },
  "problems": [ { "code": "prerequisite-cycle", "questIds": [1, 2] } ]
}
```

Sections, always in this order: `collect`, `share`, `enter`, `optional`,
`repeatable`, `unknown`, `turnIn`.

- **collect**: the dungeon quests the character can take (ineligible ones
  are only counted in `hidden`), with every undone link of their chains.
  Topological: a prerequisite before the quests that need it, a shared one
  once. Among the quests that can come next: one in the zone of the step
  before, then by (zone, minLevel, questId); no zone sorts last. A completed
  or accepted dungeon quest is one collapsed `done` step and its chain is not
  listed. A dungeon quest that waits on another dungeon quest not done yet
  is not here: it is a `follow-up` in turnIn. Step kinds: `quest`,
  `prerequisite`; children `travel` (left out when the step before has the
  same giver at the same spot), `accept`, `complete-prerequisite` (a
  prerequisite to finish and turn in, or a prerequisite the catalog does not
  list: "not in our data") and `note` (editorial steps).
- **share**: collect quests with `shareable: "yes"` whose state is
  `available` (eligible, prerequisites met). Children: `ask-share`, then the
  `travel` fallback (`optional: true`). No group member is assumed to hold it.
- **enter**: `verify` (every collect `quest` step done), `travel` to the
  entrance (editorial entrance, else the atlas's), `enter`.
- **optional**, **repeatable**: one step per quest of that relevance.
- **unknown**: quests of unknown relevance, and quests in a prerequisite
  cycle, with `reasons`.
- **turnIn**: accepted quests (not prerequisites): `turn-in` when the quest
  log says the objectives are complete (`objectivesComplete: true`; status
  `unknown` when it does not say), `finish-objectives` when it says they are
  not. A turn-in waypoint only from editorial `turnIn`; otherwise
  `location: "not-in-our-data"` (no source has quest enders; objective text
  is never parsed). Then `follow-up`: quests a dungeon quest unlocks.

Step: `{ id, kind, questId, status, text, waypoint, verified, source,
children, location?, optional?, reasons?, collapsed?, objectivesComplete? }`.
`id` is stable (`collect:q166`, `collect:q166:travel`, `share:q168:ask`,
`enter:verify`, `turnin:q166`, `followup:q2199`). `status`: `done`, `todo`,
`blocked` (waits on an earlier quest), `unknown`, `ineligible`. `source`:
`catalog`, `editorial` or `atlas`. `text` is short English; clients may
word it their own way.

Waypoint: `{ id, mapSystem: "uiMap", mapId, x, y, zoneName, target,
targetType: "quest-giver" | "prerequisite-giver" | "turn-in" | "entrance",
source, verified }`, built only from a positive mapId and 0–1 coordinates.
Catalog giver positions are AzerothCore spawns projected onto UiMap ids:
`verified: false`, not checked on Forever.

`next` is the first `todo` leaf (not a note, not an optional fallback) in
collect, then in turnIn's `turn-in` steps, then in enter; `null` when
nothing is known to be doable (for example, no quest state reported).

Problems: `duplicate-quest`, `prerequisite-not-in-catalog`,
`prerequisite-cycle`, `invalid-quest`, and `editorial-*` (schema, instance,
invalid field, dropped location/instruction/quest, duplicate, not in catalog).

## API

- `GET /api/player/loot/dungeons/:id/plan?character=` — the caller's own
  character (per realm), from the quest state the add-on last synced; same
  ownership and realm handling as `/readiness` (anyone else's character
  answers 404). Adds `characterId`, `character` (capture times and coverage,
  or null) and `questList`.
- `POST /api/player/loot/dungeons/:id/plan` `{ state, party? }` — the state
  as `/readiness` takes it; `state.questLog.entries` (`{ questId,
  isComplete }`) may stand in for `questIds`. 400 with `problems` for an
  invalid state. A document sent in the body is ignored.
- `POST /api/admin/atlas-studio/dungeons/:id/plan-preview`
  `{ state?, document?, party? }` (site.admin) — the plan over the studio's
  draft: the document sent, else the saved draft, else the published revision.
  Answers `draft: true`. Without `state`, a character that reported nothing.

`:id` is an instance id, a dungeon key or a wing key, as everywhere else.

## CMS integration

Player plans (GET and POST) read editorial data through one hook,
`loadEditorialQuestPlan(instanceId)` in
`backend/src/Atlas/atlasQuestPlanRepository.js`, which returns the studio's
active published revision (`publishedEditorialQuestPlan`,
`backend/src/Atlas/editorialQuestPlan.js`) or null. Drafts reach a plan only
through the studio's `plan-preview` route. The planner validates whatever it
gets, so a bad document gives `problems`, never a broken plan.
`test/questPlanEditorialIntegration.test.js` covers draft isolation, preview,
publish (shareability, turn-in waypoint, instructions, an edited Hall of
Thanes chain) and unpublish.

## Add-on

`Systems/DungeonQuestPlan.lua` (Indicaza/guildweaver) runs the same rules
over the packaged catalog, without editorial data. `scripts/questPlanParity.mjs`
there writes `test/fixtures/quest-plan-parity.json` from this engine, and
the add-on's spec compares ids, kinds, statuses, order and waypoints.
