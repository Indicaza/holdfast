# Notices

Holdfast's code is MIT-licensed (`LICENSE`). Some of the data it carries
comes from others, under their own terms:

| Data | Where | Terms |
| --- | --- | --- |
| ForeverDB.net's add-on data (item facts, loot, drop rates its players measured) and everything built with it | `backend/src/Atlas/data/foreverdb/` only | **GPL-3.0 with ForeverDB.net's attribution term** (that directory's `COPYING.txt` and `FOREVERDB-LICENSE.txt`), not MIT. Data from ForeverDB.net (https://foreverdb.net) |
| World of Warcraft and WoW Forever client tables (via wago.tools) | `backend/src/Atlas/data/sources/wago-*.json` and the data built from them | Factual game data; Blizzard Entertainment's. World of Warcraft is a trademark of Blizzard Entertainment, Inc.; Holdfast is not affiliated with or endorsed by Blizzard |
| AzerothCore world database extracts | `backend/src/Atlas/data/sources/azerothcore*.json` | GPL-2.0 (https://github.com/azerothcore/azerothcore-wotlk) |
| DungeonPlanner drop and quest lists | `backend/src/Atlas/data/sources/dungeonplanner-loot.json` | See docs/dungeon-atlas-sources.md |
| OpenMap's Forever place tables | `backend/src/Atlas/data/sources/forever-instances.json` | MIT (https://github.com/openmap-world/openmap) |

Removing `backend/src/Atlas/data/foreverdb/` removes all of ForeverDB's data;
the site then serves the base data built without it.
