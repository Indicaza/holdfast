// Where a successful sign-in lands. Signing in from a page the player was
// using (a dashboard view, the bridge's pairing page, an item) returns there.
// Signing in from the front page or the download page goes to My Overview.

const OVERVIEW = '/dashboard'
const ENTRY_PAGES = new Set(['/', '/download', '/guildweaver', '/privacy'])

export function signInReturnTo(locationLike = globalThis.location) {
  const url = new URL(locationLike?.href || OVERVIEW, 'https://guildweaver.local')
  url.searchParams.delete('auth')
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  if (ENTRY_PAGES.has(pathname)) return OVERVIEW
  return `${pathname}${url.search}${url.hash}`
}
