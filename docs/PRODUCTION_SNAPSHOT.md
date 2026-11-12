# Analysing production data on a Mac

Production snapshots contain private player data. Keep them **outside** any Git checkout, in a directory only you can read, and delete them when you're done. Never copy a local database back onto production.

## Once: SSH access to Render

Add your public key under Render → Account settings → SSH public keys. Check it works:

```sh
ssh srv-davbjm7avr4c73bbguq0@ssh.ohio.render.com 'df -h /data && ls -la /data'
```

## 1. Export an encrypted, consistent snapshot

`scripts/exportSnapshot.js` takes a consistent snapshot with SQLite's online backup API (safe while the service writes) in the work directory. It verifies the snapshot, then streams it to **stdout** as an encrypted format-2 archive. Plaintext never leaves the server; SSH adds transport encryption on top.

The archive uses `BACKUP_ENCRYPTION_KEY` from the service environment (or `SNAPSHOT_EXPORT_KEY`). The snapshot needs free space of about one database size in `BACKUP_WORK_DIR` (default `/tmp`), and the script refuses to start without it.

```sh
mkdir -m 700 -p ~/holdfast-snapshots
ssh srv-davbjm7avr4c73bbguq0@ssh.ohio.render.com 'cd /app/backend && BACKUP_WORK_DIR=/data node scripts/exportSnapshot.js' > ~/holdfast-snapshots/$(date +%F).hfb
```

The export logs its size and SHA-256 to stderr.

## 2. Restore and verify locally

```sh
read -rs BACKUP_ENCRYPTION_KEY; export BACKUP_ENCRYPTION_KEY
npm --prefix backend run backup:restore -- ~/holdfast-snapshots/$(date +%F).hfb ~/holdfast-snapshots/$(date +%F)
unset BACKUP_ENCRYPTION_KEY
```

The restore authenticates every frame and checks the SHA-256, `quick_check`, foreign keys and row counts before accepting. It never writes into an existing directory.

## 3. Audit

```sh
node backend/scripts/storageAudit.js ~/holdfast-snapshots/$(date +%F)/holdfast.sqlite ~/holdfast-snapshots/$(date +%F)
```

This writes `storage-audit.md` and `storage-audit.json`: bytes by domain, table and index, row counts, and every column holding values over 1 KiB, with logical (decompressed) size, gzip use and duplicate counts. It prints sizes, counts and hashes only, so the report can be shared.

## 4. Test migrations against a copy

Work on a **copy** of the restored file, so the original stays a clean baseline:

```sh
cp ~/holdfast-snapshots/$(date +%F)/holdfast.sqlite /tmp/holdfast-trial/holdfast.sqlite
GUILD_DATA_DIR=/tmp/holdfast-trial NODE_ENV=development npm --prefix backend start
```

Record row counts, `PRAGMA integrity_check`, file size and timings before and after. Changes reach production only as normal migrations in a release.

## Smaller copies

For tests that don't need real records, use the development seeds (`npm run dev:seed*`). To work with a bounded subset, copy the restored database and delete old rows from the largest tables of the copy (for example `market_observations` older than a day). Never do this on the original snapshot.
