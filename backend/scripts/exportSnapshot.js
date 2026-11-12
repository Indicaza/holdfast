import path from 'node:path'
import os from 'node:os'
import { pipeline } from 'node:stream/promises'
import dotenv from 'dotenv'
import { runtimeDataDirectory } from '../src/Data/runtimeData.js'
import { createVerifiedSnapshot, encryptSnapshot } from '../src/Data/streamingBackup.js'

// Writes an encrypted, consistent snapshot of the live database to stdout
// (format 2, as off-site backups), for analysis on another machine:
//
//   ssh <service> 'cd /app/backend && node scripts/exportSnapshot.js' > snapshot.hfb
//
// The snapshot is taken with SQLite's online backup API, so the service
// keeps running. It is verified, encrypted with BACKUP_ENCRYPTION_KEY (or
// SNAPSHOT_EXPORT_KEY) and deleted afterwards. Plaintext never leaves the
// server. Progress goes to stderr.
dotenv.config()

const encryptionKey = process.env.SNAPSHOT_EXPORT_KEY || process.env.BACKUP_ENCRYPTION_KEY
try {
  if (!encryptionKey) throw new Error('Set BACKUP_ENCRYPTION_KEY or SNAPSHOT_EXPORT_KEY (64 hex characters) on the server')
  if (process.stdout.isTTY) throw new Error('Refusing to write an archive to a terminal; redirect stdout to a file')
  const dataDir = process.env.GUILD_DATA_DIR ? path.resolve(process.env.GUILD_DATA_DIR) : runtimeDataDirectory()
  const workDir = process.env.BACKUP_WORK_DIR ? path.resolve(process.env.BACKUP_WORK_DIR) : os.tmpdir()
  const started = Date.now()
  const snapshot = await createVerifiedSnapshot({ dataDir, workDir })
  try {
    console.error(`Snapshot verified: ${snapshot.bytes} bytes in ${Date.now() - started} ms; streaming encrypted archive`)
    const archive = encryptSnapshot({ snapshot, encryptionKey, createdAt: new Date().toISOString() })
    await pipeline(archive.stream, process.stdout)
    const digest = archive.digest()
    console.error(JSON.stringify({ databaseBytes: digest.bytes, databaseSha256: digest.sha256, counts: snapshot.counts, ms: Date.now() - started }))
  } finally {
    await snapshot.cleanup()
  }
} catch (error) {
  console.error(`Export failed: ${error.message}`)
  process.exitCode = 1
}
