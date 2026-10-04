import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { createEncryptedSnapshot, decryptSnapshot, restoreEncryptedSnapshot, backupKey, MAX_SNAPSHOT_BYTES } from '../src/Data/encryptedBackup.js'
import { offsiteBackupConfig, offsiteBackupHealth, runOffsiteBackup, startOffsiteBackupScheduler } from '../src/Data/offsiteBackup.js'
import { withGuildTransaction } from '../src/Data/database.js'
import { withHttpApp } from '../testSupport/httpHarness.js'

const encryptionKey = 'a1'.repeat(32)
const configured = { BACKUP_OFFSITE_ENABLED: 'true', BACKUP_S3_BUCKET: 'test-backup', BACKUP_S3_REGION: 'us-east-1', BACKUP_S3_ACCESS_KEY_ID: 'fixture-access', BACKUP_S3_SECRET_ACCESS_KEY: 'fixture-secret', BACKUP_ENCRYPTION_KEY: encryptionKey }

test('encrypted snapshots restore a consistent database and provisioning state without overwriting files', () => withHttpApp(async ({ directory }) => {
  await writeFile(path.join(directory, 'discord-provisioning-state.json'), '{"guildId":"fixture-guild"}')
  const archive = await createEncryptedSnapshot({ dataDir: directory, encryptionKey })
  assert.equal(archive.includes(Buffer.from('Mira Member')), false)
  const source = decryptSnapshot(archive, encryptionKey)
  assert.equal(source.counts.members, 3)
  const destination = path.join(directory, 'restored')
  const result = await restoreEncryptedSnapshot({ archive, encryptionKey, destination })
  assert.equal(result.databaseSha256, source.databaseSha256)
  assert.deepEqual(JSON.parse(await readFile(path.join(destination, 'discord-provisioning-state.json'))), { guildId: 'fixture-guild' })
  await assert.rejects(restoreEncryptedSnapshot({ archive, encryptionKey, destination }), { code: 'EEXIST' })
  await mkdir(path.join(directory, 'existing'))
  await assert.rejects(restoreEncryptedSnapshot({ archive, encryptionKey, destination: path.join(directory, 'existing') }), { code: 'EEXIST' })
}))

test('tampered, truncated, oversized, and wrong-key archives fail before restoration', () => withHttpApp(async ({ directory }) => {
  const archive = await createEncryptedSnapshot({ dataDir: directory, encryptionKey })
  const tampered = Buffer.from(archive)
  tampered[tampered.length - 1] ^= 1
  for (const value of [tampered, archive.subarray(0, 12), Buffer.alloc(MAX_SNAPSHOT_BYTES * 2 + 1)]) {
    assert.throws(() => decryptSnapshot(value, encryptionKey))
  }
  assert.throws(() => decryptSnapshot(archive, 'b2'.repeat(32)))
  assert.throws(() => backupKey('short'))
}))

test('off-site upload succeeds only after downloading and restoring the same encrypted snapshot', () => withHttpApp(async ({ directory }) => {
  let uploaded
  const commands = []
  const client = { async send(command) {
    commands.push(command)
    if (command.constructor.name === 'PutObjectCommand') {
      uploaded = command.input.Body
      assert.equal(command.input.ContentType, 'application/octet-stream')
      return {}
    }
    return { ContentLength: uploaded.length, Body: { transformToByteArray: async () => uploaded } }
  } }
  const env = { ...configured, GUILD_DATA_DIR: directory }
  const now = new Date('2026-10-04T04:00:00Z')
  const result = await runOffsiteBackup({ env, client, now: () => now })
  assert.equal(result.status, 'verified')
  assert.equal(commands[0].input.Key, commands[1].input.Key)
  assert.deepEqual(await offsiteBackupHealth({ env, now: now.getTime() }), { enabled: true, healthy: true, lastVerifiedAt: now.toISOString() })
  assert.equal((await offsiteBackupHealth({ env, now: now.getTime() + 25 * 60 * 60 * 1000 })).healthy, false)
  assert.equal((await offsiteBackupHealth({ env, now: now.getTime() - 1 })).healthy, false)
  withGuildTransaction((db) => db.prepare("UPDATE member_profiles SET bio = 'New data after the previous snapshot' WHERE member_id = 'e2e-member'").run())
  const previousStatus = await readFile(path.join(directory, 'offsite-backup-status.json'), 'utf8')
  await assert.rejects(runOffsiteBackup({ env, client: { async send(command) { if (command.constructor.name === 'PutObjectCommand') return {}; return { ContentLength: uploaded.length, Body: { transformToByteArray: async () => uploaded } } } } }), /does not match/)
  assert.equal(await readFile(path.join(directory, 'offsite-backup-status.json'), 'utf8'), previousStatus)
  uploaded[uploaded.length - 1] ^= 1
  const verified = await readFile(path.join(directory, 'offsite-backup-status.json'), 'utf8')
  await assert.rejects(runOffsiteBackup({ env, client: { async send(command) { if (command.constructor.name === 'PutObjectCommand') return {}; return { ContentLength: uploaded.length, Body: { transformToByteArray: async () => uploaded } } } } }))
  assert.equal(await readFile(path.join(directory, 'offsite-backup-status.json'), 'utf8'), verified)
}))

test('missing backup configuration is explicit and enabled backups cannot silently downgrade', async () => {
  assert.equal(offsiteBackupConfig({}), null)
  assert.deepEqual(await runOffsiteBackup({ env: {} }), { status: 'disabled' })
  assert.deepEqual(await offsiteBackupHealth({ env: {} }), { enabled: false })
  assert.throws(() => offsiteBackupConfig({ BACKUP_OFFSITE_ENABLED: 'true' }), /required/)
  assert.throws(() => offsiteBackupConfig({ BACKUP_OFFSITE_ENABLED: 'tru' }), /true or false/)
  assert.throws(() => offsiteBackupConfig({ ...configured, BACKUP_S3_ENDPOINT: 'http://insecure.example' }), /HTTPS/)
})

test('oversized remote objects and failed uploads cannot mark a backup verified', () => withHttpApp(async ({ directory }) => {
  const env = { ...configured, GUILD_DATA_DIR: directory }
  assert.equal((await offsiteBackupHealth({ env })).healthy, false)
  await assert.rejects(runOffsiteBackup({ env, client: { async send() { throw new Error('storage unavailable') } } }), /storage unavailable/)
  await assert.rejects(runOffsiteBackup({ env, client: { async send(command) {
    if (command.constructor.name === 'PutObjectCommand') return {}
    return { ContentLength: MAX_SNAPSHOT_BYTES * 2 + 1, Body: { transformToByteArray() { throw new Error('Must not read oversized object') } } }
  } } }), /size limit/)
  assert.equal((await offsiteBackupHealth({ env })).healthy, false)
}))

test('scheduled backups start after one minute, repeat every six hours, and never overlap', async () => {
  const callbacks = []
  const cleared = []
  let calls = 0
  let finish
  const timers = { setTimeout(fn, delay) { callbacks.push({ fn, delay }); return 1 }, setInterval(fn, delay) { callbacks.push({ fn, delay }); return 2 }, clearTimeout(id) { cleared.push(id) }, clearInterval(id) { cleared.push(id) } }
  const stop = startOffsiteBackupScheduler({ env: configured, timers, run: () => { calls++; return new Promise((resolve) => { finish = resolve }) } })
  assert.deepEqual(callbacks.map(({ delay }) => delay), [60_000, 6 * 60 * 60 * 1000])
  const running = callbacks[0].fn()
  await callbacks[1].fn()
  assert.equal(calls, 1)
  finish()
  await running
  stop()
  await callbacks[1].fn()
  assert.equal(calls, 1)
  assert.deepEqual(cleared, [1, 2])
  startOffsiteBackupScheduler({ env: {}, timers })()
})

test('readiness rejects missing business data and reports backup freshness separately from liveness', () => withHttpApp(async ({ request }) => {
  assert.equal((await request('/api/health/ready')).status, 200)
  assert.equal((await request('/api/health/ready')).json.offsiteBackup.healthy, false)
  assert.equal((await request('/api/health/live')).json.release, 'fixture-release')
  withGuildTransaction((db) => db.prepare('DELETE FROM quest_settings').run())
  assert.equal((await request('/api/health/ready')).status, 503)
  assert.equal((await request('/api/health/live')).status, 200)
}, { env: { BACKUP_OFFSITE_ENABLED: 'true', HOLDFAST_RELEASE_SHA: 'fixture-release', RENDER_GIT_COMMIT: '' } }))
