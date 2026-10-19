import assert from 'node:assert/strict'
import test from 'node:test'
import { withGuildDatabase } from '../src/Data/database.js'
import { ensureCharacterReadModelSchema } from '../src/Character/ReadModel/readModelSchema.js'
import { normalizeGuildListing, normalizeGuildSearch, guildSlug, validSlug } from '../src/Guild/Directory/guildDirectoryModel.js'
import { HOLDFAST_GUILD_ID } from '../src/Guild/Directory/guildDirectoryMigration.js'
import { withHttpApp, memberIds } from '../testSupport/httpHarness.js'

const listing = (change = {}) => ({
  name: 'Ashen Vanguard',
  tagline: 'Late-night raiding on the hardcore realm.',
  faction: 'horde',
  region: 'us',
  realm: 'Doomhowl',
  realmType: 'hardcore',
  playStyles: ['raiding', 'hardcore'],
  recruitingClasses: ['priest', 'warrior', 'paladin'],
  recruitingRoles: ['healer'],
  raidDays: ['tue', 'thu'],
  raidStart: '20:00',
  raidEnd: '23:00',
  timezone: 'America/Chicago',
  discordInviteUrl: 'discord.gg/ashen',
  ...change,
})

function addFreeAgent(id, name = id) {
  const now = new Date().toISOString()
  withGuildDatabase((db) => db.prepare(`
    INSERT INTO members (id, username, display_name, initials, rank, status, first_seen_at, updated_at)
    VALUES (?, ?, ?, 'FA', 'Initiate', 'active', ?, ?)
  `).run(id, name, name, now, now))
}

function addCard(memberId, { characterId, className, level, lastSeenAt }) {
  withGuildDatabase((db) => {
    ensureCharacterReadModelSchema(db)
    db.prepare("INSERT INTO characters (id, member_id, name) VALUES (?, ?, ?)").run(characterId, memberId, characterId)
    db.prepare(`
      INSERT INTO character_cards (character_id, member_id, name, class_name, level, last_seen_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(characterId, memberId, characterId, className, level, lastSeenAt, lastSeenAt)
  })
}

test('listing input is normalized and every required directory field is enforced', () => {
  const valid = normalizeGuildListing(listing())
  assert.equal(valid.ok, true)
  assert.equal(valid.listing.slug, 'ashen-vanguard')
  assert.equal(valid.listing.region, 'US')
  assert.equal(valid.listing.discordInviteUrl, 'https://discord.gg/ashen')
  assert.deepEqual(valid.listing.playStyles, ['raiding', 'hardcore'])

  const invalid = normalizeGuildListing({ name: 'x', faction: 'pirates', playStyles: ['knitting'], discordInviteUrl: 'https://evil.example/invite', raidStart: '20:00' })
  assert.equal(invalid.ok, false)
  for (const field of ['name', 'faction', 'region', 'realm', 'realmType', 'playStyles', 'discordInviteUrl', 'raidStart']) {
    assert.ok(invalid.errors[field], field)
  }
  assert.equal(normalizeGuildListing(listing({ timezone: 'Mars/Olympus' })).errors.timezone, 'guild_timezone_invalid')
  assert.equal(guildSlug('  Les Chevaliers d’Élune!! '), 'les-chevaliers-d-elune')
  assert.equal(validSlug('admin'), false)
  assert.equal(validSlug('a'), false)

  const search = normalizeGuildSearch({ faction: 'horde,goblin', realmType: ['pvp', 'hardcore'], style: 'raiding', class: 'priest', sort: 'chaos', limit: '500' })
  assert.deepEqual(search.factions, ['horde'])
  assert.deepEqual(search.realmTypes, ['pvp', 'hardcore'])
  assert.equal(search.recruitingClass, 'priest')
  assert.equal(search.sort, 'active')
  assert.equal(search.limit, 48)
})

test('Holdfast is seeded as the first guild and existing members join it', async () => {
  await withHttpApp(async ({ request }) => {
    const memberships = withGuildDatabase((db) => db.prepare("SELECT guild_id, member_id FROM guild_memberships WHERE status = 'active'").all())
    assert.ok(memberships.length >= 3)
    assert.ok(memberships.every((row) => row.guild_id === HOLDFAST_GUILD_ID))

    const detail = await request('/api/guilds/holdfast')
    assert.equal(detail.status, 200)
    assert.equal(detail.json.guild.name, 'Holdfast')
    assert.equal(detail.json.guild.faction, 'alliance')
    assert.equal(detail.json.guild.stats.memberCount, memberships.length)

    const mine = await request('/api/guilds/mine', { persona: 'member' })
    assert.deepEqual(mine.json.guild, { slug: 'holdfast', name: 'Holdfast', role: 'member' })
  })
})

test('a player registers a guild, it is listed with filters, and they cannot found a second one', async () => {
  await withHttpApp(async ({ request }) => {
    addFreeAgent('founder')
    assert.equal((await request('/api/guilds', { method: 'POST', body: listing() })).status, 401)

    const created = await request('/api/guilds', { method: 'POST', persona: 'founder', body: listing() })
    assert.equal(created.status, 201, created.text)
    assert.equal(created.json.slug, 'ashen-vanguard')

    const again = await request('/api/guilds', { method: 'POST', persona: 'founder', body: listing({ name: 'Second Guild' }) })
    assert.equal(again.status, 409)
    assert.equal(again.json.error, 'already_in_guild')

    addFreeAgent('copycat')
    const taken = await request('/api/guilds', { method: 'POST', persona: 'copycat', body: listing() })
    assert.equal(taken.json.error, 'guild_slug_taken')

    const invalid = await request('/api/guilds', { method: 'POST', persona: 'copycat', body: { name: 'No Faction' } })
    assert.equal(invalid.status, 400)
    assert.ok(invalid.json.fields.faction)

    const hardcoreHorde = await request('/api/guilds?faction=horde&realmType=hardcore&style=raiding&class=priest')
    assert.deepEqual(hardcoreHorde.json.guilds.map((guild) => guild.slug), ['ashen-vanguard'])
    assert.equal(hardcoreHorde.json.guilds[0].schedule.raidDays.join(','), 'tue,thu')
    assert.equal(hardcoreHorde.json.facets.factions.horde, 1)
    assert.equal(hardcoreHorde.json.facets.factions.alliance, 1)

    for (const query of ['faction=alliance&realmType=hardcore', 'style=raiding,roleplay', 'class=rogue', 'day=sat', 'q=nothing-like-this']) {
      const none = await request(`/api/guilds?${query}`)
      assert.ok(!none.json.guilds.some((guild) => guild.slug === 'ashen-vanguard'), query)
    }
    assert.ok((await request('/api/guilds?q=doomhowl')).json.guilds.some((guild) => guild.slug === 'ashen-vanguard'))

    const edit = await request('/api/guilds/ashen-vanguard', { method: 'PUT', persona: 'founder', body: listing({ visibility: 'unlisted' }) })
    assert.equal(edit.status, 200, edit.text)
    assert.ok(!(await request('/api/guilds')).json.guilds.some((guild) => guild.slug === 'ashen-vanguard'))
    assert.equal((await request('/api/guilds/ashen-vanguard')).status, 200)

    const outsiderEdit = await request('/api/guilds/ashen-vanguard', { method: 'PUT', persona: 'member', body: listing() })
    assert.equal(outsiderEdit.status, 403)
  })
})

test('verified roster stats come from recently synced characters, as aggregates only', async () => {
  await withHttpApp(async ({ request }) => {
    const now = Date.now()
    const recent = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString()
    const stale = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString()
    addCard(memberIds.member, { characterId: 'card-1', className: 'Priest', level: 60, lastSeenAt: recent })
    addCard(memberIds.officer, { characterId: 'card-2', className: 'Warrior', level: 40, lastSeenAt: recent })
    addCard(memberIds.officer, { characterId: 'card-3', className: 'Mage', level: 20, lastSeenAt: stale })

    const { guild } = (await request('/api/guilds/holdfast')).json
    assert.equal(guild.stats.verified, true)
    assert.equal(guild.stats.verifiedCharacters, 2)
    assert.equal(guild.stats.activeCharacters, 2)
    assert.equal(guild.stats.averageLevel, 50)
    assert.equal(guild.stats.maxLevelCharacters, 1)
    assert.deepEqual(guild.stats.classMix, { priest: 1, warrior: 1 })
    assert.ok(!JSON.stringify(guild).includes('card-1'))
  })
})

test('applications and sister guilds need the right people on both sides', async () => {
  await withHttpApp(async ({ request }) => {
    addFreeAgent('founder')
    addFreeAgent('applicant')
    await request('/api/guilds', { method: 'POST', persona: 'founder', body: listing() })

    const applied = await request('/api/guilds/ashen-vanguard/applications', {
      method: 'POST', persona: 'applicant', body: { characterName: 'Mendra', classToken: 'priest', role: 'healer', message: 'Healer looking for a home.' },
    })
    assert.equal(applied.status, 201, applied.text)
    const duplicate = await request('/api/guilds/ashen-vanguard/applications', { method: 'POST', persona: 'applicant', body: {} })
    assert.equal(duplicate.json.error, 'application_pending')
    const member = await request('/api/guilds/ashen-vanguard/applications', { method: 'POST', persona: 'member', body: {} })
    assert.equal(member.json.error, 'already_in_guild')

    // Holdfast has no owner membership in the fixtures; make the officer one.
    withGuildDatabase((db) => db.prepare("UPDATE guild_memberships SET role = 'officer' WHERE member_id = ?").run(memberIds.officer))

    const notManager = await request('/api/guilds/holdfast/sisters', { method: 'POST', persona: 'member', body: { guild: 'ashen-vanguard' } })
    assert.equal(notManager.status, 403)
    const self = await request('/api/guilds/holdfast/sisters', { method: 'POST', persona: 'officer', body: { guild: 'holdfast' } })
    assert.equal(self.json.error, 'sister_guild_self')

    const asked = await request('/api/guilds/holdfast/sisters', { method: 'POST', persona: 'officer', body: { guild: 'ashen-vanguard' } })
    assert.equal(asked.json.status, 'pending')
    assert.deepEqual((await request('/api/guilds/holdfast')).json.guild.sisters, [])

    const accepted = await request('/api/guilds/ashen-vanguard/sisters/holdfast/accept', { method: 'POST', persona: 'founder' })
    assert.equal(accepted.status, 200, accepted.text)
    assert.deepEqual((await request('/api/guilds/holdfast')).json.guild.sisters.map((guild) => guild.slug), ['ashen-vanguard'])
    assert.deepEqual((await request('/api/guilds/ashen-vanguard')).json.guild.sisters.map((guild) => guild.slug), ['holdfast'])
  })
})

test('a member leaves their guild to found another; owners must hand over first', async () => {
  await withHttpApp(async ({ request }) => {
    const blocked = await request('/api/guilds', { method: 'POST', persona: 'member', body: listing() })
    assert.equal(blocked.json.error, 'already_in_guild')
    assert.equal((await request('/api/guilds/mine/leave', { method: 'POST', persona: 'member' })).status, 200)
    assert.equal((await request('/api/guilds/mine', { persona: 'member' })).json.guild, null)
    assert.equal((await request('/api/guilds', { method: 'POST', persona: 'member', body: listing() })).status, 201)

    addFreeAgent('recruit')
    await request('/api/guilds/ashen-vanguard/applications', { method: 'POST', persona: 'recruit', body: {} })
    withGuildDatabase((db) => db.prepare(`
      INSERT INTO guild_memberships (guild_id, member_id, role, status, joined_at)
      SELECT id, 'recruit', 'member', 'active', ? FROM guilds WHERE slug = 'ashen-vanguard'
    `).run(new Date().toISOString()))
    const owner = await request('/api/guilds/mine/leave', { method: 'POST', persona: 'member' })
    assert.equal(owner.json.error, 'owner_must_transfer')
  })
})
