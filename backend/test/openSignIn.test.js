import assert from 'node:assert/strict'
import test from 'node:test'
import { withGuildDatabase } from '../src/Data/database.js'
import { HOLDFAST_GUILD_ID } from '../src/Guild/Directory/guildDirectoryMigration.js'
import { guildRolePermissions } from '../src/Guild/Directory/guildRoles.js'
import { withHttpApp, memberIds } from '../testSupport/httpHarness.js'

const HOLDFAST_SERVER_ID = '223456789012345678'
const OUTSIDER_ID = '323456789012345678'
const NEWCOMER_ID = '333456789012345678'

const discordEnv = {
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_CLIENT_SECRET: 'client-secret',
  DISCORD_GUILD_ID: HOLDFAST_SERVER_ID,
  DISCORD_BOT_TOKEN: 'bot-token',
}

const listing = (name, change = {}) => ({
  name,
  faction: 'horde',
  region: 'us',
  realm: 'Doomhowl',
  realmType: 'hardcore',
  playStyles: ['raiding'],
  ...change,
})

// Discord answers for two users: one only on Discord, one in Holdfast's server.
function discordFetch() {
  return async (url, options = {}) => {
    const { pathname } = new URL(String(url))
    const token = String(options.headers?.Authorization || '').replace('Bearer ', '')
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
    if (pathname.endsWith('/oauth2/token')) return json({ access_token: String(options.body.get('code')) })
    if (pathname.endsWith('/users/@me')) return json({ id: token, username: `user-${token.slice(-4)}`, global_name: null, avatar: null })
    if (pathname.endsWith(`/users/@me/guilds/${HOLDFAST_SERVER_ID}/member`)) {
      return token === NEWCOMER_ID
        ? json({ roles: [], nick: 'Newcomer', joined_at: '2026-10-01T00:00:00.000Z' })
        : json({ message: 'Unknown Member' }, 404)
    }
    throw new Error(`Unexpected Discord request: ${url}`)
  }
}

// Runs the real OAuth round trip; the code doubles as the Discord user ID.
async function signIn(base, discordUserId, returnTo = '/guilds') {
  const started = await fetch(`${base}/api/auth/discord?${new URLSearchParams({ returnTo })}`, { redirect: 'manual' })
  const state = new URL(started.headers.get('location')).searchParams.get('state')
  const callback = await fetch(`${base}/api/auth/discord/callback?${new URLSearchParams({ state, code: discordUserId })}`, {
    redirect: 'manual',
    headers: { Cookie: started.headers.get('set-cookie').split(';', 1)[0] },
  })
  const session = callback.headers.getSetCookie().find((value) => value.startsWith('guild_session='))
  return { location: callback.headers.get('location'), cookie: session.split(';', 1)[0] }
}

const memberships = (memberId) => withGuildDatabase((db) => db.prepare(
  'SELECT guild_id AS guildId, role, status FROM guild_memberships WHERE member_id = ?',
).all(memberId).map((row) => ({ ...row })))

const holdfastPages = ['/api/guild/members', '/api/guild/members/me', `/api/guild/members/${memberIds.member}`, '/api/quests/member', '/api/guild/authority', '/api/guild/billets']

test('a Discord user outside Holdfast signs in, has no guild, and is kept off Holdfast pages', async () => {
  await withHttpApp(async ({ request, base }) => {
    const { location, cookie } = await signIn(base, OUTSIDER_ID, '/guilds/register')
    assert.equal(location, 'https://holdfast.example/guilds/register?auth=connected')

    const me = await request('/api/me', { rawCookie: cookie })
    assert.equal(me.json.authenticated, true)
    assert.equal(me.json.guild, null)
    assert.equal(me.json.holdfastMember, false)
    assert.deepEqual(me.json.permissions, [])
    assert.deepEqual(memberships(OUTSIDER_ID), [])
    assert.equal(withGuildDatabase((db) => db.prepare('SELECT status FROM members WHERE id = ?').get(OUTSIDER_ID)).status, 'departed')

    for (const page of holdfastPages) {
      const response = await request(page, { rawCookie: cookie })
      assert.equal(response.status, 403, page)
      assert.equal(response.json.error, 'holdfast_membership_required', page)
    }
    assert.equal((await request('/api/guild/members/me/timezone', { method: 'PATCH', rawCookie: cookie, body: { timezone: 'America/Chicago' } })).status, 200)
    const roster = (await request('/api/guild/members', { persona: 'member' })).json.members.map((member) => member.id)
    assert.equal(roster.includes(OUTSIDER_ID), false)

    // Registration is what open sign-in is for.
    const registered = await request('/api/guilds', { method: 'POST', rawCookie: cookie, body: listing('Ashen Vanguard') })
    assert.equal(registered.status, 201, registered.text)
    const after = await request('/api/me', { rawCookie: cookie })
    assert.equal(after.json.guild.slug, 'ashen-vanguard')
    assert.equal(after.json.guild.role, 'owner')
    assert.deepEqual(after.json.guild.permissions, guildRolePermissions('owner'))
    assert.equal(after.json.holdfastMember, false)
    assert.equal((await request('/api/guild/members', { rawCookie: cookie })).status, 403)
  }, { env: discordEnv, discordAuthOptions: { fetchImpl: discordFetch() } })
})

test('signing in from Holdfast\'s server still places the player in Holdfast', async () => {
  await withHttpApp(async ({ request, base }) => {
    const { location, cookie } = await signIn(base, NEWCOMER_ID)
    assert.equal(location, 'https://holdfast.example/guilds?auth=connected')
    assert.deepEqual(memberships(NEWCOMER_ID), [{ guildId: HOLDFAST_GUILD_ID, role: 'member', status: 'active' }])

    const me = await request('/api/me', { rawCookie: cookie })
    assert.equal(me.json.holdfastMember, true)
    assert.equal(me.json.guild.slug, 'holdfast')
    for (const page of holdfastPages) {
      assert.equal((await request(page, { rawCookie: cookie })).status, 200, page)
    }
  }, { env: discordEnv, discordAuthOptions: { fetchImpl: discordFetch() } })
})

test('a Holdfast member who leaves for another guild loses Holdfast pages and authority', async () => {
  await withHttpApp(async ({ request }) => {
    assert.equal((await request('/api/guild/members', { persona: 'officer' })).status, 200)
    const before = (await request('/api/me', { persona: 'officer' })).json.permissions
    assert.ok(before.length > 0)

    assert.equal((await request('/api/guilds/mine/leave', { method: 'POST', persona: 'officer' })).status, 200)
    assert.equal((await request('/api/guilds', { method: 'POST', persona: 'officer', body: listing('Ashen Vanguard') })).status, 201)

    const me = (await request('/api/me', { persona: 'officer' })).json
    assert.equal(me.holdfastMember, false)
    assert.deepEqual(me.permissions, [])
    assert.equal((await request('/api/guild/members', { persona: 'officer' })).status, 403)
    assert.equal((await request('/api/quests/member', { persona: 'officer' })).status, 403)
  })
})

test('guild owners and officers get permissions from their role, only in their own guild', async () => {
  await withHttpApp(async ({ request }) => {
    const addAccount = (id) => withGuildDatabase((db) => db.prepare(`
      INSERT INTO members (id, username, display_name, initials, rank, status, first_seen_at, updated_at)
      VALUES (?, ?, ?, 'XX', 'Recruit', 'departed', ?, ?)
    `).run(id, id, id, new Date().toISOString(), new Date().toISOString()))
    for (const id of ['ashen-owner', 'ashen-officer', 'ashen-member', 'ember-owner']) addAccount(id)

    assert.equal((await request('/api/guilds', { method: 'POST', persona: 'ashen-owner', body: listing('Ashen Vanguard') })).status, 201)
    assert.equal((await request('/api/guilds', { method: 'POST', persona: 'ember-owner', body: listing('Ember Court') })).status, 201)
    withGuildDatabase((db) => {
      const join = db.prepare(`
        INSERT INTO guild_memberships (guild_id, member_id, role, status, joined_at)
        SELECT id, ?, ?, 'active', ? FROM guilds WHERE slug = 'ashen-vanguard'
      `)
      join.run('ashen-officer', 'officer', new Date().toISOString())
      join.run('ashen-member', 'member', new Date().toISOString())
    })

    const officer = (await request('/api/me', { persona: 'ashen-officer' })).json
    assert.equal(officer.guild.role, 'officer')
    assert.deepEqual(officer.guild.permissions, guildRolePermissions('officer'))
    assert.deepEqual(officer.permissions, [], 'a guild role grants no Holdfast permissions')
    assert.deepEqual((await request('/api/me', { persona: 'ashen-member' })).json.guild.permissions, [])

    const edit = (persona, slug) => request(`/api/guilds/${slug}`, { method: 'PUT', persona, body: listing(slug, { tagline: `Edited by ${persona}` }) })
    assert.equal((await edit('ashen-officer', 'ashen-vanguard')).status, 200)
    assert.equal((await edit('ashen-owner', 'ashen-vanguard')).status, 200)
    assert.equal((await edit('ashen-member', 'ashen-vanguard')).json.error, 'guild_manager_required')
    assert.equal((await edit('ashen-officer', 'ember-court')).json.error, 'guild_manager_required')
    assert.equal((await edit('ember-owner', 'ashen-vanguard')).status, 403)

    const sister = await request('/api/guilds/ashen-vanguard/sisters', { method: 'POST', persona: 'ashen-officer', body: { guild: 'ember-court' } })
    assert.equal(sister.json.status, 'pending')
    assert.equal((await request('/api/guilds/ember-court/sisters/ashen-vanguard/accept', { method: 'POST', persona: 'ashen-officer' })).status, 403)
    assert.equal((await request('/api/guilds/ember-court/sisters/ashen-vanguard/accept', { method: 'POST', persona: 'ember-owner' })).status, 200)

    // Leaving the guild takes the role's permissions with it.
    withGuildDatabase((db) => db.prepare("UPDATE guild_memberships SET status = 'departed' WHERE member_id = 'ashen-officer'").run())
    assert.equal((await edit('ashen-officer', 'ashen-vanguard')).status, 403)
  })
})
