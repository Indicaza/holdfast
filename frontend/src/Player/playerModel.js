// The player dashboard's pure logic: its URLs, the remembered server, and
// what to say about sync health. Components live beside this file.

export const DASHBOARD_VIEWS = Object.freeze([
  { id: 'overview', group: 'explore', label: 'Home', description: 'Search drops, sources and your characters', icon: 'overview', path: '/dashboard' },
  { id: 'farming', group: 'explore', label: 'Drop rates', description: 'Every node, pool and creature, with what it drops', icon: 'farming', path: '/dashboard/farming' },
  { id: 'characters', group: 'you', label: 'Characters', description: 'Armory, gear, talents and bags', icon: 'characters', path: '/dashboard/characters' },
  { id: 'professions', group: 'you', label: 'Professions', description: 'Skills, and which character can craft it', icon: 'craft', path: '/dashboard/professions' },
  { id: 'gathering', group: 'you', label: 'My gathering', description: 'What your characters gathered, fished and looted', icon: 'gathering', path: '/dashboard/gathering' },
  { id: 'sync', group: 'you', label: 'Sync', description: 'Your devices and upload status', icon: 'guildweaver', path: '/dashboard/sync' },
])

export const DASHBOARD_GROUPS = Object.freeze([
  { id: 'explore', label: 'Explore' },
  { id: 'you', label: 'You' },
])

const SERVER_PARAM = 'server'
const STORAGE_PREFIX = 'guildweaver:server:'

// A dashboard section's URL, keeping the chosen server ('' = all servers).
export function dashboardHref(section = 'overview', server = '') {
  const view = DASHBOARD_VIEWS.find((entry) => entry.id === section) || DASHBOARD_VIEWS[0]
  return server ? `${view.path}?${SERVER_PARAM}=${encodeURIComponent(server)}` : view.path
}

export function readServerParam(search = globalThis.location?.search || '') {
  return new URLSearchParams(search).get(SERVER_PARAM) || ''
}

// The server to show: the URL's when it names one of the player's servers,
// otherwise the one this player last chose on this browser, otherwise all.
// A server the player does not have (an old link, or someone else's) never
// shows an empty page: it falls back the same way.
export function resolveServer({ requested = '', stored = '', servers = [] } = {}) {
  const known = new Set(servers.map((server) => server.key))
  if (requested && known.has(requested)) return requested
  if (stored && known.has(stored)) return stored
  return ''
}

// Remembered per account and browser, so another account on the same
// browser starts from all servers.
export function storedServer(userId, storage = globalThis.localStorage) {
  if (!userId) return ''
  try {
    return storage?.getItem(`${STORAGE_PREFIX}${userId}`) || ''
  } catch {
    return ''
  }
}

export function storeServer(userId, server, storage = globalThis.localStorage) {
  if (!userId) return
  try {
    if (server) storage?.setItem(`${STORAGE_PREFIX}${userId}`, server)
    else storage?.removeItem(`${STORAGE_PREFIX}${userId}`)
  } catch {
    // Remembering the server is a convenience.
  }
}

// The same URL with the server param set or removed.
export function withServer(href, server) {
  const url = new URL(href, 'https://guildweaver.local')
  if (server) url.searchParams.set(SERVER_PARAM, server)
  else url.searchParams.delete(SERVER_PARAM)
  return `${url.pathname}${url.search}${url.hash}`
}

export function serverLabel(servers, key) {
  if (!key) return 'All servers'
  return servers.find((server) => server.key === key)?.label || 'Unknown server'
}

// An API URL for one of the player's resources on the chosen server.
export function playerApiUrl(path, server = '', params = {}) {
  const search = new URLSearchParams()
  if (server) search.set(SERVER_PARAM, server)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value)
  }
  const query = search.toString()
  return `/api/player/${path}${query ? `?${query}` : ''}`
}

// A character's server key, the same as the server computes it
// (backend/src/Player/playerServers.js): region and realm, case aside.
export function characterServerKey(character = {}) {
  const realm = String(character.realm || '').trim().toLowerCase()
  return realm ? `${String(character.region || '').trim().toLowerCase()}:${realm}` : 'unknown'
}

export function onServerKey(character, server) {
  return !server || characterServerKey(character) === server
}

// Characters grouped under their servers, in the servers' order.
export function charactersByServer(characters = [], servers = []) {
  return servers
    .map((server) => ({ server, characters: characters.filter((character) => characterServerKey(character) === server.key) }))
    .filter((group) => group.characters.length)
}

// The first-run checklist, from the server's sync state.
export function setupSteps(sync = {}) {
  const connected = sync.connectedDevices > 0
  const uploaded = Boolean(sync.lastUploadAt || sync.lastCharacterAt)
  return [
    { id: 'install', label: 'Install Guildweaver', done: connected || uploaded },
    { id: 'connect', label: 'Connect this computer', done: connected },
    { id: 'sync', label: 'Play and receive your first sync', done: sync.state === 'synced' || sync.state === 'stale' },
  ]
}

// What the dashboard says about sync health, and what the player can do.
export function syncStatusCopy(sync = {}) {
  switch (sync.state) {
    case 'no_device':
      return sync.disconnectedDevices
        ? { tone: 'warning', title: 'No computer is connected.', body: 'Your devices were disconnected. Open Guildweaver on your computer and connect it again.', action: { label: 'Download Guildweaver', href: '/download' } }
        : { tone: 'info', title: 'Connect a computer to start syncing.', body: 'Install Guildweaver, open it, and approve the connection with Discord. No guild needed.', action: { label: 'Download Guildweaver', href: '/download' } }
    case 'waiting_for_data':
      return { tone: 'info', title: 'Connected. Waiting for your first upload.', body: 'Log in to a character, then /reload or log out. WoW only saves addon data at those moments, and Guildweaver uploads it right after.' }
    case 'processing':
      return { tone: 'info', title: 'Upload received.', body: 'Guildweaver has sent data, but no character snapshot yet. Log in to a character and /reload to send one.' }
    case 'stale':
      return { tone: 'warning', title: 'Your last sync is getting old.', body: sync.connectedDevices
        ? 'Nothing new has arrived recently. Make sure Guildweaver is running, then /reload or log out in WoW to save fresh data.'
        : 'No computer is connected anymore, so nothing new can arrive. Connect Guildweaver again to keep syncing.', action: sync.connectedDevices ? { label: 'Check devices', href: '/dashboard/sync' } : { label: 'Download Guildweaver', href: '/download' } }
    case 'synced':
      return { tone: 'ok', title: 'Syncing.', body: 'New data arrives after you /reload or log out in WoW.' }
    default:
      return { tone: 'info', title: 'Checking sync status…', body: '' }
  }
}

export function relativeTime(value, now = Date.now()) {
  if (!value) return 'never'
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return 'unknown'
  const delta = Math.max(0, now - time)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return 'just now'
  if (delta < hour) return `${Math.floor(delta / minute)}m ago`
  if (delta < day) return `${Math.floor(delta / hour)}h ago`
  if (delta < 30 * day) return `${Math.floor(delta / day)}d ago`
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(time))
}

// Live topics that change the player's own data: their syncs, devices and
// characters. The server sends these only to the player they concern.
export const PLAYER_TOPICS = Object.freeze(['player', 'intelligence', 'armory'])
