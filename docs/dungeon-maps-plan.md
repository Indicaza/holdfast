# Dungeon maps for the website

Status: the pipeline and website integration are built and tested with
synthetic tiles. **No real map art has been downloaded or published.**
See [coverage](dungeon-maps-coverage.md).

## Blocker: rights to the art

The floors are Blizzard's textures. Before any real run, the owner must
confirm the right to obtain and publish them:

- Blizzard's EULA (revised March 21, 2024) bars copying or mining the game
  client, so the local client is not used.
- Blizzard's legal FAQ allows limited non-commercial fan-site use of material
  downloaded from its site. It does not address client textures or mirrors,
  and the fan site policy it may depend on could not be read.
- wago.tools' `robots.txt` and `llms.txt` allow its `/api/casc/` route, but it
  publishes no licence for reusing the files.

## Pipeline (`scripts/buildDungeonMaps.mjs`)

1. `metadata`: reads the add-on's generated table into
   `backend/src/Atlas/data/sources/journal-maps.json` (IDs and positions only).
2. `build`: decodes `<fileDataId>.blp` tiles, assembles 4 x 3 tiles row by row,
   crops to 1002 x 668, writes PNGs and a versioned manifest. An incomplete
   floor is reported and not made. Downloading needs `--download-wago <build>
   --confirm-asset-rights`.
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
