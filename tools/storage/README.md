# Guildweaver storage tools

Backups, restores, the offline rebuild that shrinks the production database,
Auction House history archives and the production cutover. Everything here
runs on the operator's PC (Windows, Node 24, the built-in OpenSSH client).
Data never goes into Git: the tools refuse a data directory inside the
repository, and `.gitignore` excludes database, backup and archive files.

| Tool | What it does | Touches production? |
|---|---|---|
| `backup.mjs` | consistent snapshot over SSH, rebuilt and verified here, restore-tested | reads only |
| `restore.mjs` | verified backup → new database file, checked | no |
| `rebuild.mjs` | verified backup → compact database, cleaned and validated | no |
| `archive.mjs` | detailed AH history per market and month, gzip, checksummed | no |
| `upload.mjs` | `status` (read only), `stage`, `approve` the rebuilt database | `stage`/`approve` write under `/data/cutover` only |
| `schedule.ps1` | daily backup and archive in Windows Task Scheduler | reads only |

## Where data goes

`--root DIR`, else the `GUILDWEAVER_DATA_ROOT` environment variable, else
`D:\GuildweaverData` when a D: drive exists, else `%USERPROFILE%\GuildweaverData`.

```
D:\GuildweaverData\
  backups\<id>\holdfast.sqlite, manifest.json   verified backups (id = UTC time)
  rebuilds\<id>\holdfast.sqlite, manifest.json, report.md, report-before.json
  archive\<market>\<YYYY-MM>\<table>.v1.ndjson.gz, archive\manifest.json
  logs\                                         scheduled runs
```

## Connecting to Render

Render dashboard → the `holdfast` service → **Connect → SSH**: add your
public key to your Render account once, then copy the SSH address
(`srv-…@ssh.ohio.render.com`). Check it works:

```bash
ssh srv-XXXX@ssh.ohio.render.com "node --version && df -h /data"
```

The backup sends its own reader to the server with the SSH command (Node's
built-in `node:sqlite`, nothing installed, nothing written on the server).

## Backup and restore

```bash
node tools/storage/backup.mjs --ssh srv-XXXX@ssh.ohio.render.com
node tools/storage/restore.mjs latest D:\restore\holdfast.sqlite
```

How a backup is made safe:

- **Consistent while live.** The server reads every table inside one SQLite
  read transaction. In WAL mode that reader sees one fixed snapshot (database
  file plus the WAL up to that moment) while the website keeps writing; the
  WAL is never copied as a loose file and is never checkpointed past the
  reader. The website is not blocked.
- **No second copy on Render.** Rows stream over SSH (gzip). The official
  page-level tools are not available on Render (no `sqlite3` CLI or
  `sqlite3_rsync` in the image, no `sqlite_dbpage` in Node's SQLite) and the
  SQLite backup API needs a destination file on the same full disk, so the
  snapshot is logical: tables, rows with their rowids, then indexes, views
  and triggers, exactly as defined.
- **Verified, not assumed.** Every table carries a SHA-256 of its encoded rows
  computed on the server; the rebuilt file must produce the same digests, pass
  `PRAGMA integrity_check`, and then survive a restore test (copied with
  SQLite's backup API, verified again, opened by this release's migration
  check). Only then is `backups/.partial-<id>` renamed to `backups/<id>`. An
  interrupted transfer leaves nothing but a `.partial` folder, removed by the
  next run.
- **Incremental transfer.** Tables whose content digest matches the last
  verified backup are not sent; they are copied from that backup locally.
  Every backup is still a complete, standalone file. `--full` sends
  everything; `--keep N` keeps the newest N.

Scheduled (as the logged-on user, whose SSH key is used):

```powershell
powershell -ExecutionPolicy Bypass -File tools\storage\schedule.ps1 -SshTarget srv-XXXX@ssh.ohio.render.com
```

## Auction House storage, as the website keeps it

- **Current state** (`market_observations`): the latest observation per market,
  item variant, source and full view. A new observation replaces its row; a
  snapshot row is kept only while an observation names it, while it is the
  latest of its scope (for "unchanged" content hashes) and for 26 hours.
- **History**, observed asking prices only, copper per unit, gaps stay gaps:

  | resolution | normal | watched (favorites, shopping lists, recent views; ≤ 3,000 variants) |
  |---|---|---|
  | hourly | 48 hours | 7 days |
  | daily | 30 days | 90 days |
  | weekly | 52 weeks | 52 weeks |
  | monthly | 24 months | 24 months |

  Charts: 24h hourly · 7d daily (hourly if watched) · 30d daily · 90d weekly
  (daily if watched) · 1y weekly · All monthly. 7-day metrics for unwatched
  items come from daily points and say so (`resolution: "day"`,
  `approximate: true`, confidence at most medium).
- **Retention** runs every 6 hours in small transactions; roll-ups once a day.
  A row is deleted only when the coarser row holding it exists: hourly once
  its day exists, daily once its week and month are rolled up and *final*
  (no observation can still arrive for them), weekly once its month is final.
  Final rows are never recomputed. Interrupted runs simply run again.
- **Budget**: maintenance measures every `market_*` table and index (dbstat)
  and logs `market_storage_budget` at 2 GiB (warning) and 3 GiB (critical);
  the admin diagnostics show the last measurement.

## Cleaning the existing 6 GB database (one-time cutover)

**Stage the rebuilt database before merging the release that contains it.**
That release starts with migration 24; on the current 6 GB file its
pre-migration safety snapshot does not fit on the disk, so startup would
refuse to migrate (nothing is damaged, but the site stays down until the
rebuilt database is staged). With a rebuilt file staged and approved, startup
swaps it in first and has nothing to migrate.

1. **Back up** (read only):
   `node tools/storage/backup.mjs --ssh srv-XXXX@ssh.ohio.render.com`
2. **Report and rebuild locally** (production untouched):
   `node tools/storage/rebuild.mjs --report-only` (what would be removed), then
   `node tools/storage/rebuild.mjs`. Read `rebuilds\<id>\report.md`; it must
   say *verified*. It checks integrity, that every table outside the Auction
   House storage tables is identical row for row, the migration history, every
   shown price, every current observation, history coverage at each
   resolution, a second cleanup removing nothing, and the website's market
   queries against the result.
3. **Check space**: `node tools/storage/upload.mjs status --ssh srv-XXXX@…`.
   Staging needs the compact file plus 512 MiB free. If short, the old
   startup snapshots in `/data/deploy-backups` (about 5.8 GiB) are the
   candidates — delete them only after step 1 succeeded, and only with
   explicit approval:
   `ssh srv-XXXX@… "ls -la /data/deploy-backups"` then
   `ssh srv-XXXX@… "rm /data/deploy-backups/<file>"`.
4. **Stage**: `node tools/storage/upload.mjs stage --ssh srv-XXXX@…`
   (uploads to `/data/cutover`, checksum verified on the server; the running
   site ignores it).
5. **Approve** (operator decision):
   `node tools/storage/upload.mjs approve --ssh srv-XXXX@…`
6. **Deploy** (merge the release) or restart the service. Startup logs
   `{"event":"database_cutover","status":"applied",…}`; the old database is in
   `/data/cutover/previous-<time>/`. Check `/api/health/ready` and the Auction
   House pages.
7. Later, once satisfied: delete `/data/cutover/previous-<time>/` (explicit
   approval; the local backup from step 1 remains the recovery copy).

Writes made between step 1 and step 6 are not in the rebuilt database. Run
steps 1–6 back to back at a quiet time (the second backup of the day is
incremental and quick); Auction House prices refill on the next refresh.

**Going back**: before step 6, delete `/data/cutover/APPROVED`. After it, the
previous database is intact in `/data/cutover/previous-<time>/`; stage it the
same way (copy it to `/data/cutover/holdfast.sqlite` with a matching
`manifest.json`, then `APPROVED`) and restart. The local backup is the
independent copy.

**Fallback without the PC rebuild**: with a verified backup on the PC, set
`MIGRATION_BACKUP=skip` on the service and deploy; migration 24 and
maintenance then shrink the data in place. The file keeps its size (freed
pages are reused, not returned) unless an operator later runs VACUUM, which
needs as much free disk as the database.

## Archives

```bash
node tools/storage/archive.mjs export          # from the latest backup
node tools/storage/archive.mjs verify
node tools/storage/archive.mjs inspect D:\GuildweaverData\archive\api_us_house-110\2026-11\market_series_hourly.v1.ndjson.gz
node tools/storage/archive.mjs restore <file> --into D:\scratch\holdfast.sqlite
```

One gzip file per market, month and resolution; line 1 is the header
(format, version, table, columns, market, month, date range, row count, source
backups, compression), every other line one row. Exports merge with what is
already archived (a row with more observations behind it wins), so archiving
every daily backup keeps every hour the website has since dropped. Archiving
never deletes anything, and the website never depends on this PC.

## Tests

```bash
cd backend && npm run test:storage && npm run test:storage-tools
```
