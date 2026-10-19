// The site's URL map. Guildweaver's own pages sit at the top level; every
// other first segment is a guild's slug, with that guild's pages under it:
//
//   /                      guild directory
//   /register              register a guild
//   /items, /guildweaver, /privacy, /admin, /join
//   /:slug                 a guild's home
//   /:slug/quests, /:slug/members, /:slug/members/:id, /:slug/charter,
//   /:slug/ranks, /:slug/intelligence, /:slug/about (its directory listing)
//
// The backend keeps the same old-path redirects (backend/src/Production/
// legacyRedirects.js) and reserves every top-level segment below so no guild
// can take its slug (backend/src/Guild/Directory/guildDirectoryModel.js).

export const HOLDFAST_SLUG = 'holdfast'

export const GUILD_SECTIONS = ['quests', 'members', 'charter', 'ranks', 'intelligence', 'about']

// First path segments that are not guild slugs: the platform's pages, the
// server's own paths, old paths that now redirect, and public asset folders.
export const RESERVED_TOP_LEVEL_SEGMENTS = [
  'register', 'items', 'guildweaver', 'privacy', 'admin', 'join',
  'api', 'auth', 'assets',
  'guilds', 'guildos', ...GUILD_SECTIONS,
  'armory-art', 'inventory-art', 'profession-art', 'talent-art', 'wow-art',
]

// Same shape the backend accepts (guildDirectoryModel.js validSlug).
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/

// Old single-guild paths, which were all Holdfast's.
const LEGACY_HOLDFAST_SECTIONS = ['quests', 'members', 'charter', 'ranks', 'intelligence']

export function normalizePathname(pathname) {
  return pathname.replace(/\/+$/, '') || '/'
}

function decodedSegment(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function isGuildSlug(value) {
  return SLUG_PATTERN.test(value) && !RESERVED_TOP_LEVEL_SEGMENTS.includes(value)
}

// A guild page's path: guildHref('holdfast', '/quests') is '/holdfast/quests'.
export function guildHref(slug, path = '') {
  return `/${encodeURIComponent(slug || HOLDFAST_SLUG)}${path}`
}

// A guild's name before its listing loads: 'iron-vanguard' is 'Iron Vanguard'.
export function guildNameFromSlug(slug) {
  if (slug === HOLDFAST_SLUG) return 'Holdfast'
  return slug.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

// Where an old path lives now, or null when it is not an old path. The query
// string and hash are the caller's to carry over.
export function legacyRedirectPathname(pathname) {
  const normalized = normalizePathname(pathname)
  if (normalized === '/guildos' || normalized === '/guilds') return '/'
  const guild = normalized.match(/^\/guilds\/([^/]+)$/)
  if (guild) return `/${guild[1]}`
  const [, section, rest = ''] = normalized.match(/^\/([^/]+)(\/.*)?$/) || []
  if (LEGACY_HOLDFAST_SECTIONS.includes(section)) {
    // Only paths that were real pages: /members/:id is the one with a tail.
    if (!rest || (section === 'members' && /^\/[^/]+$/.test(rest))) {
      return `${guildHref(HOLDFAST_SLUG)}/${section}${rest}`
    }
  }
  return null
}

// What a pathname shows: { name, ...params }, or null for not found.
//   platform pages: { name: 'directory' | 'register' | 'items' | ... }
//   guild pages:    { name: 'guild', slug, section, memberId? }
export function matchRoute(pathname) {
  const normalized = normalizePathname(pathname)
  if (normalized === '/') return { name: 'directory' }

  const platform = {
    '/register': 'register',
    '/join': 'join',
    '/guildweaver': 'guildweaver',
    '/guildweaver/connect': 'guildweaver-connect',
    '/privacy': 'privacy',
    '/admin': 'admin',
    '/admin/guildweaver': 'admin-guildweaver',
  }[normalized]
  if (platform) return { name: platform }

  const item = normalized.match(/^\/items(?:\/(\d+))?$/)
  if (item) return { name: 'items', itemId: item[1] || null }

  const segments = normalized.slice(1).split('/')
  const slug = segments[0]
  if (!isGuildSlug(slug)) return null

  if (segments.length === 1) return { name: 'guild', slug, section: 'home' }
  const section = segments[1]
  if (!GUILD_SECTIONS.includes(section)) return null
  if (segments.length === 2) return { name: 'guild', slug, section }
  if (section === 'members' && segments.length === 3 && segments[2]) {
    return { name: 'guild', slug, section: 'member', memberId: decodedSegment(segments[2]) }
  }
  return null
}

// The guild whose pages a pathname is in, or null on platform pages.
export function guildSlugFromPathname(pathname) {
  const route = matchRoute(pathname)
  return route?.name === 'guild' ? route.slug : null
}
