# Dungeon quests and readiness

Sprint step 4A. This document covers four things:
- the dungeon quest catalog;
- the rules that say whether a character holds every dungeon quest it can
  before going in;
- the API;
- the quest-state contract the Guildweaver addon implements in Step 4B.

All quest facts are Classic reference data (AzerothCore and DungeonPlanner),
never proof of a WoW Forever quest. Every served quest says
`verifiedForForever: false`.

## Catalog

The catalog is `backend/src/Atlas/data/quest-catalog.json`.
`scripts/importDungeonAtlas.mjs` generates it (and `--check` checks it),
building it in `Atlas/atlasQuests.js` from two extracts:

- **`sources/azerothcore-quests.json`**, from AzerothCore at the atlas's pinned
  commit, written by `fetchDungeonAtlasSources.mjs --quests-only [--from <dir>]`
  (`Atlas/atlasQuestSources.js`). It covers every vanilla quest that has any of
  the following, plus its prerequisite chain and breadcrumbs:
  - **evidence:** a creature or object it asks to kill or use, an item it asks
    for that a creature or object drops, or the creature or object that gives
    it, when every spawn of that creature or object is inside one vanilla
    instance;
  - **its dungeon's zone** (`QuestSortID`, the atlas's old rule);
  - **a place on a DungeonPlanner list.**
- **DungeonPlanner's dungeon quest lists**, the `quests` table of
  `sources/dungeonplanner-loot.json` (from Wowhead Classic zone pages).

Each quest has exactly one relevance per dungeon:

| Relevance | Meaning | Shown by default | Counts for readiness |
| --- | --- | --- | --- |
| `dungeon` | DungeonPlanner lists it for this dungeon | yes | yes |
| `optional` | not listed, but its objectives or giver are in the dungeon (side quests, turn-ins) | yes | no |
| `prerequisite` | in the `PrevQuestID` chain of a shown quest, or a breadcrumb to one | yes | no (it decides `prerequisites`) |
| `repeatable` | repeatable (`SpecialFlags`) or daily | yes | no |
| `unknown` | DungeonPlanner lists it, but no quest record exists | yes | no |
| `zone` | only the dungeon's zone ties it here | no (`?include=all`) | no |

Each catalog quest has these fields:
- identity: `questId` (the canonical id), `name`;
- levels: `level`, `minLevel`, `maxLevel`;
- who may take it: `faction` (`alliance`, `horde`, `both`, or `null` when
  unknown), `races` and `classes` (only when the masks narrow them);
- chain: `repeatable`, `prerequisites` (`[{ questId, name, mustBeActive? }]`,
  from AzerothCore's `PrevQuestID` only), `exclusiveGroup`, `breadcrumbFor`,
  `requiresReputation`, `startsFromItem`;
- where it starts: `giver` (`{ kind, id, name, location }`; the location is
  set only when the giver has a single spawn);
- content: `objective`, `rewards`;
- placement: `wing` (a wing key, only when every piece of evidence is that
  wing's bosses or rares; otherwise `null`, meaning shared by the dungeon),
  `evidence` and `sources`.

Nothing is inferred: no prerequisite, faction or class that the source rows
don't state.

### Coverage

| Dungeon | Before (atlas quests) | dungeon / optional / prerequisite / repeatable / zone / unknown | Shown by default |
| --- | --- | --- | --- |
| Shadowfang Keep | 3 | 3 / 1 / 0 / 0 / 0 / 0 | 4 |
| Stormwind Stockade | 6 | 6 / 0 / 3 / 0 / 0 / 0 | 9 |
| Deadmines | 5 | 5 / 0 / 7 / 0 / 0 / 0 | 12 |
| Wailing Caverns | 12 | 11 / 1 / 4 / 1 / 0 / 0 | 17 |
| Razorfen Kraul | 0 | 6 / 28 / 17 / 5 / 0 / 0 | 56 |
| Blackfathom Deeps | 11 | 9 / 1 / 1 / 1 / 0 / 2 | 14 |
| Uldaman | 0 | 29 / 27 / 23 / 7 / 0 / 0 | 86 |
| Gnomeregan | 0 | 24 / 26 / 7 / 8 / 0 / 1 | 66 |
| Sunken Temple | 10 | 9 / 12 / 44 / 0 / 0 / 1 | 66 |
| Razorfen Downs | 7 | 7 / 0 / 0 / 0 / 0 / 0 | 7 |
| Scarlet Monastery | 6 | 6 / 20 / 17 / 5 / 0 / 1 | 49 |
| Zul'Farrak | 0 | 10 / 19 / 8 / 2 / 0 / 0 | 39 |
| Blackrock Spire | 0 | 37 / 8 / 34 / 0 / 0 / 0 | 79 |
| Blackrock Depths | 0 | 39 / 6 / 17 / 11 / 0 / 1 | 74 |
| Onyxia's Lair | 0 | 0 / 1 / 1 / 0 / 0 / 0 | 2 |
| Scholomance | 13 | 12 / 3 / 25 / 1 / 0 / 0 | 41 |
| Zul'Gurub | 48 | 0 / 26 / 9 / 30 / 36 / 0 | 65 |
| Stratholme | 16 | 16 / 8 / 24 / 0 / 0 / 2 | 50 |
| Maraudon | 11 | 11 / 1 / 0 / 0 / 0 / 0 | 12 |
| Ragefire Chasm | 6 | 6 / 0 / 3 / 3 / 0 / 0 | 12 |
| Molten Core | 8 | 2 / 4 / 13 / 0 / 5 / 0 | 19 |
| Dire Maul | 38 | 30 / 6 / 12 / 6 / 0 / 3 | 57 |
| Blackwing Lair | 2 | 1 / 2 / 12 / 0 / 0 / 0 | 15 |
| Ruins of Ahn'Qiraj | 1 | 1 / 1 / 0 / 0 / 0 / 0 | 2 |
| Ahn'Qiraj Temple | 79 | 0 / 47 / 2 / 4 / 29 / 0 | 53 |
| Naxxramas | 91 | 1 / 1 / 0 / 0 / 89 / 0 | 2 |

Every quest the old atlas listed is still in the catalog (a test checks this).
The old 40-quest cap was the addon exporter's; this catalog has no cap. The
raids' 29–89 zone-only turn-ins are kept but hidden by default.

### Known gaps

- **No curated list** for Zul'Gurub, Ahn'Qiraj Temple and Onyxia's Lair. None of
  their quests counts toward readiness, so readiness is `none`. Onyxia's
  attunement chain is filed under other zones in the source data and isn't
  linked here.
- **Naxxramas:** AzerothCore's creatures are the WotLK version, so its Classic
  turn-ins have no in-dungeon evidence and stay `zone`.
- **Wing attribution:** neither source attributes a quest to one wing.
  Evidence names a wing only in Blackrock Spire (3 Lower, 1 Upper). Every
  other wing's quests are shared by the dungeon.
- **Reputation:** quests that require a reputation are always `unknown`,
  because the state contract carries no reputation.
- **Exclusive groups:** `exclusiveGroup` is reported but not evaluated.
- **12 `unknown` quests:** DungeonPlanner lists them, but AzerothCore has no
  record for them.
- **Noise:** some `optional` quests are class or profession quests that only
  pass through a dungeon.

## Readiness

`Atlas/atlasReadiness.js` is pure and deterministic. It reads only the
catalog and the character state it is given.

### Character state, schema 1

```
{
  "schemaVersion": 1,
  "faction": "alliance" | "horde" | null,
  "race": "Human" | "Orc" | "Dwarf" | "NightElf" | "Scourge" | "Tauren" | "Gnome" | "Troll" | null,
  "classToken": "WARRIOR" | ... | "DRUID" | null,
  "level": 1-100 | null,
  "completed": { "coverage": "full" | "checked" | "none", "questIds": [int], "checkedQuestIds": [int] },
  "questLog":  { "coverage": "full" | "none", "questIds": [int] }
}
```

- `completed.coverage`:
  - `full`: the client's whole completed list (`C_QuestLog.GetAllCompletedQuestIDs`
    or `GetQuestsCompleted`).
  - `checked`: only `checkedQuestIds` were asked (`IsQuestFlaggedCompleted`),
    and `questIds` are the ones that answered yes.
  - `none`: nothing is known.
- `questLog.coverage`: `full` means a complete scan of the quest log;
  otherwise `none`.
- **A quest missing from a list proves nothing** unless the list's coverage
  says it is complete. Any fact that isn't reported (`null`, `none`) makes
  the quests that depend on it `unknown`.

### Quest states

| State | When |
| --- | --- |
| `completed` | the client reports it completed (repeatable quests never stay completed) |
| `accepted` | it is in the quest log |
| `ineligible` | faction, race, class or level rules it out (reason given) |
| `prerequisites` | a prerequisite is known not to be done (or, for `mustBeActive`, known not to be in the log) |
| `available` | none of the above, and every fact needed is known |
| `unknown` | a fact needed is not reported: completion, quest log, faction, race, class, level, a prerequisite's state, or a reputation |

### Readiness

Readiness is decided over the `dungeon` quests that apply: ineligible ones
are left out, and for a wing, quests attributed to a sibling wing are left
out.

| Readiness | When |
| --- | --- |
| `missing` | at least one is `available` (known, collectable, not taken) |
| `blocked` | none is available, at least one waits on `prerequisites` |
| `unknown` | none missing or blocked, at least one `unknown` |
| `ready` | every one is `completed` or `accepted` |
| `none` | no dungeon quest applies |

Optional, prerequisite, repeatable and unknown-relevance quests are returned
in their own lists and never change readiness. A character is never `ready`
while any required quest's state is unknown.

## API (optional additions; existing responses unchanged)

- `GET /api/player/loot/dungeons/:id/quests[?include=all]`
  - `:id` is an instance ID, a dungeon key or a wing key.
  - Returns `{ schemaVersion, dungeon: { instanceId, dungeonKey, name, wing }, curated, relevance, included, hiddenZoneQuests, quests, sources }`.
  - Quests are catalog entries, with `rewards` as ReferenceItems.
  - A wing leaves out its sibling wings' quests.
- `POST /api/player/loot/dungeons/:id/readiness` with body `{ "state": <character state> }`.
  - Returns `{ dungeon, schemaVersion, readiness, counts, required, quests, optional, prerequisites, repeatable, unknownRelevance }`.
  - Each entry is `{ questId, name, relevance, wing, state, reasons }`.
  - A bad state gives `400 invalid_quest_state` with `problems`; an unknown
    dungeon gives `404`.
  - Nothing is stored.

## Step 4B: the addon's `quest_state` payload

The addon sends one state stream per character. The envelope is v1:
- `eventType` `quest_state`;
- `streamKey` `quest_state:<characterId>`;
- `kind` `state`.

Envelope fields keep each server and character apart:
- `characterId`;
- `realm`;
- `region`;
- `gameBuild`.

```
payload (schemaVersion 1) {
  schemaVersion: 1,
  capturedAt: <server time>,
  faction, race, classToken, level,          // as in the character state
  completed: { coverage, questIds, checkedQuestIds? },
  questLog:  { coverage, entries: [{ questId, isComplete: bool | null }] }
}
```

- Only quest ids are sent; no names, no free text.
- `completed.coverage` must be `full` only when the client gave its whole
  list. `checked` must name exactly the ids that were asked.
- `questLog.entries` lists the quest log's quests. `coverage: full` only after
  a complete scan, never while the log is still loading.
- The server turns a stored payload into the character state above
  (`questLog.questIds` = the entries' ids) and calls the readiness model. No
  ingest exists yet; until it does, the website can post a state to
  `/readiness`.
