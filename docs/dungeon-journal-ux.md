# Dungeon Journal: interaction specification

The website's Dungeon Atlas follows the add-on's Dungeon Journal
(Indicaza/guildweaver `UI/DungeonGuide.lua`). These are the rules every
change to `frontend/src/Player/Dungeons/` keeps. Tests that hold them:
`e2e/tests/dungeon-journal-interactions.solo.spec.js`,
`src/Player/Dungeons/__tests__/`, `frontend/test/journalTooltips.test.js`.

## Navigation

- Dungeon → encounter → boss. A dungeon is a page (`?open=<id>`), with
  Overview, Quests, Loot and My runs. `?boss=<key>` selects a boss on the
  Overview; old `section=bosses|prepare` links still land.
- The encounter list stays beside the page (a row on phones): the dungeon
  first, then each boss in order, with its portrait (or initial), number,
  drop count, wanted count and high-priority marks. The selected row has a
  gold edge, ring and name. Previous and next boss sit under a boss's page.
- "All dungeons" (or the browser's Back) returns to the grid where it was.
- The Loot tab does not repeat boss navigation: a boss panel's name opens
  that boss's guide.

## A boss's page

Framed header (portrait, place in the dungeon, high priority, interrupts,
drops, wishlist), then **key mechanics** (the role quick guide and the
editors' mechanics callouts, high priority first) beside the **loot
window** when the content is at least 44rem wide, stacked when not. Other
abilities fold away. Missing data is said in one line ("No abilities in the
atlas … That does not mean it has none."); there is no empty frame.

## Item slots

- A slot is a bag slot (46 px, 50 px on touch screens) with the game's
  quality edge; unknown quality has a neutral dashed edge. Wanted, acquired
  and "choose one" are small marks.
- **A slot never moves or changes size**: no hover lift or scale, no press
  shrink, a square hit area (the global button rules are reset on the
  journal's controls in `AtlasLootGrid.css`).
- **Hover or keyboard focus** shows the tooltip beside the slot, never
  over it, always inside the window (`placeFloating`): right, else left,
  else below or above. It mounts once per hover; moving within the slot
  does nothing. A pointer tooltip hides on scroll and returns on the next
  move; a keyboard one follows its slot. Tooltips never take pointer input.
- **Tooltip content**: the game's captured lines, untouched. Without them,
  the facts we hold in the game's order, labelled by source ("Classic
  reference facts, not the game's tooltip."). The pending note only when
  nothing is known. Under either, the journal's lines: where it drops,
  other sources, rates and evidence, quality not known, usable later, quest
  choice, wishlist state.
- **Press (click, tap, Enter)** opens the item in a popover beside the slot
  (a bottom sheet on phones), outside the card: no card or page reflow.
  It holds the tooltip, this source's evidence and rates, linked sources,
  the wishlist button and every recorded fact. Escape, the close button or
  a press elsewhere closes it; focus returns to the slot. The wishlist is
  never changed by hovering.

## Loot sources

Bosses are framed panels with portraits. Rares are purple. Trash, shared
drops and chests, and quest rewards are compact rows (name, count, slots).
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
