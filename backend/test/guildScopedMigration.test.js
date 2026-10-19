import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { closeGuildDatabase, guildDatabaseFile, migrateGuildDatabase, openGuildDatabase } from '../src/Data/database.js'
import { DEFAULT_GUILD_RANKS } from '../src/Guild/guildDefaults.js'
import { HOLDFAST_GUILD_ID } from '../src/Guild/guildScope.js'
import { readQuestWorkspace } from '../src/Quest/questRepository.js'
import { readGuildMembers } from '../src/Guild/memberRepository.js'
import { resolveMemberAuthority } from '../src/Guild/authorityRepository.js'

const GUILD_OWNED = ['quests', 'objectives', 'reward_items', 'assignments', 'contribution_transactions', 'quest_completion_requests', 'billets', 'member_billets', 'rank_authority', 'audit_events', 'notifications', 'guild_bank_snapshots', 'quest_settings']
const now = '2026-10-18T12:00:00.000Z'

// A production-shaped schema-12 database: Holdfast's operations plus one
// guild registered through the directory before guild-scoped data existed.
function seedVersionTwelve() {
  const db = new DatabaseSync(guildDatabaseFile())
  try {
    migrateGuildDatabase(db, { throughVersion: 12 })
    const member = db.prepare("INSERT INTO members (id, username, display_name, initials, rank, status, first_seen_at, updated_at) VALUES (?, ?, ?, 'XX', ?, ?, ?, ?)")
    member.run('hf-captain', 'captain', 'Captain Vale', 'Captain', 'active', now, now)
    member.run('hf-private', 'private', 'Private Wren', 'Private', 'active', now, now)
    member.run('ash-founder', 'founder', 'Ash Founder', 'Recruit', 'departed', now, now)
    member.run('ash-member', 'ashling', 'Ash Member', 'Recruit', 'departed', now, now)
    const membership = db.prepare("INSERT INTO guild_memberships (guild_id, member_id, role, status, joined_at) VALUES (?, ?, ?, 'active', ?)")
    membership.run(HOLDFAST_GUILD_ID, 'hf-captain', 'member', now)
    membership.run(HOLDFAST_GUILD_ID, 'hf-private', 'member', now)
    db.prepare("INSERT INTO guilds (id, slug, name, faction, region, realm, realm_type, owner_member_id, created_at, updated_at) VALUES ('guild-ash', 'ashen-vanguard', 'Ashen Vanguard', 'horde', 'US', 'Doomhowl', 'hardcore', 'ash-founder', ?, ?)").run(now, now)
    membership.run('guild-ash', 'ash-founder', 'owner', now)
    membership.run('guild-ash', 'ash-member', 'member', now)

    db.prepare("UPDATE quest_settings SET focused_quest_id = 'quest-1', reward_policy = 'Pay fairly.', rep_max = 800 WHERE id = 1").run()
    db.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('quest_revision', '4', ?)").run(now)
    db.prepare("INSERT INTO quests (id, publication, mode, title, created_by_member_id, created_at) VALUES ('quest-1', 'published', 'rotating', 'Stock the bank', 'hf-captain', ?)").run(now)
    db.prepare("INSERT INTO objectives (id, quest_id, title, priority, reward_rep, reward_marks) VALUES ('objective-1', 'quest-1', 'Linen', 'High', 100, 5)").run()
    db.prepare("INSERT INTO reward_items (id, objective_id, name, quantity) VALUES ('reward-item-1', 'objective-1', 'Linen Bag', 2)").run()
    db.prepare("INSERT INTO assignments (objective_id, member_id, name, initials) VALUES ('objective-1', 'hf-private', 'Private Wren', 'PW')").run()
    db.prepare("INSERT INTO quest_completion_requests (objective_id, quest_id, status, objective_fingerprint, requested_by_member_id, requested_at, updated_at) VALUES ('objective-1', 'quest-1', 'pending', 'fp', 'hf-private', ?, ?)").run(now, now)
    db.prepare("INSERT INTO contribution_transactions (id, type, member_id, member_name, quest_id, quest_title, objective_id, objective_title, rep, marks, created_at) VALUES ('objective:objective-0:member:hf-private', 'objective_reward', 'hf-private', 'Private Wren', 'quest-0', 'Old', 'objective-0', 'Old', 50, 2, ?)").run(now)
    db.prepare("INSERT INTO member_billets (member_id, billet_id, assigned_at) VALUES ('hf-captain', 'billet-quartermaster', ?)").run(now)
    db.prepare(`UPDATE rank_authority SET permissions_json = '["quests.create"]' WHERE rank = 'Private'`).run()
    db.prepare("INSERT INTO audit_events (actor_member_id, event_type, entity_type, entity_id, created_at) VALUES ('hf-captain', 'quest.workspace_saved', 'quest_workspace', 'primary', ?)").run(now)
    db.prepare("INSERT INTO notifications (id, recipient_member_id, event_type, kind, title, dedupe_key, created_at, updated_at) VALUES ('notification-1', 'hf-captain', 'completion_requested', 'action', 'Review', 'completion-review:objective-1', ?, ?)").run(now, now)
    db.prepare("INSERT INTO guild_bank_snapshots (source, captured_at, payload_json) VALUES ('addon', ?, '{}')").run(now)
    return Object.fromEntries(GUILD_OWNED.map((table) => [table, Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)]))
  } finally {
    db.close()
  }
}

async function withTemporaryData(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'holdfast-guild-scope-'))
  const previous = { NODE_ENV: process.env.NODE_ENV, GUILD_DATA_DIR: process.env.GUILD_DATA_DIR, GUILD_OWNER_DISCORD_IDS: process.env.GUILD_OWNER_DISCORD_IDS }
  try {
    Object.assign(process.env, { NODE_ENV: 'test', GUILD_DATA_DIR: directory, GUILD_OWNER_DISCORD_IDS: '' })
    await run()
  } finally {
    closeGuildDatabase()
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await rm(directory, { recursive: true, force: true })
  }
}

test('migration 13 gives every existing row to Holdfast and seeds guilds registered before it', () => withTemporaryData(async () => {
  const before = seedVersionTwelve()
  const db = openGuildDatabase()

  try {
    assert.equal(Math.max(...db.prepare('SELECT version FROM schema_migrations').all().map((row) => Number(row.version))), 13)
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok')
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])

    // Every pre-existing row is Holdfast's, and none was lost.
    for (const table of GUILD_OWNED) {
      const holdfastRows = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE guild_id = ?`).get(HOLDFAST_GUILD_ID).count)
      const expected = table === 'rank_authority' ? 10 : table === 'quest_settings' ? 1 : before[table]
      assert.equal(holdfastRows, expected, `${table} keeps its Holdfast rows`)
      assert.equal(Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE guild_id IS NULL`).get().count), 0)
    }

    // Holdfast's settings, revision and authority carry over.
    const settings = db.prepare('SELECT * FROM quest_settings WHERE guild_id = ?').get(HOLDFAST_GUILD_ID)
    assert.equal(settings.focused_quest_id, 'quest-1')
    assert.equal(settings.reward_policy, 'Pay fairly.')
    assert.equal(settings.rep_max, 800)
    assert.equal(settings.revision, 4)
    const ladder = db.prepare('SELECT rank, sort_order, category, leadership, permissions_json FROM rank_authority WHERE guild_id = ? ORDER BY sort_order').all(HOLDFAST_GUILD_ID)
    assert.deepEqual(ladder.map((row) => row.rank), ['Recruit', 'Private', 'Corporal', 'Sergeant', 'Master Sergeant', 'Sergeant Major', 'Lieutenant', 'Captain', 'Major', 'Commander'])
    assert.deepEqual(ladder.map((row) => row.category), [...Array(6).fill('enlisted'), ...Array(4).fill('officer')])
    assert.equal(ladder[1].permissions_json, '["quests.create"]')

    // Ranks moved onto memberships.
    const ranks = Object.fromEntries(db.prepare('SELECT guild_id, member_id, rank FROM guild_memberships').all().map((row) => [`${row.guild_id}/${row.member_id}`, row.rank]))
    assert.deepEqual(ranks, {
      [`${HOLDFAST_GUILD_ID}/hf-captain`]: 'Captain',
      [`${HOLDFAST_GUILD_ID}/hf-private`]: 'Private',
      'guild-ash/ash-founder': 'Guild Master',
      'guild-ash/ash-member': '',
    })

    // The guild registered before the migration gets the new-guild defaults.
    assert.deepEqual(db.prepare("SELECT rank FROM rank_authority WHERE guild_id = 'guild-ash' ORDER BY sort_order").all().map((row) => row.rank), DEFAULT_GUILD_RANKS.map((rank) => rank.name))
    assert.deepEqual(db.prepare("SELECT name FROM billets WHERE guild_id = 'guild-ash' ORDER BY name").all().map((row) => row.name), ['Quartermaster', 'Raid Leader'])
    assert.ok(db.prepare("SELECT 1 FROM quest_settings WHERE guild_id = 'guild-ash'").get())
    for (const table of ['quests', 'contribution_transactions', 'audit_events', 'notifications', 'member_billets']) {
      assert.equal(Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE guild_id = 'guild-ash'`).get().count), 0, `${table} starts empty`)
    }
  } finally {
    db.close()
  }

  // The repositories read the migrated data through the guild.
  const workspace = await readQuestWorkspace(HOLDFAST_GUILD_ID)
  assert.equal(workspace.revision, 4)
  assert.equal(workspace.quests[0].objectives[0].reward.items[0].name, 'Linen Bag')
  assert.equal(workspace.quests[0].objectives[0].assignments[0].memberId, 'hf-private')
  assert.deepEqual((await readQuestWorkspace('guild-ash')).quests, [])
  const roster = await readGuildMembers(HOLDFAST_GUILD_ID)
  assert.deepEqual(roster.map((member) => [member.id, member.rank]), [['hf-captain', 'Captain'], ['hf-private', 'Private']])
  assert.deepEqual(roster[0].billets.map((billet) => billet.name), ['Quartermaster'])
  assert.deepEqual((await readGuildMembers('guild-ash')).map((member) => [member.id, member.rank]), [['ash-founder', 'Guild Master'], ['ash-member', 'Initiate']])
  assert.ok(resolveMemberAuthority(HOLDFAST_GUILD_ID, 'hf-private').permissions.includes('quests.create'))
  assert.equal(resolveMemberAuthority('guild-ash', 'ash-founder').isOwner, true)
  assert.deepEqual(resolveMemberAuthority('guild-ash', 'hf-captain').permissions, [])
}))
