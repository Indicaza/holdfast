import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { withGuildDatabase, withGuildTransaction } from '../src/Data/database.js'
import { createStorageObservatory } from '../src/Production/storageObservatory.js'
import { domainOf } from '../src/Production/storageDomains.js'
import { withHttpApp } from '../testSupport/httpHarness.js'

const quiet = { info() {}, error() {} }
let observatory
const appOptions = (directory) => {
  observatory = createStorageObservatory({ dataDir: directory, log: quiet })
  return { storageObservatory: observatory }
}

test('storage reports are for site administrators only, read-only and rate limited', () => withHttpApp(async ({ request }) => {
  assert.equal((await request('/api/admin/storage/overview')).status, 401)
  assert.equal((await request('/api/admin/storage/overview', { persona: 'member' })).status, 403)
  const index = await request('/api/admin/storage', { persona: 'owner' })
  assert.equal(index.status, 200)
  assert.deepEqual(index.json.sections, ['overview', 'tables', 'backups', 'ingestion', 'growth', 'maintenance'])
  assert.equal((await request('/api/admin/storage/../../etc/passwd', { persona: 'owner' })).status, 404)
  assert.equal((await request('/api/admin/storage/sql', { persona: 'owner' })).status, 404)
  for (const method of ['POST', 'PUT', 'DELETE']) {
    assert.ok([404, 405].includes((await request('/api/admin/storage/overview', { persona: 'owner', method, body: {} })).status), method)
  }
}, { appOptions }))

test('reports describe the disk, the database, backups and growth without stored values', () => withHttpApp(async ({ request, directory }) => {
  withGuildTransaction((db) => db.prepare("UPDATE member_profiles SET bio = 'secret-bio-text' WHERE member_id = 'e2e-member'").run())
  await mkdir(path.join(directory, 'deploy-backups'))
  await writeFile(path.join(directory, 'deploy-backups', 'holdfast-before-startup-2026-01-01T00-00-00-000Z.sqlite'), Buffer.alloc(4096))

  const overview = await request('/api/admin/storage/overview', { persona: 'owner' })
  assert.equal(overview.status, 200)
  assert.equal(overview.json.version, 1)
  assert.ok(overview.json.disk.capacityBytes > 0 && overview.json.disk.freeBytes > 0)
  assert.ok(overview.json.database.fileBytes > 0)
  assert.equal(overview.json.database.journalMode, 'wal')
  assert.ok(overview.json.database.schemaVersion >= 20)
  assert.ok(overview.json.files.some((file) => file.name === 'holdfast.sqlite' && file.kind === 'database'))
  assert.ok(overview.json.files.some((file) => file.name === 'deploy-backups/' && file.files === 1 && file.bytes === 4096))

  // Heavy figures: 202 while collecting, then real tables.
  const pending = await request('/api/admin/storage/tables', { persona: 'owner' })
  assert.equal(pending.status, 202)
  assert.equal(pending.json.status, 'collecting')
  await observatory.refresh()
  const tables = await request('/api/admin/storage/tables', { persona: 'owner' })
  assert.equal(tables.status, 200)
  const members = tables.json.tables.find((table) => table.table === 'members')
  assert.equal(members.domain, 'guild_operations')
  assert.ok(members.dataBytes > 0 && members.approxRows >= 3)
  assert.ok(tables.json.tables.some((table) => table.domain === 'auction_house'))

  const backups = await request('/api/admin/storage/backups', { persona: 'owner' })
  assert.deepEqual(backups.json.startup.snapshots.map((entry) => [entry.kind, entry.bytes]), [['legacy', 4096]])
  assert.deepEqual(backups.json.offsite, { enabled: false })

  const ingestion = await request('/api/admin/storage/ingestion', { persona: 'owner' })
  assert.ok(ingestion.json.sources.some((source) => source.source === 'guildweaver_telemetry_records' && Number.isInteger(source.last24h)))
  assert.equal((await request('/api/admin/storage/maintenance', { persona: 'owner' })).status, 200)
  const growth = await request('/api/admin/storage/growth', { persona: 'owner' })
  assert.equal(growth.json.samples, 1)
  assert.equal(growth.json.last24h, null, 'one sample is not a rate')

  const everything = JSON.stringify([overview.json, tables.json, backups.json, ingestion.json, growth.json])
  for (const secret of ['secret-bio-text', 'e2e-member', 'e2e-commander', directory]) assert.equal(everything.includes(secret), false, secret)
}, { appOptions }))

test('growth is computed per day from samples, by domain', async () => {
  let now = Date.parse('2026-11-10T00:00:00Z')
  // The light report needs a database; use one from a test app directory.
  await withHttpApp(async ({ directory }) => {
    const observed = createStorageObservatory({ dataDir: directory, clock: () => now, log: quiet, collectHeavy: async () => ({ tables: [
      { table: 'market_observations', domain: 'auction_house', totalBytes: (now - Date.parse('2026-11-10T00:00:00Z')) / 1000 * 100 },
    ], ingestion: [], maintenance: [], durationMs: 1 }) })
    for (let hour = 0; hour <= 48; hour += 12) {
      now = Date.parse('2026-11-10T00:00:00Z') + hour * 3600_000
      await observed.refresh()
    }
    const { body } = await observed.report('growth')
    assert.equal(body.samples, 5)
    assert.equal(body.last24h.domainsBytesPerDay.auction_house, 8640000)
    assert.equal(body.last7d.samples, 5)
  })
})

test('every table maps to a storage domain', () => withHttpApp(async () => {
  const tables = withGuildDatabase((db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name))
  const unmapped = tables.filter((name) => domainOf(name) === 'system' && !['schema_migrations', 'app_meta', 'character_read_model_meta'].includes(name))
  assert.deepEqual(unmapped, [])
}))
