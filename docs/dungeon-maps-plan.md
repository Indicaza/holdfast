# Dungeon maps for the website: audit and plan

Status: plan for a separate PR. Nothing here is built yet.

## What exists

**Add-on** (`Data/DungeonJournalArt.generated.lua`, written by
`scripts/exportJournalArt.lua` from OpenMap `0f4d2e4`, MIT):

- `maps[instanceId]`: each floor's name (when the client has one) and the
  12 texture FileDataIDs of Blizzard's dungeon map (4 × 3 tiles of 256 px;
  the picture is the top-left 1002 × 668 px). Wing floors carry `w`.
- `pins[instanceId]`: bosses Blizzard's dungeon journal placed: name,
  floor index `f`, and `x, y` as 0–1 of that 1002 × 668 picture.
- `creatures`: display IDs for portraits.
- 25 instances have floors: 33, 34, 36, 43, 47, 48, 70, 90, 109, 129, 189,
  209, 229 (wings tagged), 230, 249, 289, 309, 329, 349, 389, 409, 429, 469,
  509, 531. The client draws the art; nothing is bundled.

**Website**:

- `atlas.json` `maps[]` are only spawn layouts (creature positions the site
  draws); they are folded away as "Creature positions", never shown as a
  map.
- `FloorMap` draws `map.imageUrl` with boss markers from
  `boss.mapPosition {x, y}` and `boss.floorId`. No dungeon has a real
  `imageUrl` today.
- The Content Studio's media accepts a `map` purpose, one image per
  dungeon, without floors.
- Game art reaches the site only as item icons through Blizzard's icon
  media (`/api/game-data/v1/icons/:fileDataId`); there is no route for
  client textures.

**Gaps**: WoW Forever's own dungeons (3065 The Hall of Thanes, 2999 Ruins of
Lordaeron, 2998 Excavation Site: Wetlands, 2959 City of Dalaran) and 533
Naxxramas have no map in either. For them, only an editor's upload can
supply one.

## Correspondence

A floor's tiles stitch into one 1002 × 668 image. A pin's `x, y` are
fractions of that image, the same space `FloorMap` uses. A pin's `f` is the
floor's 1-based index in the add-on's list; the website's `floorId` becomes
that index (wing floors map through the wing table, as `Guide.Pins` does).
Pins match atlas bosses by name, as in the add-on; a boss without a pin
stays unplaced, never guessed.

## Plan (one PR, no new infrastructure)

1. `scripts/fetchDungeonMaps.mjs`: read the floors and pins from the
   add-on's generated file (or OpenMap at the pinned commit). Download each
   tile by FileDataID from wago.tools for the pinned `wowf` build, one at a
   time, as `fetchLootSources.mjs` does. Check robots.txt and terms first,
   and record them in `docs/loot-sources.md`. Decode the BLP tiles, stitch
   and crop them to 1002 × 668, and write one WebP per floor with a
   manifest (instance, floor index and name, wing, source, build, SHA-256).
   Expect about 70 floors at roughly 100 KB each.
2. Store the images as Content Studio media, not in the repository, so
   they are served by the existing media route and cached like card art.
   Editors can replace them.
3. `importDungeonAtlas.mjs`: add `maps[]` entries `{ floorId, name,
   imageUrl, width: 1002, height: 668, kind: "journal" }` beside the spawn
   layouts, and set `boss.mapPosition` and `boss.floorId` from pins matched
   by name. Unmatched pins go to `problems`.
4. The website shows journal maps as maps (a floor switcher like the
   add-on's arrows, boss pins numbered as in the encounter list) and keeps
   spawn layouts folded away.
5. Studio: let a `map` upload name its floor, so the Forever dungeons can
   get editor maps and pins. The add-on export keeps carrying editorial
   data only.
6. Tests: a parity test that the website's pins equal the add-on's, and a
   browser journey that a pin opens its boss.
