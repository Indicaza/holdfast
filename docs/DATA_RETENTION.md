# Data retention model

Guildweaver keeps **information**, not redundant representations of it. Every table belongs to one class below, and its retention follows from that class. A blanket expiry is never applied across classes.

| Class | Meaning | Default rule |
|---|---|---|
| **Canonical state** | Latest authoritative state the app reads | Keep while the entity exists |
| **Immutable observations** | Unique events or measurements (loot, a gather, a sale price at a time) | Keep; compact or archive, never drop because they are old |
| **Historical aggregates** | Derived trends (hourly/daily/weekly prices, drop rates) | Keep at decreasing resolution |
| **Rebuildable projections** | Read models, summaries, search indexes | Keep current; rebuild instead of back up |
| **Transport/debugging** | Raw envelopes, retries, provider runs | Short, explicit windows |
| **Cold archive** | Old evidence worth keeping, rarely read | Compressed object storage (not built yet) |

## Domains (as of November 2026)

Sizes below come from the local development copy (64.5 MiB, schema v17, 25 characters) and the market benchmark (`market-maintenance` PR). **Production sizes are not measured yet.** Run the audit (`PRODUCTION_SNAPSHOT.md`) or the observatory to fill them in.

| Domain / table | Class | Current retention | Measured evidence | Recommendation |
|---|---|---|---|---|
| `character_sections` (profession_books etc.) | Canonical state (rebuildable) | Latest per character and section | Was 25.3 MiB of 64.5 as plain JSON | **Done (#284):** payloads over 32 KiB stored gzip; existing rows compacted in the background. 25.8 → 2.6 MiB |
| `telemetry_recipes` | Projection of the above | Latest per character | Was 7,616 rows for 1,959 recipes | **Done (#284):** `telemetry_recipe_definitions` + `telemetry_character_recipes`, `telemetry_recipes` is a view. 11.57 → 4.27 MiB |
| `guildweaver_telemetry_latest_state` | Canonical (raw) | Latest per stream | gzip in place: 24.6 MiB logical → 1.7 MiB stored | Keep |
| `guildweaver_telemetry_records` | Transport | Bounded raw retention | gzip: 17.1 → 1.4 MiB | Keep a short window; confirm the bound on production |
| `economic_observations` (+outputs) | Immutable observations | Kept | 21,222 rows; indexes 9.9 MiB > data 8.0 MiB | Keep every event. Query plans (41 test files) use every index, so none removed. Archive old years compressed later |
| `game_loot_*`, `dungeon_*`, `farming_*` | Immutable observations | Kept | small locally | Keep; aggregate drop rates; archive, never delete |
| `public_game_*`, `game_data_catalog` | Shared definitions | Kept, versioned by build | 1.8 MiB | Keep; the target for de-duplicating character data |
| `market_observations` | Immutable observations (raw evidence) | **API 26 h, in-game scans 3 days** (unless a summary uses it) | 204 B/row incl. indexes | **Done (#284):** link evidence reads the hourly series. Benchmark 120.1 → 49.7 MiB |
| `market_series_hourly` | Historical aggregate | **8 days** (longest hourly range: 7 days) | 146 B/row; one row per item per hour | **Done (#284).** Next candidate: integer market/item ids (text keys in every row and index) |
| `market_series_daily` | Historical aggregate | 400 days | 187 B/row; ~23 MB/day at production volume | Keep (trend evidence); integer ids |
| `market_series_weekly` | Historical aggregate | 10 years | 152 B/row | Keep |
| `market_summaries`, `market_price_ladders`, `market_item_meta` | Rebuildable projection | Current | 418 B per summary | Keep; exclude from cold archives |
| `market_snapshot_checks`, `market_provider_runs` | Transport | 14 / 30 days | small | Keep |
| `/data/deploy-backups/*` | Safety copies | Was: 5 full copies, one per **start** | 3.5–4 min each on production | Now: only before migrations, two managed copies (startup-lifecycle PR); legacy copies need an operator decision |

## Safety rules for pruning and compaction

1. A source row is deleted only after everything derived from it exists. Market pruning keeps any snapshot a summary still uses, and roll-ups run before prunes of their sources.
2. Every maintenance step is idempotent and bounded (short transactions), and is recorded as done only at the end (`market_maintenance`).
3. New retention rules ship with a dry-run count (rows and bytes) taken from a production snapshot, and the PR states the expected savings.
4. Nothing runs `VACUUM` automatically. Deleted pages are reused by later writes. Shrinking the file is a planned operator task that needs free disk equal to the database and a maintenance window.
5. Immutable observations are never pruned for age. They move to a cold archive (compressed, object storage, with checksums) only once that archive exists and is verified.
