# Storage observatory

Read-only reports about production disk and database usage, for site administrators and for tools acting for them (the admin interface, Claude Code, monitoring). Every response is JSON with `version`, `section` and `generatedAt`. Fields are only ever added within a version.

```
GET /api/admin/storage                 → { version, sections: [...] }
GET /api/admin/storage/overview        disk, database file/WAL/SHM, page and free-page counts, schema version, files in the data directory, bytes by domain
GET /api/admin/storage/tables          per table: domain, data bytes, index bytes, index count, approximate rows
GET /api/admin/storage/backups         pre-migration snapshots (name, kind, size, versions) and off-site backup health
GET /api/admin/storage/ingestion       telemetry, character, economy and market rows in the last 24 h / 7 d; telemetry by domain (records, stored bytes)
GET /api/admin/storage/growth          bytes per day overall and by domain over 1, 7 and 30 days
GET /api/admin/storage/maintenance     market maintenance runs (prune counts, roll-ups)
```

**Access.** `site.admin` only (session cookie). 30 requests per minute. Only the section name is accepted: no SQL, paths, filters or write methods. Each request is logged as `{"event":"storage_report","section":…,"status":…,"actor":<12-char hash>}`.

**Content.** Sizes, counts and timestamps only: no stored values, member or Discord identifiers, credentials or absolute paths.

**Cost.** `overview` and `backups` read a few file sizes and pragmas, cached for a minute. `tables`, `ingestion` and `maintenance` come from a collection that runs 5 minutes after start and then every 6 hours in a **worker thread** with its own read-only connection. That collection reads every database page (`dbstat`), so it never runs on the request thread. Before the first collection these sections answer `202 {"status":"collecting"}` and start one. Each collection appends a sample to `observatory/samples.jsonl` in the data directory (at most 1,000), which is where `growth` comes from.

**Domains** (`src/Production/storageDomains.js`): `auction_house`, `telemetry_transport`, `character_state`, `economy_loot`, `dungeons`, `game_definitions`, `devices`, `guild_operations`, `system`. A test fails if a new table maps to none.

For deeper questions (largest values, duplicates), analyse a local snapshot instead: see `PRODUCTION_SNAPSHOT.md`.

## Example

```sh
curl -s --cookie "holdfast_session=…" https://holdfast-tddi.onrender.com/api/admin/storage/overview | jq '.database, .domains'
```

## MCP adapter (planned, not built)

Deferred until these endpoints have run on production. The adapter will be a thin, read-only MCP server whose tools map one-to-one onto the sections: `storage_overview` → `overview`, `database_table_sizes` → `tables`, `ingestion_rates` → `ingestion`, `backup_health` → `backups`, `maintenance_status` → `maintenance`, `growth_report` → `growth`, `retention_report` → a future `retention` section. It calls these HTTP endpoints and never opens the database itself, so there's one implementation of the analysis.

Authentication will be a dedicated, revocable read-only token scoped to `/api/admin/storage/*`. That needs a small server change, since today only admin session cookies are accepted. The adapter runs locally (stdio) for Claude Code, or behind authentication for remote clients, and is never exposed without it. It has no SQL, write or file tools.
