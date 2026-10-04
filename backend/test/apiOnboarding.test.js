import assert from 'node:assert/strict'
import test from 'node:test'
import { withHttpApp } from '../testSupport/httpHarness.js'

test('Discord callback creates a persisted member and a real usable production session', async () => {
  const userId = '323456789012345678'
  const guildId = '223456789012345678'
  let joined = false
  const fetchImpl = async (value, options = {}) => {
    const route = new URL(value).pathname
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (route.endsWith('/oauth2/token')) return json({ access_token: 'fake-oauth-token' })
    if (route.endsWith('/users/@me')) return json({ id: userId, username: 'rook', global_name: 'Rook' })
    if (route.endsWith(`/guilds/${guildId}/members/${userId}`) && options.method === 'PUT') {
      joined = true
      return new Response(null, { status: 204 })
    }
    if (route.endsWith(`/users/@me/guilds/${guildId}/member`) || route.endsWith(`/guilds/${guildId}/members/${userId}`)) {
      return joined ? json({ roles: [], nick: 'New Rook', joined_at: '2026-10-01T00:00:00.000Z' }) : json({ message: 'Unknown Member' }, 404)
    }
    throw new Error(`Unexpected fake Discord endpoint: ${route}`)
  }
  await withHttpApp(async ({ request }) => {
    const returnTo = '/quests?signupQuest=e2e-supply-run&signupObjective=e2e-patrol'
    const started = await request(`/api/auth/discord?${new URLSearchParams({ mode: 'recruit', returnTo })}`)
    assert.equal(started.status, 302)
    const state = new URL(started.headers.get('location')).searchParams.get('state')
    const stateCookie = started.headers.getSetCookie().find((value) => value.startsWith('guild_oauth_state=')).split(';', 1)[0]
    const callback = await request(`/api/auth/discord/callback?${new URLSearchParams({ state, code: 'fake-code' })}`, { rawCookie: stateCookie })
    assert.equal(callback.status, 302, callback.text)
    const destination = new URL(callback.headers.get('location'))
    assert.equal(destination.pathname, '/join')
    assert.equal(destination.searchParams.get('returnTo'), returnTo)
    const sessionHeader = callback.headers.getSetCookie().find((value) => value.startsWith('guild_session='))
    assert.match(sessionHeader, /HttpOnly/)
    assert.match(sessionHeader, /Secure/)
    assert.match(sessionHeader, /SameSite=Lax/)
    const rawCookie = sessionHeader.split(';', 1)[0]
    const session = await request('/api/me', { rawCookie })
    assert.equal(session.status, 200)
    assert.equal(session.json.authenticated, true)
    assert.equal(session.json.user.id, userId)
    assert.equal(session.json.authority.isOwner, false)
    const profile = await request('/api/guild/members/me', { rawCookie })
    assert.equal(profile.status, 200)
    assert.equal(profile.json.member.id, userId)
    assert.equal(profile.json.member.displayName, 'New Rook')
    const signup = await request('/api/quests/member/signup', { rawCookie, method: 'POST', body: { questId: 'e2e-supply-run', objectiveId: 'e2e-patrol' } })
    assert.equal(signup.status, 201, signup.text)
  }, { discordAuthOptions: { fetchImpl, env: { FRONTEND_URL: 'https://holdfast.example', SESSION_SECRET: 'http-test-session-secret-at-least-32-bytes', DISCORD_CLIENT_ID: '123456789012345678', DISCORD_CLIENT_SECRET: 'fake-client-secret', DISCORD_GUILD_ID: guildId, DISCORD_BOT_TOKEN: 'fake-bot-token' } } })
})
