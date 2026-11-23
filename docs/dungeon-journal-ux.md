# Dungeon Journal: interaction specification

The website's Dungeon Atlas follows the add-on's Dungeon Journal
(Indicaza/guildweaver `UI/DungeonGuide.lua`). These are the rules every
change to `frontend/src/Player/Dungeons/` keeps. Tests that hold them:
`e2e/tests/dungeon-journal-interactions.solo.spec.js`,
`src/Player/Dungeons/__tests__/`, `frontend/test/journalTooltips.test.js`.

## The workspace

One workspace (`JournalWorkspace.jsx`) in three places: the Dungeons page,
where it fills the space under the app header and the document does not
scroll; a dialog over the Resource Map, which stays mounted; and the Studio's
preview, which takes its content's height and never the viewport's.

- **Journal**: the encounter rail, the map filling the space above, and the
  loot dock below it: portrait, name, large slots, then mechanics in one
  accordion, closed by default. **All loot** swaps the dock's content for the
  dungeon's source groups without moving the map. The first boss is chosen on
  opening, except for a dungeon played as wings, which opens on its overview.
- **Quests**: the map beside the preparation checklist.
- **My runs**: the run history, full width.
- Panels scroll; the page does not. Under 46rem one panel shows at a time,
  map first.

## Navigation

- A dungeon is `?open=<id>`, with `section=quests|runs`, `boss=<key>` and
  `loot=all`. Old `section=overview|bosses|loot|prepare` links are rewritten
  to what they now are. Sections replace history, so Back leaves the dungeon.
- The encounter list starts with the dungeon, then each boss in order with
  its portrait (or initial), number, drop count, wanted count and
  high-priority marks.
- "All dungeons" (or the browser's Back) returns to the grid where it was.

## The map

Real floors and pins only (`DungeonMapPanel`). Choosing a boss turns to its
floor and highlights its pin; a pin selects its boss; the floor can be turned
by hand and is kept across Journal and Quests. A dungeon with no map gets one
line. Spawn layouts are never a map, and world-map coordinates are never drawn
on a dungeon floor.

## A boss's page

The dock shows the portrait, place in the dungeon, drop count and wishlist
count beside the **loot**. **Mechanics** sit under it in one accordion, with
their count and high-priority mark, and scroll inside the dock. Missing data
is said in one line.

## Item slots

- A slot is a bag slot (40 px, 34 px in secondary rows, 44–46 px on touch screens) with the game's
  quality edge; unknown quality has a neutral dashed edge. Wanted, acquired
  and "choose one" are small marks.
- **A slot never moves or changes size**: no hover lift or scale, no press
  shrink, a square hit area (the global button rules are reset on the
  journal's controls in `DungeonJournal.css`).
- **Hover or keyboard focus** shows the tooltip beside the slot, never
  over it, always inside the window (`placeFloating`): right, else left,
  else below or above. It mounts once per hover; moving within the slot
  does nothing. A pointer tooltip hides on scroll and returns on the next
  move; a keyboard one follows its slot. Tooltips never take pointer input.
- **The tooltip is the game's and nothing else**: the captured lines,
  untouched. Without them, the facts we hold in the client's order and words
  (item level, binding, slot and type, damage, armor, stats, classes,
  required level) with one small label ("WoW Forever reference", "Classic
  reference"). The pending note only when nothing is known. Sources, rates,
  evidence, wishlist state, credits, instructions and IDs never go in it:
  they belong to the inspector.
- **Press (click, tap, Enter)** opens the item in a popover beside the slot
  (a bottom sheet on phones), outside the card: no card or page reflow.
  It holds the tooltip, this source's evidence and rates, linked sources,
  the wishlist button and every recorded fact. Escape, the close button or
  a press elsewhere closes it; focus returns to the slot. The wishlist is
  never changed by hovering.

## Loot sources

Bosses are framed loot windows with portraits. Rares are a muted purple.
Trash, shared drops and chests, and quest rewards are quiet rows (name,
count, smaller slots) in plain text colour.
Unknown sources fold away with their count. A creature known only by its
ID is grey and italic ("Unidentified creature (NPC n)"), never a named
boss's gold. An item stays under every source known to give it; each
source keeps its own rates and evidence.

## Names

The atlas's verified boss names win (the add-on packages the same atlas).
A loot-catalog name for the same creature is telemetry: kept as
`catalogName`, used for matching, shown only under "About this boss's
data". `Creature <id>` is never a title.

## Quests

Numbered steps, lettered parts, the plan's own next step. A next step from
stale or partial quest data is a "Suggested next" and says so. A reason
several steps share is said once above them. Quests a higher level opens
are listed with that level. Preparation is not an entry requirement, and
the page says so. Times: when the quest log was read in game and when it
was uploaded.

## Visual language

The add-on's `UI/Theme.lua`, as tokens on the journal's root
(`--gwj-*` in `DungeonJournal.css`); nothing outside the Atlas uses them.

- **Surfaces**: blue-black panels and wells with hairline borders. Blizzard's
  rock only on what is framed: the dungeon header, the encounter header and
  boss loot windows.
- **Gold is for what matters**: the dungeon and boss names, section titles,
  the current tab and the selected row. Never on secondary sources, and
  never bright yellow headings.
- **Titles** use Friz Quadrata where installed (else Georgia); text stays in
  the site's body font. Rarity colours are Blizzard's.
- **Portraits** share one ring. Verified art when it exists, otherwise the
  boss's initial on dark stone. An NPC ID is never a portrait.
- **Artwork and maps**: the studio's art with its focal point, else the rock
  header. Spawn plots stay folded and are never presented as maps.
