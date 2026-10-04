# Backups and recovery

Startup snapshots protect migrations on the Render disk. Off-site backups protect against losing that disk. The latter are disabled until storage is configured; merging this PR does not create a storage account or configure production credentials.

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

After deployment, the worker runs after one minute and every six hours. Each run takes a consistent SQLite snapshot without running migrations, verifies integrity and foreign keys, includes optional Discord provisioning state, compresses it, and encrypts it with AES-256-GCM and a fresh nonce. Only ciphertext is uploaded. The worker then downloads that exact object, decrypts it, restores it into a temporary directory, and compares the database checksum and business row counts. The success timestamp is written only after that restore drill passes. Failures leave the previous success timestamp intact.

Verify `/api/health/ready` reports `offsiteBackup.enabled: true`, `healthy: true`, and a recent `lastVerifiedAt`. Then set the GitHub repository Actions variable **HOLDFAST_REQUIRE_OFFSITE_BACKUP** to `true` and run **Production monitor** manually. This prevents accidentally disabling backups later from being reported as healthy. The monitor also fails when an enabled backup has not been verified within 24 hours.

The normal recovery-point target is six hours. Alerting has a 24-hour freshness budget plus the hourly monitor interval. Snapshots are bounded to a 32 MiB SQLite database and 1 MiB provisioning state so memory usage stays bounded on the current service. An oversized database fails the backup and eventually alerts; extend the implementation to streaming before exceeding that size. Nothing automatically deletes remote backups; storage lifecycle policy owns retention.

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

The destination must not exist, even if empty. Authentication, format, checksum, SQLite integrity, foreign keys, and row counts are verified before the restore is accepted. A failed restore removes only the newly created destination. Existing files are never overwritten. The restored database remains at its backed-up schema version; starting the selected application release runs the normal migrations after its pre-migration safety snapshot.

Point a separate test instance at the restored directory. Check member profiles, quest assignments, authority, and contribution history before switching production. Stop the production process before any disk replacement; retain the old disk contents, and copy the recovered files only after checking the selected release against the restored data. Do not run two writers against the same database. This destructive cutover is intentionally an operator step.

## Frozen release fixture and migration policy

`backend/test/fixtures/release-schema-v5.sql` is a frozen SQL snapshot from release source `40da65f8e3ea7edbbc45e6185da14c10a0aac078`. It uses synthetic members/quests plus character, contribution, and metadata sentinels. The snapshot represents version 5 by removing the known version-6 completion table and its migration record from that release database. The provenance manifest pins its checksum. Tests execute this stored SQL directly; they never build the historical schema with today's migration functions.

The upgrade test compares every historical business column after migration, verifies integrity, and reads profiles, quests, and contribution history through current repositories. `applied-migrations.json` pins versions 1–6 by name and function-body hash. Released migration bodies are append-only. Add a new migration to repair a released one; do not regenerate the historical fixtures or hashes to make a failed test pass. New migrations may require deliberate test extensions when they intentionally transform stored business data.

## Production monitoring

The hourly **Production monitor** workflow uses anonymous, read-only requests. It checks business readiness, private audit/management denial, public API data, rendered Home/Charter/Ranks pages, and the quest sign-in gate. It verifies the current main release after a successful main CI run has had 30 minutes to deploy. A manual run can specify an exact expected release. The production hostname defaults to Holdfast's current URL and can be overridden with **HOLDFAST_PRODUCTION_URL**.

Failures create or update one repository incident issue and retain a browser screenshot. A successful subsequent run closes the incident. Enable GitHub issue notifications for the people who own production; a repository issue is not an external paging service. Scheduled Actions may be delayed. A separate uptime service can provide faster or independent alerts.

Monitoring is scheduled or manually dispatched, rather than triggered by CI completion. This avoids making Render's “After CI Checks Pass” deployment wait for a check that is waiting for that same deployment. CI exercises the identical read-only monitor against the disposable application before merging.

Storage integration uses the [AWS SDK S3 commands](https://docs.aws.amazon.com/code-library/latest/ug/javascript_3_s3_code_examples.html). Release identity uses Render's documented [RENDER_GIT_COMMIT runtime variable](https://render.com/docs/environment-variables).
