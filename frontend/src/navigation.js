import { guildHref } from './routing.js'

// The site has two navbars (Home/Navbar): the platform's, on Guildweaver's
// own pages, and a guild's, on every page under /:slug (only while guild
// features are on).

// The solo site: the player's dashboard and the download. Everything else a
// player needs lives in the dashboard or the avatar menu.
export const soloNavigationLinks = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Download', href: '/download' },
]

// The platform navbar while guild features are on.
export const platformNavigationLinks = [
  { label: 'Download', href: '/download' },
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Find guilds', href: '/' },
  { label: 'Item catalog', href: '/items' },
]

export function primaryNavigationLinks(guildFeatures) {
  return guildFeatures ? platformNavigationLinks : soloNavigationLinks
}

export const signInNavigationLabel = 'Sign in with Discord'

// A guild's pages. Quests, members and intelligence are for its members, so
// a signed-out visitor sees the public pages only.
export function guildNavigationLinks(slug, authenticated) {
  const base = guildHref(slug)
  return [
    { label: 'Home', href: base, exact: true },
    ...(authenticated ? [{ label: 'Quests', href: `${base}/quests` }, { label: 'Members', href: `${base}/members` }] : []),
    { label: 'Charter', href: `${base}/charter` },
    { label: 'Ranks', href: `${base}/ranks` },
    ...(authenticated ? [{ label: 'Intelligence', href: `${base}/intelligence` }] : []),
  ]
}

// "My guild →" on platform pages, for a player signed in to a guild.
export function myGuildLink(memberGuild) {
  return memberGuild?.slug ? { label: 'My guild', href: guildHref(memberGuild.slug) } : null
}

// The avatar menu: the player's own views. My Overview is the dashboard.
export const playerMenuLinks = [
  { label: 'My Overview', href: '/dashboard', exact: true },
  { label: 'My Characters', href: '/dashboard/characters' },
  { label: 'My Devices & Sync', href: '/dashboard/sync' },
  { label: 'Account & Privacy', href: '/account' },
]

// The avatar menu. With guild features on it also links the player's profile
// and guild (profiles live in the player's own guild). Administrative tools
// appear only for administrators, after the player's own links.
export function accountMenuLinks(memberGuild, { guildFeatures = false, admin = false } = {}) {
  return [
    ...playerMenuLinks,
    ...(guildFeatures && memberGuild?.slug ? [{ label: 'My Profile', href: `${guildHref(memberGuild.slug)}/members/me` }] : []),
    ...(guildFeatures && memberGuild?.slug ? [{ label: memberGuild.name || 'My guild', href: guildHref(memberGuild.slug) }] : []),
    ...(admin ? [{ label: 'Sync console (admin)', href: '/admin/guildweaver' }] : []),
  ]
}

// The name a player goes by on Guildweaver: their Discord display name.
// A guild nickname belongs to a guild's pages, not the solo site.
export function playerDisplayName(user, { guildFeatures = false } = {}) {
  return (guildFeatures ? user?.guildNickname : null) || user?.globalName || user?.username || 'Player'
}

// Whether a navbar link is the page showing. Section links stay lit on their
// sub-pages (a member profile lights Members); a guild's Home, the directory
// and exact links only on themselves.
export function isActiveLink(pathname, link) {
  if (link.exact || link.href === '/') return pathname === link.href
  return pathname === link.href || pathname.startsWith(`${link.href}/`)
}
