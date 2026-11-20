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
