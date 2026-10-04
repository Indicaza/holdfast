import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { guildMigrationHistory, openGuildDatabase } from '../src/Data/database.js'
import { readQuests } from '../src/Quest/questRepository.js'
import { readGuildMembers } from '../src/Guild/memberRepository.js'
import { readMemberContributionHistory } from '../src/Contribution/contributionRepository.js'

test('released migration bodies stay immutable while new versions may be appended', async () => {
  const frozen = JSON.parse(await readFile(new URL('./fixtures/applied-migrations.json', import.meta.url)))
  assert.deepEqual(guildMigrationHistory().slice(0, frozen.length), frozen, 'Append a migration; do not edit one already released')
})

test('the frozen release database upgrades without losing profiles, quests, authority, or ledger history', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'holdfast-frozen-release-'))
  const previous = { NODE_ENV: process.env.NODE_ENV, GUILD_DATA_DIR: process.env.GUILD_DATA_DIR }
  try {
    Object.assign(process.env, { NODE_ENV: 'test', GUILD_DATA_DIR: directory })
    const sql = await readFile(new URL('./fixtures/release-schema-v5.sql', import.meta.url), 'utf8')
    const manifest = JSON.parse(await readFile(new URL('./fixtures/release-schema-v5.json', import.meta.url)))
    assert.equal(createHash('sha256').update(sql).digest('hex'), manifest.sha256, 'Historical fixtures must not be silently regenerated')
    const old = new DatabaseSync(path.join(directory, 'holdfast.sqlite'))
    old.exec(sql)
    const tables = old.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT IN ('schema_migrations', 'sqlite_sequence') ORDER BY name").all().map(({ name }) => ({ name, columns: old.prepare(`PRAGMA table_info("${name}")`).all().map((column) => column.name) }))
    const readState = (db) => Object.fromEntries(tables.map(({ name, columns }) => [name, db.prepare(`SELECT ${columns.map((column) => `"${column}"`).join(',')} FROM "${name}" ORDER BY rowid`).all()]))
    const before = readState(old)
    assert.equal(Number(old.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version), 5)
    old.close()
    const upgraded = openGuildDatabase()
    try {
      assert.deepEqual(readState(upgraded), before)
      assert.equal(upgraded.prepare('PRAGMA quick_check').get().quick_check, 'ok')
      assert.deepEqual(upgraded.prepare('PRAGMA foreign_key_check').all(), [])
      assert.ok(upgraded.prepare("SELECT name FROM sqlite_schema WHERE name = 'quest_completion_requests'").get())
    } finally { upgraded.close() }
    assert.equal((await readGuildMembers()).find((member) => member.id === 'e2e-member').profile.characters[0].name, 'Frozen Rook')
    assert.equal((await readQuests()).quests[0].title, 'E2E Supply Run')
    assert.equal((await readMemberContributionHistory('e2e-member'))[0].marks, 5)
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await rm(directory, { recursive: true, force: true })
  }
})
