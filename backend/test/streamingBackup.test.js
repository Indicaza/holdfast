import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createEncryptedSnapshot } from '../src/Data/encryptedBackup.js'
import { offsiteBackupDetails, offsiteBackupHealth, runOffsiteBackup } from '../src/Data/offsiteBackup.js'
import { createVerifiedSnapshot, encryptSnapshot, FRAME_BYTES, restoreArchiveStream, verifyArchiveStream } from '../src/Data/streamingBackup.js'
import { withGuildTransaction } from '../src/Data/database.js'
import { createFakeObjectStorage } from '../testSupport/fakeObjectStorage.js'
import { withHttpApp } from '../testSupport/httpHarness.js'

const encryptionKey = 'a1'.repeat(32)
const configured = { BACKUP_OFFSITE_ENABLED: 'true', BACKUP_S3_BUCKET: 'test-backup', BACKUP_S3_REGION: 'us-east-1', BACKUP_S3_ACCESS_KEY_ID: 'fixture-access', BACKUP_S3_SECRET_ACCESS_KEY: 'fixture-secret', BACKUP_ENCRYPTION_KEY: encryptionKey }

// Several MiB of incompressible data, so archives span many frames and parts.
function addBulk(megabytes) {
  withGuildTransaction((db) => {
    db.exec('CREATE TABLE IF NOT EXISTS backup_bulk (id INTEGER PRIMARY KEY, data BLOB)')
    const insert = db.prepare('INSERT INTO backup_bulk (data) VALUES (?)')
    for (let index = 0; index < megabytes * 4; index += 1) insert.run(randomBytes(256 * 1024))
  })
}

async function archiveBytes(directory) {
  const snapshot = await createVerifiedSnapshot({ dataDir: directory, workDir: directory })
  try {
    const archive = encryptSnapshot({ snapshot, encryptionKey, createdAt: '2026-11-12T00:00:00.000Z' })
    const chunks = []
    for await (const chunk of archive.stream) chunks.push(chunk)
    return { bytes: Buffer.concat(chunks), digest: archive.digest(), counts: snapshot.counts }
  } finally {
    await snapshot.cleanup()
  }
}

test('a multi-frame, multi-part backup uploads, verifies by download and restores to the same database', () => withHttpApp(async ({ directory }) => {
  addBulk(6)
  await writeFile(path.join(directory, 'discord-provisioning-state.json'), '{"guildId":"fixture-guild"}')
  const storage = createFakeObjectStorage(path.join(directory, 'storage'))
  const env = { ...configured, GUILD_DATA_DIR: directory, BACKUP_WORK_DIR: directory }
  const now = new Date('2026-11-12T04:00:00Z')

  const result = await runOffsiteBackup({ env, client: storage, now: () => now, partBytes: 5 * 1024 * 1024 })
  assert.equal(result.status, 'verified')
  assert.equal(result.format, 'HOLDFB02')
  assert.equal(result.verification, 'full-restore', 'the first run restores a real database')
  assert.ok(result.parts >= 2, `multipart (${result.parts} parts)`)
  assert.ok(result.databaseBytes > 6 * 1024 * 1024)
  assert.deepEqual(storage.calls.map((call) => call.name).filter((name, index, all) => all.indexOf(name) === index),
    ['CreateMultipartUploadCommand', 'UploadPartCommand', 'CompleteMultipartUploadCommand', 'GetObjectCommand'])

  const [key] = await storage.objectKeys()
  const object = path.join(directory, 'storage', 'objects', encodeURIComponent(key))
  assert.equal((await readFile(object)).includes(Buffer.from('Mira Member')), false, 'only ciphertext is stored')
  const restored = await restoreArchiveStream({ input: createReadStream(object), encryptionKey, destination: path.join(directory, 'restored') })
  assert.equal(restored.databaseSha256, result.databaseSha256)
  assert.deepEqual(restored.counts, result.counts)
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'restored', 'discord-provisioning-state.json'))), { guildId: 'fixture-guild' })
  await assert.rejects(restoreArchiveStream({ input: createReadStream(object), encryptionKey, destination: path.join(directory, 'restored') }), { code: 'EEXIST' })

  assert.deepEqual(await offsiteBackupHealth({ env, now: now.getTime() }), { enabled: true, healthy: true, lastVerifiedAt: now.toISOString() })
  const details = await offsiteBackupDetails({ env, now: now.getTime() })
  assert.equal(details.last.archiveBytes, result.archiveBytes)
  assert.equal(details.lastFailure, null)
  assert.equal(JSON.stringify(details).includes(encryptionKey), false)

  // Within a week the next run verifies by streaming checksum only.
  const later = new Date('2026-11-12T10:00:00Z')
  const second = await runOffsiteBackup({ env, client: storage, now: () => later })
  assert.equal(second.verification, 'stream-checksum')
  assert.equal(second.lastFullRestoreAt, now.toISOString())
}))

test('altered, reordered, truncated, extended and wrong-key archives are refused', () => withHttpApp(async ({ directory }) => {
  addBulk(3)
  const { bytes, digest } = await archiveBytes(directory)
  const check = (buffer, key = encryptionKey) => verifyArchiveStream({ input: Readable.from([buffer]), encryptionKey: key })
  assert.equal((await check(bytes)).databaseSha256, digest.sha256)

  const headerEnd = 12 + bytes.readUInt32BE(8)
  const frames = []
  for (let offset = headerEnd; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset + 1)
    frames.push(bytes.subarray(offset, offset + 5 + length + 16))
    offset += 5 + length + 16
  }
  assert.ok(frames.length >= 4, `${frames.length} frames of ${FRAME_BYTES} bytes`)
  const header = bytes.subarray(0, headerEnd)

  const flipped = Buffer.from(bytes)
  flipped[headerEnd + 40] ^= 1
  await assert.rejects(check(flipped), /auth|Unsupported state/i)
  const headerTampered = Buffer.from(bytes)
  headerTampered[20] ^= 1
  await assert.rejects(check(headerTampered))
  await assert.rejects(check(Buffer.concat([header, frames[1], frames[0], ...frames.slice(2)])), 'reordered frames')
  await assert.rejects(check(Buffer.concat([header, ...frames.slice(0, -1)])), /truncated/, 'trailer dropped')
  await assert.rejects(check(Buffer.concat([header, frames[0], ...frames.slice(2)])), 'a frame dropped')
  await assert.rejects(check(Buffer.concat([bytes, frames[0]])), /after its trailer/)
  await assert.rejects(check(bytes.subarray(0, bytes.length - 7)), /truncated/)
  await assert.rejects(check(bytes, 'b2'.repeat(32)))
}))

test('an interrupted upload is aborted and never replaces the last verified backup', () => withHttpApp(async ({ directory }) => {
  addBulk(6)
  const env = { ...configured, GUILD_DATA_DIR: directory, BACKUP_WORK_DIR: directory }
  const good = createFakeObjectStorage(path.join(directory, 'good'))
  await runOffsiteBackup({ env, client: good, now: () => new Date('2026-11-12T04:00:00Z'), partBytes: 5 * 1024 * 1024 })
  const verified = await readFile(path.join(directory, 'offsite-backup-status.json'), 'utf8')

  const failing = createFakeObjectStorage(path.join(directory, 'failing'), {
    failOn: ({ name, input }) => (name === 'UploadPartCommand' && input.PartNumber === 2 ? Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }) : null),
  })
  await assert.rejects(runOffsiteBackup({ env, client: failing, now: () => new Date('2026-11-12T10:00:00Z'), partBytes: 5 * 1024 * 1024 }), /connection reset/)
  assert.ok(failing.calls.some((call) => call.name === 'AbortMultipartUploadCommand'), 'the multipart upload is aborted')
  assert.deepEqual(await failing.objectKeys(), [], 'no partial object')
  assert.equal(await readFile(path.join(directory, 'offsite-backup-status.json'), 'utf8'), verified)
  const details = await offsiteBackupDetails({ env, now: Date.parse('2026-11-12T10:00:00Z') })
  assert.equal(details.lastFailure.error, 'ECONNRESET')
  assert.ok(details.last.verifiedAt, 'the previous success is still reported')
}))

test('a remote object that differs from the snapshot is never reported verified', () => withHttpApp(async ({ directory }) => {
  const env = { ...configured, GUILD_DATA_DIR: directory, BACKUP_WORK_DIR: directory }
  const older = await archiveBytes(directory)
  withGuildTransaction((db) => db.prepare("UPDATE member_profiles SET bio = 'New data after the previous snapshot' WHERE member_id = 'e2e-member'").run())
  // Storage answers with an older, valid archive instead of the new one.
  const swapped = createFakeObjectStorage(path.join(directory, 'swapped'), { tamper: (file) => writeFile(file, older.bytes) })
  await assert.rejects(runOffsiteBackup({ env, client: swapped, now: () => new Date('2026-11-12T04:00:00Z') }), /does not match/)
  assert.equal((await offsiteBackupHealth({ env })).healthy, false)
  // A flipped byte in storage fails authentication.
  const flipped = createFakeObjectStorage(path.join(directory, 'flipped'), { tamper: async (file) => { const data = await readFile(file); data[data.length - 30] ^= 1; await writeFile(file, data) } })
  await assert.rejects(runOffsiteBackup({ env, client: flipped, now: () => new Date('2026-11-12T05:00:00Z'), statfsImpl: undefined }))
  assert.equal((await offsiteBackupHealth({ env })).healthy, false)
}))

test('a backup refuses to start when the work disk cannot hold the snapshot', () => withHttpApp(async ({ directory }) => {
  const env = { ...configured, GUILD_DATA_DIR: directory, BACKUP_WORK_DIR: directory }
  const storage = createFakeObjectStorage(path.join(directory, 'storage'))
  await assert.rejects(runOffsiteBackup({ env, client: storage, statfsImpl: async () => ({ bavail: 1, bsize: 4096 }) }), /needs \d+ bytes free/)
  assert.deepEqual(storage.calls, [], 'nothing uploaded')
  assert.equal((await offsiteBackupDetails({ env })).lastFailure.error, 'BACKUP_DISK_FULL')
}))

test('the snapshot is consistent while the application keeps writing', () => withHttpApp(async ({ directory }) => {
  addBulk(4)
  let writes = 0
  const writer = setInterval(() => {
    withGuildTransaction((db) => db.prepare("INSERT OR REPLACE INTO app_meta (key, value, updated_at) VALUES (?, 'x', ?)").run(`concurrent-${writes++}`, new Date().toISOString()))
  }, 1)
  try {
    const snapshot = await createVerifiedSnapshot({ dataDir: directory, workDir: directory })
    try {
      const db = new DatabaseSync(snapshot.file, { readOnly: true })
      try {
        assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
      } finally { db.close() }
    } finally { await snapshot.cleanup() }
  } finally { clearInterval(writer) }
  assert.ok(writes > 0, 'writes happened during the snapshot')
}))

test('the restore command accepts both archive formats and never overwrites', () => withHttpApp(async ({ directory }) => {
  const legacy = path.join(directory, 'legacy.hfb')
  await writeFile(legacy, await createEncryptedSnapshot({ dataDir: directory, encryptionKey }))
  const current = path.join(directory, 'current.hfb')
  await writeFile(current, (await archiveBytes(directory)).bytes)
  const run = (file, destination) => spawnSync(process.execPath, ['scripts/restoreBackup.js', file, destination], { cwd: new URL('../', import.meta.url), env: { ...process.env, BACKUP_ENCRYPTION_KEY: encryptionKey }, encoding: 'utf8' })
  for (const [file, format] of [[legacy, 1], [current, 2]]) {
    const destination = path.join(directory, `restored-${format}`)
    const result = run(file, destination)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).format, format)
    assert.ok((await stat(path.join(destination, 'holdfast.sqlite'))).size > 0)
    assert.equal(run(file, destination).status, 1, 'existing destination refused')
  }
}))

test('large backups keep memory bounded (set HOLDFAST_BACKUP_TEST_GB to run)', { skip: !process.env.HOLDFAST_BACKUP_TEST_GB }, async () => {
  const gigabytes = Number(process.env.HOLDFAST_BACKUP_TEST_GB)
  const directory = await mkdtemp(path.join(os.tmpdir(), 'holdfast-large-backup-'))
  try {
    const db = new DatabaseSync(path.join(directory, 'holdfast.sqlite'))
    db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE members (id); CREATE TABLE quests (id); CREATE TABLE objectives (id); CREATE TABLE contribution_transactions (id);
      CREATE TABLE rank_authority (id); CREATE TABLE billets (id); CREATE TABLE quest_settings (id); INSERT INTO quest_settings VALUES (1);
      CREATE TABLE bulk (data BLOB);`)
    const insert = db.prepare('INSERT INTO bulk VALUES (?)')
    // Half random, half repetitive: roughly the compressibility of telemetry.
    const block = Buffer.concat([randomBytes(32 * 1024), Buffer.alloc(32 * 1024, 'telemetry ')])
    for (let written = 0; written < gigabytes * 1024 ** 3; written += block.length) {
      if (written % (256 * 1024 ** 2) === 0) db.exec('BEGIN')
      insert.run(block)
      if ((written + block.length) % (256 * 1024 ** 2) === 0) db.exec('COMMIT')
    }
    if (db.isTransaction) db.exec('COMMIT')
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    const storage = createFakeObjectStorage(path.join(directory, 'storage'))
    const baseline = process.memoryUsage().rss
    const result = await runOffsiteBackup({ env: { ...configured, GUILD_DATA_DIR: directory, BACKUP_WORK_DIR: directory, BACKUP_RESTORE_DRILL: 'full' }, client: storage })
    console.log(JSON.stringify({ databaseBytes: result.databaseBytes, archiveBytes: result.archiveBytes, parts: result.parts, durationMs: result.durationMs, baselineRss: baseline, peakRss: result.peakRssBytes }))
    assert.ok(result.peakRssBytes - baseline < 256 * 1024 ** 2, 'memory stays bounded')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a snapshot exported to stdout restores to the same database', () => withHttpApp(async ({ directory }) => {
  const exported = spawnSync(process.execPath, ['scripts/exportSnapshot.js'], {
    cwd: new URL('../', import.meta.url), env: { ...process.env, GUILD_DATA_DIR: directory, BACKUP_WORK_DIR: directory, BACKUP_ENCRYPTION_KEY: encryptionKey }, maxBuffer: 1024 ** 3,
  })
  assert.equal(exported.status, 0, String(exported.stderr))
  const summary = JSON.parse(String(exported.stderr).trim().split('\n').at(-1))
  const restored = await restoreArchiveStream({ input: Readable.from([exported.stdout]), encryptionKey, destination: path.join(directory, 'exported') })
  assert.equal(restored.databaseSha256, summary.databaseSha256)
  assert.deepEqual(restored.counts, summary.counts)
  const missingKey = spawnSync(process.execPath, ['scripts/exportSnapshot.js'], { cwd: new URL('../', import.meta.url), env: { ...process.env, GUILD_DATA_DIR: directory, BACKUP_ENCRYPTION_KEY: '', SNAPSHOT_EXPORT_KEY: '' } })
  assert.equal(missingKey.status, 1)
  assert.equal(missingKey.stdout.length, 0)
}))
