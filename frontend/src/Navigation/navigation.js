// Client-side navigation. Same-origin links change the page without a reload,
// so the app (session, navbar, live connection, cached data) stays mounted and
// only the page area changes. The app follows the location in a transition
// (see App), so the current page stays on screen until the next one's code
// has loaded.

const listeners = new Set()

function emit() {
  for (const listener of listeners) listener()
}

// Calls listener after every navigation (links, Back/Forward). Returns the
// unsubscribe.
export function subscribeLocation(listener) {
  listeners.add(listener)
  window.addEventListener('popstate', emit)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) window.removeEventListener('popstate', emit)
  }
}

export function navigate(to, { replace = false } = {}) {
  const url = new URL(to, window.location.href)
  if (url.href === window.location.href) return
  const samePage = url.pathname === window.location.pathname && url.search === window.location.search
  window.history[replace ? 'replaceState' : 'pushState'](null, '', url)
  // Existing listeners (hash views, modals) follow popstate.
  window.dispatchEvent(new PopStateEvent('popstate'))
  if (!samePage && !url.hash) window.scrollTo(0, 0)
}

// Paths the server answers itself (API, downloads, OAuth), never the app.
const SERVER_PATHS = /^\/(api|guildweaver\/download|auth)(\/|$)/

function internalLink(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
  if (!anchor || anchor.target && anchor.target !== '_self' || anchor.hasAttribute('download') || anchor.dataset.reload !== undefined) return null
  const url = new URL(anchor.href, window.location.href)
  if (url.origin !== window.location.origin || SERVER_PATHS.test(url.pathname)) return null
  // In-page anchors keep the browser's own scrolling and hashchange.
  if (url.hash && url.pathname === window.location.pathname && url.search === window.location.search) return null
  return url
}

// Opens an href the way a link click would: app pages without a reload,
// anything else (other sites, server paths) as a normal page load.
export function followLink(href, { replace = false } = {}) {
  const url = new URL(href, window.location.href)
  if (url.origin !== window.location.origin || SERVER_PATHS.test(url.pathname)) {
    window.location[replace ? 'replace' : 'assign'](url.href)
    return
  }
  navigate(url.href, { replace })
}

// Routes every same-origin link click through navigate(). Returns the cleanup.
export function interceptLinkClicks() {
  const onClick = (event) => {
    const url = internalLink(event)
    if (!url) return
    event.preventDefault()
    navigate(url.href)
  }
  document.addEventListener('click', onClick)
  return () => document.removeEventListener('click', onClick)
}
