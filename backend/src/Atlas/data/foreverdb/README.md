# ForeverDB-derived data (GPL-3.0 with an attribution term)

**Not covered by Holdfast's MIT licence.** Every file in this directory
contains data taken from ForeverDB.net's add-on data files and is licensed
under the GNU General Public License version 3 (`COPYING.txt`) with
ForeverDB.net's additional attribution term under GPL-3.0 section 7(b)
(`FOREVERDB-LICENSE.txt`, reproduced unchanged from ForeverDB's add-on;
`FOREVERDB-NOTICE.txt` says which of ForeverDB's data is its own).

    Data from ForeverDB.net (https://foreverdb.net)

Each JSON file here keeps ForeverDB's notice line in its `notice` field, as
the attribution term asks ("keep the line that starts `-- Data:
ForeverDB.net (https://foreverdb.net)`").

The rest of Holdfast (its code, and the data outside this directory) stays
MIT. Holdfast's code reads these files at runtime when they are present and
works without them: delete this directory and the site serves the
MIT-licensed base data (`../item-definitions.json`, `../reference-loot.json`)
with no ForeverDB data in it.

| File | What | Written by |
| --- | --- | --- |
| `foreverdb-items.json` | ForeverDB's gear facts and names for the items the atlas needs (from its `Gear.lua`, `GearSources.lua`) | `scripts/fetchLootSources.mjs` |
| `foreverdb-loot.json` | ForeverDB's per-boss loot: drop rates measured over its players' looted kills, kills, drops seen, and its Classic (CMaNGOS) fallback rows (from its `Loot.lua`) | same |
| `item-definitions.json` | The item definitions with ForeverDB's facts merged in (the base ones are `../item-definitions.json`) | `scripts/importDungeonAtlas.mjs` |
| `reference-loot.json` | The reference loot with those facts (the base one is `../reference-loot.json`) | same |
| `loot-relationships.json` | Boss loot relationships and reference drop rates | same |

Why: ForeverDB's licence (`FOREVERDB-LICENSE.txt`) applies to its own
material, which its NOTICE names: data its players recorded in WoW Forever
("drop rates measured over players' kills, where items dropped, ... items
players revealed") and its own work. The game client's names and numbers
are Blizzard's, and ForeverDB claims only their selection and arrangement.
Because the drop rates and loot relationships are ForeverDB's own material,
and because some item facts may be items its players revealed, everything
taken from its files is kept here, under its licence, rather than mixed into
the MIT tree. docs/loot-sources.md, "Licensing".
