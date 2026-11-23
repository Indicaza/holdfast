# Dungeon maps for the website

Status: the pipeline and website integration are built. On 2026-11-22 the
owner confirmed the right to obtain and publish this art. All 63 floors of
25 dungeons were built from wago.tools `wowf` build 1.60.1.71037; see
`backend/src/Atlas/data/sources/journal-maps-manifest.json` and the
[coverage report](dungeon-maps-coverage.md). The images are not in Git. They
reach a site through Content Studio media; production's were uploaded on
2026-11-23.

The game client was not used, because Blizzard's EULA bars copying or mining
it. The art remains Blizzard's and keeps that attribution in Content Studio.

## Pipeline (`scripts/buildDungeonMaps.mjs`)

1. `metadata`: reads the add-on's generated table into
   `backend/src/Atlas/data/sources/journal-maps.json` (IDs and positions only).
2. `build`: decodes `<fileDataId>.blp` tiles, assembles 4 x 3 tiles row by row,
   crops to 1002 x 668, writes PNGs and a versioned manifest. An incomplete
   floor is reported and not made. Downloading needs `--download-wago <build>
   --confirm-asset-rights`; tiles are fetched one at a time and cached.
3. `import`: adds the floors to Content Studio media (purpose `map`, on the
   `/data` volume) with attribution and provenance. Existing floors are kept.
4. `coverage`: writes `docs/dungeon-maps-coverage.md`.

## Editors

A floor's picture is the newest `map` image named
`journal-map-<instance>-<floor>.png`, so uploading that name replaces it. A
published editorial map takes the place of the floors. A dungeon with no
picture shows "No map", never a substitute. Forever's own dungeons need
editor maps; their pins need a source first.

## Website

`DungeonMapPanel` is controlled (floors, pins, floor, selected encounter,
pin selection) and has no page layout, so it can move to a persistent panel.
Spawn layouts stay separate and are never used for pins.
