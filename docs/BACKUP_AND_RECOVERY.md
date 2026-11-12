# Backups and recovery

Pre-migration snapshots protect schema changes on the Render disk. Off-site backups protect against losing that disk. The latter are disabled until storage is configured; merging this PR does not create a storage account or configure production credentials.

## Startup lifecycle and pre-migration snapshots

The server binds its port immediately and answers `GET /api/health/live` with `200` while it starts. Every other request, including `/api/health/ready`, returns `503` with `Retry-After: 5` until all required startup steps have finished, so no request can reach a database whose migrations have not run. Each step is logged as one JSON line (`{"event":"startup","phase":"migrations","ms":412,"ok":true}`), and once ready, `/api/health/ready` includes the same phase timings under `startup`. Background services (market refresh and maintenance, Discord sync, off-site backups) start only after the migrations.

A pre-migration snapshot is written to `/data/deploy-backups/` **only when the release has migrations to apply**. An ordinary restart copies nothing. Before copying, the server checks free disk space: it needs the database size plus 10% (at least 256 MiB) of headroom. If there isn't enough room, startup stops with an explicit error and changes nothing. Each snapshot is written as `*.partial`, checked with `PRAGMA quick_check`, and renamed only after it passes. A JSON sidecar records the schema versions, size and source-file identity. If the database is unchanged since the newest snapshot (for example, a restart after a failed migration), that snapshot is reused instead of copied again.

Retention keeps the newest `STARTUP_BACKUP_KEEP` (default 2) snapshots that have sidecars. Snapshots from before this policy have no sidecar; they are listed in the startup log (`startup_backups`) but are **never deleted automatically**. Remove them by hand only after a newer verified recovery point exists. A failed cleanup is logged and retried on the next migration; it does not stop startup.

`MIGRATION_BACKUP=skip` lets migrations run without a local snapshot. Use it only when the disk cannot hold a copy **and** a verified off-site backup newer than the last write exists. Unset it right after the deploy.

Telemetry compaction at startup never runs `VACUUM`. Rebuilding the file needs free disk equal to the database and blocks all access while it runs, so returning freed pages to the filesystem is a planned operator task.

## Activate off-site backups

Create a private S3 bucket outside Render, block all public access, enable bucket versioning, and apply `config/backup-storage-lifecycle.json` for 90-day retention. Use a dedicated access key with `config/backup-storage-policy.json`, replacing the bucket placeholder. Runtime credentials need only PutObject and GetObject for the `holdfast/` prefix; they must not be able to delete backups, alter retention, or change bucket policy. Bucket administration and recovery credentials should be separate. For stronger protection, enable Object Lock with a retention policy when creating the bucket.

Generate a separate encryption key:

```sh
openssl rand -hex 32
```

Store that key in a password manager or another recovery location independent of Render and the bucket. Losing it makes encrypted backups unrecoverable. Keep old keys while backups encrypted with them are retained. Do not use `SESSION_SECRET` as the backup key.

Set these **server-only** environment variables on the Render service:

| Variable | Value |
| --- | --- |
| `BACKUP_OFFSITE_ENABLED` | `true` |
| `BACKUP_S3_BUCKET` | Private bucket name |
| `BACKUP_S3_REGION` | Bucket region |
| `BACKUP_S3_ACCESS_KEY_ID` | Dedicated runtime access key |
| `BACKUP_S3_SECRET_ACCESS_KEY` | Dedicated runtime secret |
| `BACKUP_ENCRYPTION_KEY` | The 64-character hexadecimal encryption key |
| `BACKUP_S3_ENDPOINT` | Optional HTTPS endpoint for compatible storage |

After deployment, the worker runs after one minute and then every six hours. Each run:

1. Takes a consistent snapshot with SQLite's online backup API in **one step**. The copy runs on Node's thread pool under one read transaction, so the application keeps writing and the event loop stays free. (The default 100-pages-per-step mode restarts whenever another connection writes, and under steady telemetry it never finishes.) The snapshot goes to `BACKUP_WORK_DIR` (default: the OS temp directory), only after a free-space check for the database size plus 10% (at least 256 MiB).
2. Checks the snapshot: `quick_check`, foreign keys, business row counts.
3. Streams it through gzip and AES-256-GCM in 1 MiB frames (format `HOLDFB02`, below) into an S3 **multipart upload** with 16 MiB parts. At most one part is in memory, whatever the database size. Any failure aborts the multipart upload, so no partial object remains.
4. Downloads the object, authenticates every frame, decompresses it and checks that its SHA-256 and size equal the snapshot's. **Weekly** (or every run with `BACKUP_RESTORE_DRILL=full`) the download is restored into a real SQLite file in the work directory, which is then checked for integrity, foreign keys and row counts. This needs a second copy's worth of free space.
5. Writes `offsite-backup-status.json` only after verification. A failure is recorded in `offsite-backup-failure.json` and never replaces the last success.

The status records the archive and database sizes, part count, verification kind, duration and **peak RSS** of the run. Measured memory is in the PR that introduced streaming backups. `/api/health/ready` still exposes only `enabled`, `healthy` and `lastVerifiedAt`.

### Archive format 2 (`HOLDFB02`)

`"HOLDFB02" | u32 header length | header JSON` (version, creation time, cipher, compression, frame size, 8-byte nonce prefix), then frames `u8 type | u32 length | ciphertext | 16-byte GCM tag`. Frame *n* uses nonce `prefix ‖ n` and authenticates the format, the header's SHA-256, *n* and the frame type. The last frame is the trailer: the database SHA-256 and size, row counts and the Discord provisioning state. Altered, reordered, dropped or appended frames fail, and so does a stream without its trailer. Format 1 archives (`HOLDFB01`, 32 MiB, before November 2026) are still restorable. `backup:restore` detects the format from the file.

Runtime storage credentials need `s3:PutObject` (multipart included), `s3:GetObject` and `s3:AbortMultipartUpload` on `holdfast/*` (`config/backup-storage-policy.json`). The lifecycle rule also removes incomplete multipart uploads after a day.

An immediate manual backup is available from the service shell:

```sh
npm run backup:offsite
```

## Restore without touching the live database

Download a `.hfb` object using the storage console or separate recovery credentials. Select the key recorded in `offsite-backup-status.json`, or an older timestamped object for the incident. Restore on a separate machine or directory with the same Node version and checked-out release:

```sh
read -rs BACKUP_ENCRYPTION_KEY
export BACKUP_ENCRYPTION_KEY
npm --prefix backend ci
npm --prefix backend run backup:restore -- /path/to/downloaded.hfb /path/to/new-restore-directory
unset BACKUP_ENCRYPTION_KEY
```

The destination must not exist, even if empty. Both archive formats are accepted. Authentication, format, checksum, SQLite integrity, foreign keys and row counts are verified before the restore is accepted. Format 2 restores stream from disk, so memory does not grow with the archive. A failed restore removes only the newly created destination. Existing files are never overwritten. The restored database remains at its backed-up schema version; starting the selected application release runs the normal migrations after its pre-migration safety snapshot.

Point a separate test instance at the restored directory. Check member profiles, quest assignments, authority, and contribution history before switching production. Stop the production process before any disk replacement; retain the old disk contents, and copy the recovered files only after checking the selected release against the restored data. Do not run two writers against the same database. This destructive cutover is intentionally an operator step.

## Frozen release fixture and migration policy

`backend/test/fixtures/release-schema-v5.sql` is a frozen SQL snapshot from release source `40da65f8e3ea7edbbc45e6185da14c10a0aac078`. It uses synthetic members/quests plus character, contribution, and metadata sentinels. The snapshot represents version 5 by removing the known version-6 completion table and its migration record from that release database. The provenance manifest pins its checksum. Tests execute this stored SQL directly; they never build the historical schema with today's migration functions.

The upgrade test compares every historical business column after migration, verifies integrity, and reads profiles, quests, and contribution history through current repositories. `applied-migrations.json` pins versions 1–6 by name and function-body hash. Released migration bodies are append-only. Add a new migration to repair a released one; do not regenerate the historical fixtures or hashes to make a failed test pass. New migrations may require deliberate test extensions when they intentionally transform stored business data.

## Production monitoring

The hourly **Production monitor** workflow uses anonymous, read-only requests. It checks business readiness, private audit/management denial, public API data, rendered Home/Charter/Ranks pages, and the quest sign-in gate. It verifies the current main release after a successful main CI run has had 30 minutes to deploy. A manual run can specify an exact expected release. The production hostname defaults to Holdfast's current URL and can be overridden with **HOLDFAST_PRODUCTION_URL**.

Failures create or update one repository incident issue and retain a browser screenshot. A successful subsequent run closes the incident. Enable GitHub issue notifications for the people who own production; a repository issue is not an external paging service. Scheduled Actions may be delayed. A separate uptime service can provide faster or independent alerts.

Monitoring is scheduled or manually dispatched, rather than triggered by CI completion. This avoids making Render's “After CI Checks Pass” deployment wait for a check that is waiting for that same deployment. CI exercises the identical read-only monitor against the disposable application before merging.

Storage integration uses the [AWS SDK S3 commands](https://docs.aws.amazon.com/code-library/latest/ug/javascript_3_s3_code_examples.html). Release identity uses Render's documented [RENDER_GIT_COMMIT runtime variable](https://render.com/docs/environment-variables).
