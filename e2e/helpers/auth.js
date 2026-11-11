import crypto from 'node:crypto'

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173'
const sessionSecret =
  process.env.SESSION_SECRET ||
  'holdfast-e2e-session-secret-change-me-1234567890'

export const personas = {
  // Discord users with no guild: solo Guildweaver players. Not in Holdfast's
  // server (homeServer: false), so the site stores them without a guild.
  player: {
    id: 'e2e-player',
    username: 'e2e-player',
    globalName: 'Pip Player',
    guildNickname: null,
    avatarUrl: null,
    guildJoinedAt: null,
    homeServer: false,
  },
  trader: {
    id: 'e2e-trader',
    username: 'e2e-trader',
    globalName: 'Tess Trader',
    guildNickname: null,
    avatarUrl: null,
    guildJoinedAt: null,
    homeServer: false,
  },
  shopper: {
    id: 'e2e-shopper',
    username: 'e2e-shopper',
    globalName: 'Sam Shopper',
    guildNickname: null,
    avatarUrl: null,
    guildJoinedAt: null,
    homeServer: false,
  },
  rival: {
    id: 'e2e-rival',
    username: 'e2e-rival',
    globalName: 'Rex Rival',
    guildNickname: null,
    avatarUrl: null,
    guildJoinedAt: null,
    homeServer: false,
  },
  member: {
    id: 'e2e-member',
    username: 'e2e-member',
    globalName: 'Mira Member',
    guildNickname: 'Mira Member',
    avatarUrl: null,
    guildJoinedAt: '2026-01-01T00:00:00.000Z',
  },
  officer: {
    id: 'e2e-officer',
    username: 'e2e-officer',
    globalName: 'Owen Officer',
    guildNickname: 'Owen Officer',
    avatarUrl: null,
    guildJoinedAt: '2026-01-01T00:00:00.000Z',
  },
  commander: {
    id: 'e2e-commander',
    username: 'e2e-commander',
    globalName: 'Casey Commander',
    guildNickname: 'Casey Commander',
    avatarUrl: null,
    guildJoinedAt: '2026-01-01T00:00:00.000Z',
  },
}

function encodeSession({ homeServer, ...user }) {
  const session = {
    user,
    permissions: [],
    ...(homeServer === false ? { homeServer: false } : {}),
    verifiedAt: Date.now(),
    exp: Date.now() + 60 * 60 * 1000,
  }
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url')
  const signature = crypto
    .createHmac('sha256', sessionSecret)
    .update(payload)
    .digest('base64url')

  return `${payload}.${signature}`
}

export async function authenticate(context, personaName) {
  const user = personas[personaName]

  if (!user) {
    throw new Error(`Unknown E2E persona: ${personaName}`)
  }

  await context.addCookies([
    {
      name: 'guild_session',
      value: encodeSession(user),
      url: baseURL,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])

  return user
}
