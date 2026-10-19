import { guildHref } from './routing.js'

// The site has two navbars (Home/Navbar): the platform's, on the directory,
// item catalog and addon pages, and a guild's, on every page under /:slug.

export const platformNavigationLinks = [
  { label: 'Find guilds', href: '/' },
  { label: 'Item catalog', href: '/items' },
  { label: 'Addon', href: '/guildweaver' },
]

export const signInNavigationLabel = 'Sign In'

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

// The account menu: the player's profile and guild. Profiles live in the
// player's own guild (Holdfast's until other guilds have rosters).
export function accountMenuLinks(memberGuild) {
  return [
    { label: 'My Profile', href: `${guildHref(memberGuild?.slug)}/members/me` },
    ...(memberGuild?.slug ? [{ label: memberGuild.name || 'My guild', href: guildHref(memberGuild.slug) }] : []),
  ]
}

// Whether a navbar link is the page showing. Section links stay lit on their
// sub-pages (a member profile lights Members); a guild's Home and the
// directory only on themselves.
export function isActiveLink(pathname, link) {
  if (link.exact || link.href === '/') return pathname === link.href
  return pathname === link.href || pathname.startsWith(`${link.href}/`)
}
