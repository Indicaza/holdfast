# Loot intelligence: sources, coverage and how they combine

Findings of the loot-source investigation (2026-11-20) and how Holdfast uses
the sources it imports. The Dungeon Atlas's existing sources (AzerothCore,
DungeonPlanner, the Classic Era client) are in
[dungeon-atlas-sources.md](dungeon-atlas-sources.md).

## Sources investigated

| Source | What it offers (verified) | Licence and terms | Decision |
| --- | --- | --- | --- |
| **wago.tools**, product `wowf` | The WoW Forever client's own DB2 tables as CSV: `ItemSparse` (19,326 named items: name, quality, item level, required level, slot, binding, class mask, set, sell price), `Item` (32,008 items: class, subclass, slot, icon, including items the client does not name). Builds listed at `/api/builds` (`wowf` 1.60.1.70959, 2026-11-17). The Forever `ItemSparse` format carries **no** stat, armour or damage values (the client derives them). | Blizzard game data; wago.tools' robots.txt allows `/api/` and `/db2/*/csv` exports only, which is all we use. | **Integrated** (PR 1): the most trusted item facts. |
| **ForeverDB** ([foreverdb.net](https://foreverdb.net)) | Datamined from the Forever client (build 1.60.1.70959) plus its players' add-on records. Its add-on data files are public downloads listed with SHA-256 in `downloads/addon-manifest.json`: `Gear.lua` (slot, class, subclass, required level, stats, DPS, armour for 11,965 items, including ones the client hides), `GearSources.lua` (names), `Loot.lua` (per boss: item, drop % **measured over looted kills** with the kill count, whether seen in Forever or Classic data, drops seen; 30 instances, 4,236 rows, 1,869 seen in Forever). Its JSON API needs an approved key (Battle.net login), which we do not have. | GPL-3.0 with an attribution term (section 7(b)): show "Data from ForeverDB.net" with a link to https://foreverdb.net wherever the data is shown. | **Integrated** (PR 1 item facts, PR 2 loot and rates), from the add-on files, with the credit. |
| **NorgannonDB** ([zmarotrix/NorgannonDB](https://github.com/zmarotrix/NorgannonDB)) | Forever 1.60.1 database (26,575 items, 601 loot tables). Forever's own instance loot comes from *DungeonJournal by Exehn*, "used with the author's permission"; it has no drop chances for it. | GPL-3.0; the DungeonJournal part is a permission granted to NorgannonDB, not to us. | **Validation only.** It agrees with ForeverDB on Witherfang's four drops (names, classes, required level 15). Not imported: the Forever loot in it is a third party's, under a permission that is not ours. |
| **TheWoWDB** ([developers](https://thewowdb.com/developers/)) | Free keyless JSON API (`/api/v1/forever/...`, 120-request burst, 2/s). Its Forever items are the beta client's `ItemSparse` (build 1.60.1.70532): no Witherfang, no Cruel Barb, no NPC loot. | Free with a visible link; "do not resell the raw data as a dataset". | **Excluded**: the same client table we read from wago.tools, older. |
| **Forever Assist** ([drops](https://www.forever-assist.com/en/dungeons/drops)) | Player dungeon logs for the nine Forever dungeons: kills per boss and items seen (Ruins of Lordaeron: 3 logs). Names partly in Korean, no item ids on the page. | Its `/api/` is disallowed to robots; no documented data access. | **Excluded** (manual cross-checks only): no structured access, samples too small. |
| **wow-forever-kb** ([gBlaku](https://github.com/gBlaku/wow-forever-kb)) | Daily rebuild from wago.tools `wowf` + QuestieDB Forever + vmangos (Classic) loot; static JSON/SQLite. | The repository has no licence; it is a compilation of other sources. | **Excluded as a source**; we read its primary source (wago.tools) directly. Its README's notes on the Forever format matched what we found. |
| Icy Veins, ForeverChanges, Battle.net / Blizzard APIs | Not investigated in this pass (no documented Forever data access found quickly). | | Open. |
| AzerothCore, DungeonPlanner, Classic Era client | Already in the atlas (dungeon-atlas-sources.md). | GPL-2.0; facts only; Blizzard data. | Kept, now the lowest precedence. |

## Precedence and provenance

`src/Atlas/itemDefinitions.js` merges item facts **per field**, in this order:

1. `wago-forever` — the Forever client's tables.
2. `foreverdb` — ForeverDB (its datamine of earlier Forever builds and its players).
3. `wago-classic-era` — the Classic Era client (Classic reference).

A field keeps the first source that states it; a lower source never
overwrites a higher one. Each definition lists, per source, the fields it
supplied (`provenance`), and every field two sources state differently is
kept in `conflicts` with both values. A field no source states is absent:
unknown, never guessed (an item the Forever client does not name has no
quality unless a source gives one). `category` follows the item class:
equipment, quest, recipe, material, consumable, container, other.

ForeverDB's `Gear.lua` layout is its own and undocumented; the fetch script
checks its inventory type and required level against the Forever client on
every item both know (485 agree, 0 disagree at build 1.60.1.70959) and
refuses the file if more than one in a thousand disagree.

## Files

| File | Written by | What |
| --- | --- | --- |
| `data/sources/wago-forever-items.json` | `scripts/fetchLootSources.mjs` | The Forever client's facts for the 4,101 items the atlas needs (4,098 found; 2,796 the client does not name) |
| `data/sources/foreverdb-items.json` | same | ForeverDB's gear facts and names for those items (2,695), the files' SHA-256 |
| `data/sources/foreverdb-loot.json` | same | ForeverDB's loot rows for the atlas's 30 instances it covers (4,733), with rates, kills and seen counts (used by PR 2) |
| `data/item-definitions.json` | `scripts/importDungeonAtlas.mjs` | The canonical definitions (4,098 items), their sources and a report |
| `data/reference-loot.json` | same | As before, its item facts now from the definitions; `itemFactSources` names them, each item's `factSources` says which it used |

Refresh: `node scripts/fetchLootSources.mjs [--build <wowf version>] [--cache <dir>]`,
then `node scripts/importDungeonAtlas.mjs`. `--from <cache>` reruns offline;
`--check` on either compares without writing. Downloads are one at a time
with a pause; ForeverDB files are verified against their manifest's SHA-256.

## Coverage, before and after (PR 1)

| | Before | After |
| --- | --- | --- |
| Reference loot items with facts | 2,204 | 2,367 |
| Drops listed by id only (gaps) | 191 (190 items) | 8 |
| Dungeons with reference loot | 26 | 33 (Blackmaw Hold and Shaper's Terrace: no list) |
| Original bosses without reference loot | 10 | 3 (The Vault, Ezra Grimm, The Molten Core) |
| Item facts from the Forever client | none | 4,098 items (1,302 named by it) |

Of the 190 items known by id only: the Forever client names 20, ForeverDB
names 162 (the client does not), 8 are named by no source we can use. Items
without a quality: 140 in the reference loot (Forever's own items no source
grades yet); without an icon: 54.

Witherfang (Ruins of Lordaeron):

| Item | Facts now | From |
| --- | --- | --- |
| 271201 Atrophic Girdle | Waist, Mail, requires 15, 104 armour, +3 Str, +7 Sta | client (class, slot), ForeverDB (name, level, stats, armour) |
| 271202 Witherbite Bracers | Wrist, Leather, requires 15, 37 armour, +4 Agi, +5 spell power | same |
| 271203 Segmented Spider Leg | Two-hand staff, requires 15, 17.5 DPS, +9 Agi, +5 Spi, icon | client (class, slot, icon), ForeverDB |
| 275443 Highly Toxic Strain | Quest item, quality 1, icon | client |

Still unknown for 271201–271203: quality, item level, icon (two of them).

Disagreements between sources: 1,302 items, mostly stats (ForeverDB's
Forever values against Classic's: Forever changed many items' stats),
armour, DPS and required level. Each is kept in `item-definitions.json`.

## Not settled

- **Licensing.** ForeverDB's data is GPL-3.0 with an attribution term;
  Holdfast is MIT and already carries AzerothCore (GPL-2.0) facts. Whether
  copyleft data in these files is acceptable is the maintainers' call; the
  credit is shown wherever its data is (PR 4).
- Quality and item level for Forever's own items the client does not name.
- ForeverDB's API (keyed) was not used.
