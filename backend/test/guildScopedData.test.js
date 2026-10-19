import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { readContributionTotals } from '../src/Contribution/contributionRepository.js'
import { withGuildDatabase } from '../src/Data/database.js'
import { readRankLadder, resolveMemberAuthority } from '../src/Guild/authorityRepository.js'
import { DEFAULT_GUILD_RANKS } from '../src/Guild/guildDefaults.js'
import { HOLDFAST_GUILD_ID } from '../src/Guild/guildScope.js'
import { classifyLiveMutation } from '../src/Live/liveMutationObserver.js'
import { publishLiveUpdate, resetLiveUpdatesForTests, subscribeLiveUpdates } from '../src/Live/liveUpdateBus.js'
import { objective, persistentState, withHttpApp } from '../testSupport/httpHarness.js'

const IRONPINE = '/api/g/ironpine-wardens'
const ironpine = { owner: 'iron-owner', officer: 'iron-officer', member: 'iron-member' }

function addAccount(id) {
  const now = new Date().toISOString()
  // In Holdfast's Discord server (status active) but not in Holdfast: the
  // strongest case for leaking Holdfast access.
  withGuildDatabase((db) => db.prepare(`
    INSERT INTO members (id, username, display_name, initials, rank, status, first_seen_at, updated_at)
    VALUES (?, ?, ?, 'IP', 'Recruit', 'active', ?, ?)
  `).run(id, id, id, now, now))
}

async function successful(request, route, options, status = 200) {
  const response = await request(route, options)
  assert.equal(response.status, status, `${options?.method || 'GET'} ${route}: ${response.text}`)
  return response.json
}

// Ironpine Wardens: an owner who registers it, an Officer and a Member.
async function foundIronpine(request) {
  for (const id of Object.values(ironpine)) addAccount(id)
  await successful(request, '/api/guilds', {
    method: 'POST',
    persona: ironpine.owner,
    body: { name: 'Ironpine Wardens', faction: 'alliance', region: 'us', realm: 'Stormrage', realmType: 'pvp', playStyles: ['raiding'] },
  }, 201)
  const guildId = withGuildDatabase((db) => db.prepare("SELECT id FROM guilds WHERE slug = 'ironpine-wardens'").get().id)
  const now = new Date().toISOString()
  withGuildDatabase((db) => {
    const join = db.prepare("INSERT INTO guild_memberships (guild_id, member_id, role, status, joined_at, rank) VALUES (?, ?, ?, 'active', ?, ?)")
    join.run(guildId, ironpine.officer, 'officer', now, 'Officer')
    join.run(guildId, ironpine.member, 'member', now, 'Member')
  })
  return guildId
}

async function questFixture() {
  return JSON.parse(await readFile(new URL('../../e2e/fixtures/quests.json', import.meta.url)))
}

test('another guild\'s officer cannot read a guild\'s quests, members, billets, authority or audit', () => withHttpApp(async ({ request }) => {
  await foundIronpine(request)
  const ironBillet = (await successful(request, `${IRONPINE}/billets`, { persona: ironpine.owner })).billets[0]

  // Holdfast's Lieutenant and its configured owner hold nothing in Ironpine.
  for (const persona of ['officer', 'owner']) {
    for (const route of ['/quests/member', '/quests/member/completions', '/members', `/members/${ironpine.member}`, '/members/me', '/billets', '/authority']) {
      const response = await request(`${IRONPINE}${route}`, { persona })
      assert.equal(response.status, 403, `${persona} GET ${route}`)
      assert.equal(response.json.error, 'guild_membership_required')
    }
    for (const route of ['/quests/manage', '/members/manage/all', '/audit']) {
      const response = await request(`${IRONPINE}${route}`, { persona })
      assert.equal(response.status, 403, `${persona} GET ${route}`)
      assert.equal(response.json.error, 'permission_required')
    }
  }

  // Ironpine's officer holds nothing in Holdfast, by either path.
  for (const route of ['/api/quests/member', '/api/guild/members', `/api/guild/members/e2e-member`, '/api/guild/billets', '/api/guild/authority', '/api/g/holdfast/members', '/api/g/holdfast/billets']) {
    const response = await request(route, { persona: ironpine.officer })
    assert.equal(response.status, 403, `iron officer GET ${route}`)
    assert.equal(response.json.error, 'holdfast_membership_required')
  }
  for (const route of ['/api/quests/manage', '/api/guild/members/manage/all', '/api/admin/audit', '/api/g/holdfast/quests/manage']) {
    const response = await request(route, { persona: ironpine.officer })
    assert.equal(response.status, 403, `iron officer GET ${route}`)
  }

  // Each guild sees only its own roster, billets and ladder.
  const ironRoster = await successful(request, `${IRONPINE}/members`, { persona: ironpine.officer })
  assert.deepEqual(ironRoster.members.map((member) => member.id).sort(), Object.values(ironpine).sort())
  assert.deepEqual(Object.fromEntries(ironRoster.members.map((member) => [member.id, member.rank])), { 'iron-owner': 'Guild Master', 'iron-officer': 'Officer', 'iron-member': 'Member' })
  const holdfastRoster = await successful(request, '/api/guild/members', { persona: 'officer' })
  assert.deepEqual(holdfastRoster.members.map((member) => member.id).sort(), ['e2e-commander', 'e2e-member', 'e2e-officer'])
  assert.ok((await successful(request, `${IRONPINE}/billets`, { persona: ironpine.member })).billets.every((billet) => billet.id !== 'billet-steward'))
  assert.ok((await successful(request, '/api/guild/billets', { persona: 'member' })).billets.every((billet) => billet.id !== ironBillet.id))
  const ironAuthority = await successful(request, `${IRONPINE}/authority`, { persona: ironpine.member })
  assert.deepEqual(ironAuthority.ranks.map((rank) => rank.name), DEFAULT_GUILD_RANKS.map((rank) => rank.name))
  assert.ok(!ironAuthority.capabilities.some((capability) => capability.id === 'site.admin'))
  const holdfastAuthority = await successful(request, '/api/guild/authority', { persona: 'member' })
  assert.equal(holdfastAuthority.ranks.at(-1).name, 'Commander')
  assert.ok(holdfastAuthority.capabilities.some((capability) => capability.id === 'site.admin'))

  // A guild's audit history only holds its own events.
  const ironAudit = await successful(request, `${IRONPINE}/audit`, { persona: ironpine.officer })
  assert.ok(Array.isArray(ironAudit.events))

  assert.equal((await request('/api/g/no-such-guild/quests/member', { persona: 'member' })).status, 404)
}))

test('another guild\'s officer cannot change a guild\'s quests, members, billets or authority', () => withHttpApp(async ({ request }) => {
  await foundIronpine(request)
  const ironBillet = (await successful(request, `${IRONPINE}/billets`, { persona: ironpine.owner })).billets[0]
  const document = await questFixture()
  const before = persistentState()

  // Holdfast's officer and owner against Ironpine.
  for (const persona of ['officer', 'owner']) {
    for (const [method, route, body] of [
      ['PUT', '/quests/manage', { ...document, revision: 0 }],
      ['PUT', '/quests/manage/economy', { revision: 0, rewardPolicy: 'Hijacked' }],
      ['POST', '/quests/member/signup', objective],
      ['POST', '/quests/member/request-completion', objective],
      ['POST', '/quests/manage/review-completion', { ...objective, decision: 'approved' }],
      ['POST', '/quests/manage/complete-objective', { ...objective, revision: 0 }],
      ['PATCH', `/members/manage/${ironpine.member}/rank`, { rank: 'Veteran' }],
      ['PUT', `/members/manage/${ironpine.member}/billets/${ironBillet.id}`, undefined],
      ['DELETE', `/members/manage/${ironpine.member}/billets/${ironBillet.id}`, undefined],
      ['PATCH', '/members/me', { profile: { bio: 'Hijacked' } }],
      ['POST', '/billets', { name: 'Infiltrator', responsibility: '' }],
      ['PATCH', `/billets/${ironBillet.id}`, { name: 'Renamed', responsibility: '' }],
      ['DELETE', `/billets/${ironBillet.id}`, undefined],
      ['PATCH', '/authority/ranks/Member', { permissions: ['quests.create'], questScope: 'own' }],
      ['PATCH', `/authority/billets/${ironBillet.id}`, { permissions: [], questScope: 'own' }],
    ]) {
      const response = await request(`${IRONPINE}${route}`, { persona, method, body })
      assert.equal(response.status, 403, `${persona} ${method} ${route}: ${response.text}`)
    }
  }

  // Ironpine's owner (full authority in Ironpine) against Holdfast.
  for (const [method, route, body] of [
    ['PUT', '/api/quests/manage', { ...document, revision: 0 }],
    ['POST', '/api/quests/member/signup', objective],
    ['PATCH', '/api/guild/members/manage/e2e-member/rank', { rank: 'Commander' }],
    ['PUT', '/api/guild/members/manage/e2e-member/billets/billet-steward', undefined],
    ['POST', '/api/guild/billets', { name: 'Infiltrator', responsibility: '' }],
    ['DELETE', '/api/guild/billets/billet-raid-leader', undefined],
    ['PATCH', '/api/guild/authority/ranks/Private', { permissions: [], questScope: 'own' }],
    ['PATCH', '/api/g/holdfast/members/manage/e2e-member/rank', { rank: 'Commander' }],
  ]) {
    const response = await request(route, { persona: ironpine.owner, method, body })
    assert.equal(response.status, 403, `iron owner ${method} ${route}: ${response.text}`)
  }

  // ...and naming Holdfast's members, billets and ranks from inside Ironpine
  // finds nothing to change.
  for (const [method, route, body, error] of [
    ['PATCH', '/members/manage/e2e-member/rank', { rank: 'Officer' }, 'member_not_found'],
    ['PUT', `/members/manage/${ironpine.member}/billets/billet-steward`, undefined, 'billet_not_found'],
    ['PUT', '/members/manage/e2e-member/billets/' + ironBillet.id, undefined, 'member_not_found'],
    ['PATCH', '/billets/billet-steward', { name: 'Stolen', responsibility: '' }, 'billet_not_found'],
    ['DELETE', '/billets/billet-steward', undefined, 'billet_not_found'],
    ['PATCH', '/authority/billets/billet-steward', { permissions: [], questScope: 'own' }, 'authority_scope_not_found'],
    ['PATCH', '/authority/ranks/Commander', { permissions: [], questScope: 'own' }, 'authority_scope_not_found'],
  ]) {
    const response = await request(`${IRONPINE}${route}`, { persona: ironpine.owner, method, body })
    assert.equal(response.status, 404, `iron owner ${method} ${route}: ${response.text}`)
    assert.equal(response.json.error, error)
  }

  assert.deepEqual(persistentState(), before)
}))

test('guilds keep separate quest boards, ledgers and ranks even when their ids collide', () => withHttpApp(async ({ request }) => {
  const guildId = await foundIronpine(request)
  const holdfastBefore = await successful(request, '/api/quests/manage', { persona: 'owner' })

  // Ironpine's officer publishes a board with exactly Holdfast's quest and
  // objective ids.
  const document = await questFixture()
  const saved = await successful(request, `${IRONPINE}/quests/manage`, { method: 'PUT', persona: ironpine.officer, body: { ...document, revision: 0 } })
  assert.equal(saved.revision, 1)
  assert.deepEqual(await successful(request, '/api/quests/manage', { persona: 'owner' }), holdfastBefore)
  assert.deepEqual(await successful(request, '/api/g/holdfast/quests/manage', { persona: 'owner' }), holdfastBefore)

  // Both guilds pay the same objective id to their own member.
  async function payOut(prefix, people) {
    const workspace = () => successful(request, `${prefix}/quests/manage`, { persona: people.officer })
    await successful(request, `${prefix}/quests/member/signup`, { method: 'POST', persona: people.member, body: objective }, 201)
    await successful(request, `${prefix}/quests/member/request-completion`, { method: 'POST', persona: people.member, body: { ...objective, note: 'Done.' } }, 201)
    await successful(request, `${prefix}/quests/manage/review-completion`, { method: 'POST', persona: people.officer, body: { ...objective, decision: 'approved' } })
    await successful(request, `${prefix}/quests/manage/approve-reward`, { method: 'POST', persona: people.officer, body: { ...objective, revision: (await workspace()).revision } })
    await successful(request, `${prefix}/quests/manage/complete-objective`, { method: 'POST', persona: people.officer, body: { ...objective, revision: (await workspace()).revision } })
  }
  await payOut('/api', { member: 'member', officer: 'officer' })
  await payOut(IRONPINE, ironpine)

  const reward = { rep: 100, marks: 5, completedObjectives: 1 }
  assert.deepEqual([...(await readContributionTotals(HOLDFAST_GUILD_ID)).entries()], [['e2e-member', reward]])
  assert.deepEqual([...(await readContributionTotals(guildId)).entries()], [['iron-member', reward]])
  const ledgerIds = withGuildDatabase((db) => db.prepare('SELECT guild_id, id FROM contribution_transactions ORDER BY guild_id').all().map((row) => ({ ...row })))
  assert.deepEqual(ledgerIds, [
    { guild_id: HOLDFAST_GUILD_ID, id: 'objective:e2e-linen:member:e2e-member' },
    { guild_id: guildId, id: 'objective:e2e-linen:member:iron-member' },
  ].sort((a, b) => a.guild_id.localeCompare(b.guild_id)))
  const ironProfile = await successful(request, `${IRONPINE}/members/${ironpine.member}`, { persona: ironpine.officer })
  assert.equal(ironProfile.member.activity.length, 1)
  assert.equal(ironProfile.member.repProgression.mode, 'lifetime')

  // Each reward notification belongs to the guild that paid it.
  const notifications = withGuildDatabase((db) => db.prepare("SELECT guild_id, recipient_member_id FROM notifications WHERE event_type = 'reward_issued' ORDER BY recipient_member_id").all().map((row) => ({ ...row })))
  assert.deepEqual(notifications, [
    { guild_id: HOLDFAST_GUILD_ID, recipient_member_id: 'e2e-member' },
    { guild_id: guildId, recipient_member_id: 'iron-member' },
  ])

  // Ironpine's ladder is its own: its officer promotes within their ceiling,
  // and Holdfast's rank names mean nothing there.
  const promoted = await successful(request, `${IRONPINE}/members/manage/${ironpine.member}/rank`, { method: 'PATCH', persona: ironpine.officer, body: { rank: 'Veteran' } })
  assert.equal(promoted.member.rank, 'Veteran')
  assert.equal(promoted.discordSync.status, 'not-applicable')
  assert.equal((await request(`${IRONPINE}/members/manage/${ironpine.member}/rank`, { method: 'PATCH', persona: ironpine.officer, body: { rank: 'Officer' } })).status, 403)
  assert.equal((await request(`${IRONPINE}/members/manage/${ironpine.member}/rank`, { method: 'PATCH', persona: ironpine.owner, body: { rank: 'Sergeant' } })).status, 403)
  const ranks = (await successful(request, `${IRONPINE}/members/manage/all`, { persona: ironpine.officer })).ranks
  assert.deepEqual(ranks, DEFAULT_GUILD_RANKS.map((rank) => rank.name))
  assert.equal((await successful(request, '/api/guild/members/e2e-member', { persona: 'member' })).member.rank, 'Private')
}))

test('a registered guild starts with its own ladder and billets, and authority never crosses guilds', () => withHttpApp(async ({ request }) => {
  const guildId = await foundIronpine(request)

  assert.deepEqual(readRankLadder(guildId).names, DEFAULT_GUILD_RANKS.map((rank) => rank.name))
  assert.equal(readRankLadder(HOLDFAST_GUILD_ID).names.at(-1), 'Commander')
  const billets = (await successful(request, `${IRONPINE}/billets`, { persona: ironpine.member })).billets
  assert.deepEqual(billets.map((billet) => billet.name), ['Quartermaster', 'Raid Leader'])
  assert.ok(billets.every((billet) => !billet.discordManaged && !billet.discordRoleId))

  const owner = resolveMemberAuthority(guildId, ironpine.owner)
  assert.equal(owner.isOwner, true)
  assert.equal(owner.maxManagedRank, 'Guild Master')
  assert.ok(!owner.permissions.includes('site.admin'))
  assert.ok(!owner.permissions.includes('discord.manage'))
  const officer = resolveMemberAuthority(guildId, ironpine.officer)
  assert.equal(officer.memberRank, 'Officer')
  assert.equal(officer.maxManagedRank, 'Veteran')
  assert.ok(officer.permissions.includes('rewards.issue'))

  assert.deepEqual(resolveMemberAuthority(HOLDFAST_GUILD_ID, ironpine.owner).permissions, [])
  assert.deepEqual(resolveMemberAuthority(HOLDFAST_GUILD_ID, ironpine.officer).permissions, [])
  assert.deepEqual(resolveMemberAuthority(guildId, 'e2e-commander').permissions, [])
  assert.deepEqual(resolveMemberAuthority(guildId, 'e2e-officer').permissions, [])

  const me = await successful(request, `${IRONPINE}/me`, { persona: ironpine.officer })
  assert.equal(me.guild.slug, 'ironpine-wardens')
  assert.equal(me.member, true)
  assert.equal(me.rank, 'Officer')
  const outsider = await successful(request, `${IRONPINE}/me`, { persona: 'officer' })
  assert.equal(outsider.member, false)
  assert.deepEqual(outsider.permissions, [])

  // Site-wide admin stays Holdfast's even for another guild's owner.
  assert.equal((await request('/api/health/data', { persona: ironpine.owner })).status, 403)
}))

test('live updates from one guild reach only that guild', () => {
  resetLiveUpdatesForTests()
  const events = classifyLiveMutation({ method: 'POST', originalUrl: '/api/g/ironpine-wardens/quests/member/signup', guild: { id: 'guild-ironpine' } })
  assert.deepEqual(events.map((event) => event.topics), [['quests', 'notifications']])
  assert.deepEqual(events.map((event) => event.guildId), ['guild-ironpine'])
  assert.deepEqual(classifyLiveMutation({ method: 'PATCH', originalUrl: '/api/g/ironpine-wardens/members/manage/x/rank', guild: { id: 'guild-ironpine' } }).map((event) => event.source), ['members'])
  const holdfastAlias = classifyLiveMutation({ method: 'POST', originalUrl: '/api/g/holdfast/quests/member/signup', guild: { id: HOLDFAST_GUILD_ID } })
  assert.deepEqual(holdfastAlias.map((event) => event.topics), [['quests', 'notifications'], ['audit']])

  const received = { holdfast: [], ironpine: [] }
  const unsubscribe = [
    subscribeLiveUpdates({ memberId: 'h', guildIds: [HOLDFAST_GUILD_ID], send: (event) => received.holdfast.push(event) }),
    subscribeLiveUpdates({ memberId: 'i', guildIds: ['guild-ironpine'], send: (event) => received.ironpine.push(event) }),
  ]
  for (const event of events) publishLiveUpdate(event)
  publishLiveUpdate({ topics: ['quests'], source: 'quests' })
  unsubscribe.forEach((stop) => stop())
  assert.equal(received.holdfast.length, 1)
  assert.equal(received.ironpine.length, 2)
  resetLiveUpdatesForTests()
})
