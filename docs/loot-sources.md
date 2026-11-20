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
| `data/foreverdb/foreverdb-items.json` | same | ForeverDB's gear facts and names for those items (2,695), the files' SHA-256 (GPL-3.0, see Licensing) |
| `data/foreverdb/foreverdb-loot.json` | same | ForeverDB's loot rows for the atlas's 30 instances it covers (4,733), with rates, kills and seen counts (GPL-3.0) |
| `data/item-definitions.json`, `data/reference-loot.json` | `scripts/importDungeonAtlas.mjs` | The MIT base: definitions and reference loot from the Forever and Classic clients only (2,227 items, 170 gaps) |
| `data/foreverdb/item-definitions.json`, `data/foreverdb/reference-loot.json` | same | The same with ForeverDB's facts (2,367 items, 8 gaps; GPL-3.0); served when present |

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

## Licensing

ForeverDB's add-on ships `LICENSE.txt`, `NOTICE.txt` and `COPYING.txt`
(copied unchanged into `backend/src/Atlas/data/foreverdb/`). What they say:

- **Licence**: GPL-3.0 with an additional term under section 7(b): anyone
  who copies, modifies or conveys the add-on, "any of its files, or data
  taken from them, in any form (another addon, a website, an app, ...)" must
  keep the line starting `-- Data: ForeverDB.net (https://foreverdb.net)` in
  every file taken, and show "Data from ForeverDB.net
  (https://foreverdb.net)" in the work's Appropriate Legal Notices (its
  credits, about text, or wherever it lists licences and sources).
- **What it covers**: "ForeverDB.net's own material": its code; data its
  players recorded in WoW Forever ("drop rates measured over players' kills,
  where items dropped ..., items players revealed", and more), which it
  claims as "Copyright (C) 2026 ForeverDB.net"; and its own work (gear
  scoring, guides, ...).
- **What it does not claim**: "The WoW Forever client: names and numbers read
  from the game's own tables ... are Blizzard Entertainment's; ForeverDB.net
  claims nothing in them beyond its selection and arrangement."
- **Classic rows**: its Classic data (the `c` rows in `Loot.lua`, entries in
  `GearSources.lua` and others) derive from CMaNGOS classic-db, GPL-3.0.
- Its website and keyed API have separate terms (credit with a link; don't
  resell); Holdfast uses neither.

What Holdfast takes, classified:

| Taken | From | Classification |
| --- | --- | --- |
| Drop rates, kill counts, drops seen, which item a boss dropped in Forever | `Loot.lua` | ForeverDB's own claimed material (its players' records); Classic rows CMaNGOS GPL-3.0. Covered by its licence. |
| Item names, slots, class, levels, stats, armour, DPS | `Gear.lua`, `GearSources.lua` | Mostly client facts ForeverDB disclaims, but for items the Forever client does not name they may be "items players revealed", which it claims. Treated as covered. |

Individual facts (a name, a percentage) are generally not protected by
copyright in the US, and the GPL only governs what is; but ForeverDB claims
copyright in the compilation, the extract takes most of it for the atlas's
dungeons, and some jurisdictions protect databases themselves. Rather than
rely on that, Holdfast **complies with the licence and keeps the data
apart**:

- Everything taken from ForeverDB, and everything built with it, lives in
  `backend/src/Atlas/data/foreverdb/` under GPL-3.0 with ForeverDB's term,
  with the GPL text, ForeverDB's licence and notice, a README, and each
  file's `notice` field holding ForeverDB's notice line.
- The MIT tree keeps base sets built without it (`item-definitions.json`,
  `reference-loot.json`), and `NOTICE.md` lists the separately licensed
  data. Holdfast's code reads the ForeverDB set at runtime when present
  (`HOLDFAST_FOREVERDB_DATA=off` serves the base); deleting the directory
  removes ForeverDB entirely. Data a program merely reads is not part of the
  program, so the code stays MIT.
- Serving data on a website is not "conveying" under the GPL ("mere
  interaction with a user through a computer network"), but the attribution
  term names websites too: the credit, linked, is shown under every loot
  list holding ForeverDB data.
- The Guildweaver add-on does convey a copy: it keeps ForeverDB's data in a
  separate file under the same licence (Guildweaver, `docs/dungeon-guide.md`).

Still open:

- A permission request to ForeverDB (drafted for the maintainers) asking
  whether reusing its loot data in Holdfast and Guildweaver under these
  terms is fine with it, or whether it would grant a separate permission;
  and which of its item facts are client facts.
- AzerothCore's data (GPL-2.0) in the MIT tree is the same kind of question
  and was not changed here.
- Rebuilding the drop rates from permitted sources: Guildweaver's own
  observations (PR 3) replace ForeverDB's as samples grow.
- Quality and item level for Forever's own items the client does not name.
- ForeverDB's API (keyed) was not used.

## Boss loot relationships and reference drop rates (PR 2)

`src/Atlas/lootRelationships.js` writes `data/foreverdb/loot-relationships.json` (GPL-3.0, see Licensing)
(`scripts/importDungeonAtlas.mjs`): for each atlas boss, every item a source
places on it, who lists it, and each source's own rate.

- **Matching**: a ForeverDB boss to an atlas boss by NPC id, else by its exact
  name (case and punctuation aside). 254 of ForeverDB's 257 bosses in the
  atlas's dungeons match; Avatar of Hakkar, Miner Johnson and Grubbis (not
  atlas bosses) do not, and are listed.
- **Scope**, never assumed from the dungeon alone:
  - `boss`: a guide or the emulator lists it for this boss, or it is an item
    WoW Forever added (id ≥ 25,000) that ForeverDB sees on this boss only;
  - `dungeon`: a Forever-added item seen on two or more bosses of the dungeon;
  - `world`: the emulator's world-drop list, or ForeverDB sees it on bosses
    of three or more instances;
  - `corpse`: seen on the corpse in Forever, but nothing says it is the
    boss's own (an original green, a recipe).
  Only `boss` items are a boss's loot table; every scope keeps its rates.
- **Rates** are kept per source and never averaged: `{ source, method,
  percent, kills, seen, revision }`, method `observed` (ForeverDB: drops
  seen in Forever over that boss's looted kills, `kills` given) or
  `classic` (ForeverDB's CMaNGOS fallback, not a Forever measurement).
- **Discrepancies**: a drop the guides place on one boss that Forever's
  players saw only on another boss of the dungeon (12, all in Dire Maul and
  similar shared-book cases) is reported, not resolved.

Served (optional additions to the dungeon detail): each `referenceLoot`
entry with known rates gets `referenceRates`; a boss's own drops only
ForeverDB knows come in `foreverLoot`, with `source: "foreverdb"` and the
credit, never as Classic reference. `reference-loot.json` itself stays
chance-free.

| | |
| --- | --- |
| Relationships | 4,726: 2,219 listed by both, 527 by the reference only, 78 by ForeverDB only (boss), 1,253 seen on a corpse or shared, 649 world drops |
| Rates | 1,839 observed in Forever (1,479 with a kill count), 2,360 Classic |
| Boss loot with an observed Forever rate | 279 of 2,824 boss-scope relationships, on 82 of 298 bosses |

## Guildweaver's observed drop rates (PR 3)

What one Guildweaver player's add-on saw is one **loot window**; what counts
for a rate is one **loot opportunity**: one physical corpse of an atlas boss
or rare (`loot_opportunities`, `Loot/lootObservationRepository.js`).

- **Identity**: the corpse's GUID on its realm and game build. The key holds
  no locale or account, so several Guildweaver players in one group, with any
  client language, count one corpse once; each extra observer only raises
  `observers`. A corpse looted again, or an upload retried, changes nothing.
- **Complete or partial** (the add-on's `capture.inspection`, Guildweaver
  `Systems/MobLootCapture.lua`): complete when every item slot of the window
  was tied to its corpse (`GetLootSourceInfo`) and nobody could have taken
  items first (not free-for-all in a group). Only complete windows are a
  rate's denominator. Partial windows, and those from add-ons too old to say
  (`legacy`), count as sightings: proof an item drops, no denominator.
- **No items**: a boss's or rare's window holding only coins is reported
  (complete windows only), so kills without an item drop are in the
  denominator. A corpse with nothing at all never opens a window: those
  kills are missed, so rates lean slightly high. Trash corpses are not
  opportunities.
- **Rate**: per NPC, on the newest game build with complete windows (other
  builds are listed, never mixed in): drops in complete windows over complete
  windows, with the 95% **Wilson score interval** (sound for small samples and
  zero drops). No complete windows: sightings only, no percentage. An item
  never seen gets `noDropUpper`, the interval's upper bound for 0 drops.
- **Privacy**: observers are stored as a hash; the served aggregate names no
  player, character or contributor.
- **Rebuild**: rates are computed from the opportunity rows on request; there
  is no stored aggregate to drift.

**Preliminary.** Every observed rate is served with `status:
"preliminary"` and a reason, and shown as preliminary, until the
loot-window coverage is verified in the real client (below). The counts are
real; how complete each window was is not yet proven.

Served as `observedLoot` on the dungeon detail's bosses and rares
(`GET /api/player/loot/dungeons/:id`): `{ status, reason, build, eligibleKills,
partialWindows, lastObservedAt, noDropUpper, builds: [...], items: [{ itemId,
drops, sightings, percent, low, high }] }`.

Not verified in the real client: whether `GetLootSourceInfo` maps every
slot on Forever, and how group loot shows a corpse to the second looter.

## In the journal (PR 4)

Website (dungeon modal, boss loot): each row shows its reference rate and
Guildweaver's observed rate side by side, each with its count, for example
"Reference: 23.5% · ForeverDB, 17 kills · Guildweaver: 16.7% (12 of 72 kills,
9.8%–26.9%)"; "not seen in 72 kills (under 5.1%)" for an item Guildweaver
has never seen; "seen 2×, no full loot count yet" without complete windows.
Classic-data rates say so. A boss's ForeverDB-only drops are labelled "WoW
Forever (ForeverDB)", WoW Forever's own items "WoW Forever item", quest items
"Quest item", and an ungraded item "quality unknown". "Data from
ForeverDB.net" (linked) is shown under any list holding ForeverDB data.

Add-on (Guildweaver, packaged atlas): the reference rates and ForeverDB's
boss drops travel in the exported file (`--relationships`); the tooltip
shows the rate and the credit. Guildweaver's observed rates are server-side
and shown on the website only.

## Keeping it current

`.github/workflows/loot-sources-refresh.yml` runs weekly (and on demand):
fetch both sources at their latest build and version, regenerate, run the
data tests, and open a pull request when anything changed. A bad import
fails before a PR (the fetch refuses partial or inconsistent sources, the
importer checks the atlas invariants, the tests check the data); a good one
waits for review, so a broken upstream can never replace the served data.
Observations are never touched by a refresh: they are kept per game build,
and rates of one build are never shown as another's. After a refresh merges,
regenerate the add-on's atlas from `main`.
