# Dungeon Content Studio

The Dungeon Content Studio is the editorial CMS for the Dungeon Atlas, at `/admin/dungeons`. Only `site.admin` can use it.

It is an **override layer**. Imported data (`backend/src/Atlas/data/*.json`, written by `scripts/importDungeonAtlas.mjs`) is never written. Edits are resolved over the import at read time, so re-importing keeps every edit.

## Pieces

| Piece | Where |
| --- | --- |
| Editorial schema (whitelist), field definitions | `backend/src/Atlas/Editorial/editorialSchema.js` |
| Precedence and conflicts | `editorialResolve.js` |
| Validation (ids, chains, assets, coordinates, Lua budget) | `editorialValidate.js` |
| Tables (migration 26) | `editorialMigration.js` |
| Drafts, revisions, rollback, audit | `editorialRepository.js` |
| Admin API `/api/admin/atlas-studio/*` | `editorialRouter.js` |
| Media library (files on disk under `<data dir>/atlas-media/`) | `atlasMedia.js`, `imageCodec.js` |
| Website overlay (public routes, previews) | `editorialOverlay.js`, `editorialPreview.js` |
| Add-on rules (single source), Lua literal syntax | `addonTransform.js` |
| Add-on journal simulation model | `addonJournalModel.js` |
| Planner integration point | `backend/src/Atlas/editorialQuestPlan.js` → `publishedEditorialQuestPlan(instanceId)` |
| Admin UI | `frontend/src/Admin/DungeonStudio/` |

## Rules

- **Per field**, a field can inherit, be overridden, or have its override cleared. Each override carries `verified` and source notes.
- **Precedence**, highest first:
  1. published verified editorial;
  2. Forever client data (provenance tier `official-client`, or `forever-reference` with high confidence);
  3. unverified editorial;
  4. Forever external references;
  5. Classic fallbacks.

  When an edit loses, it is reported as a conflict with both values kept.
- **Protected data**: telemetry, observed drop rates, readiness and quest state have no field. A document that names one is refused with the `protected` code.
- **Workflow**: draft (optimistic version) → validate → publish.
  - Publishing creates an append-only revision.
  - Rollback publishes an older revision again as a new revision.
  - Unpublish removes the active pointer.
  - Every action is audited.
- **Media**:
  - Accepted formats: PNG, JPEG and WebP, up to 8 MB and 32–4096 px. The type is sniffed from the bytes.
  - Only PNG gets thumbnail and web variants, because there is no image dependency (`sharp` is not one of Holdfast's).
  - An image cannot be removed while a draft or an active revision uses it.
- **Public routes**:
  - `GET /api/player/loot/dungeons` overlays name, levels, entrance, card art and focal point, and subtitle.
  - `GET /api/player/loot/dungeons/:id` overlays the full detail.
  - Wing details (`:id` = a wing key) are served without the editorial layer for now.
- **Planner contract**: the quest plan part of a document is published in the planner's schema-1 shape (Worktree B, `docs/dungeon-quest-planner.md`). The `revision` field is the revision id as a string.

## Content publishing vs add-on releases

Publishing in the studio changes the website immediately. The add-on only gets content through an add-on code release:

1. `GET /api/admin/atlas-studio/export/addon` (or `node backend/scripts/exportEditorialBundle.mjs`) gives the published editorial bundle.
2. The add-on's `scripts/exportDungeonAtlas.lua --editorial <bundle.json>` (Indicaza/guildweaver#80) renders it into `Data/DungeonAtlas.generated.lua`. This step is deterministic, size-checked against the 480 KB file budget, and refuses rather than cuts.

   Parity is checked in both repositories with the same fixture (`backend/scripts/addonEditorialParity.mjs` writes it; `backend/test/addonEditorialParity.test.js` here, `test/dungeon_editorial_spec.lua` there). Use `--art Media/Atlas` to write the packaged textures into the add-on.
3. The add-on is released as usual.

The studio shows each dungeon's add-on byte count against the per-dungeon budget (6144 bytes). The total budget for all dungeons is 49152 bytes.

## Artwork in the add-on

- Existing add-on art is client file IDs and creature display IDs (`Data/DungeonJournalArt.generated.lua`). The client draws those itself, and nothing of Blizzard's is bundled.
- Packaged add-on media are uncompressed `.tga` files (`Media/*.tga`).
- So CMS art can only reach the add-on as packaged TGA textures with power-of-two sides: card 512×256, portrait 128×128, converted from PNG uploads.
- JPEG and WebP stay website-only, with the originals kept in the CMS.
- No runtime downloader.
- In-game rendering of packaged textures needs verification in the WoW Forever client.

## Known limitations / next

- Migration version 26 may collide with other branches that add migrations; renumber on merge.
- Wing detail pages do not show editorial content yet.
- The boss order editor shows boss keys in the "imported" column.
- In the add-on, the editorial boss order is exported but not applied: runs refer to bosses by position.
- The add-on's quest planner checklist does not read editorial quest plans yet. Worktree B wires `publishedEditorialQuestPlan` on the website side.
- No GitHub Actions status in the CMS. The add-on export is a manual step, and the add-on release flow is unchanged.
- Playwright e2e for the studio is not written (CI-only). The HTTP-level demo test is `backend/test/atlasStudioDemo.test.js`.
