import { lazy, Suspense, useEffect, useState, useTransition } from 'react'
import Navbar from './Home/Navbar/Navbar.jsx'
import { interceptLinkClicks, subscribeLocation } from './Navigation/navigation.js'
import RouteProgress from './Navigation/RouteProgress.jsx'
import ResourceCacheSync from './Api/ResourceCacheSync.jsx'
import AuthResultModal from './Auth/AuthResultModal.jsx'
import GuildProvider from './Guild/GuildProvider.jsx'
import { useGuild } from './Guild/guildContext.js'
import Home from './Home/Home.jsx'
import PageLoading from './PageLoading/PageLoading.jsx'
import SEO from './SEO/SEO.jsx'
import {
  HOLDFAST_SLUG,
  guildNameFromSlug,
  legacyRedirectPathname,
  matchRoute,
  normalizePathname,
} from './routing.js'

const Admin = lazy(() => import('./Admin/Admin.jsx'))
const GuildweaverAdmin = lazy(() => import('./Admin/GuildweaverAdmin.jsx'))
const Charter = lazy(() => import('./Charter/Charter.jsx'))
const GuildIntelligence = lazy(() => import('./Intelligence/GuildIntelligence.jsx'))
const Guildweaver = lazy(() => import('./Guildweaver/Guildweaver.jsx'))
const GuildweaverConnect = lazy(() => import('./Guildweaver/GuildweaverConnect.jsx'))
const GuildBrowser = lazy(() => import('./Guilds/GuildBrowser.jsx'))
const GuildPage = lazy(() => import('./Guilds/GuildPage.jsx'))
const RegisterGuild = lazy(() => import('./Guilds/RegisterGuild.jsx'))
const Items = lazy(() => import('./Items/Items.jsx'))
const Join = lazy(() => import('./Join/Join.jsx'))
const MemberProfile = lazy(() => import('./Members/MemberProfile.jsx'))
const Members = lazy(() => import('./Members/Members.jsx'))
const NotFound = lazy(() => import('./NotFound/NotFound.jsx'))
const Privacy = lazy(() => import('./Privacy/Privacy.jsx'))
const Quests = lazy(() => import('./Quests/Quests.jsx'))
const Ranks = lazy(() => import('./Ranks/Ranks.jsx'))

const defaultRobots =
  'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'

// Guildweaver's own pages, by matchRoute name.
const platformPages = {
  directory: {
    component: GuildBrowser,
    title: 'Guildweaver | Find a World of Warcraft Guild',
    description: 'Browse World of Warcraft guilds by faction, realm type, play style and schedule. Verified guilds show real activity synced by the Guildweaver addon.',
    robots: defaultRobots,
    home: true,
    props: (url) => ({ queryString: url.search }),
  },
  register: {
    component: RegisterGuild,
    title: 'Register Your Guild | Guildweaver',
    description: 'List your World of Warcraft guild on Guildweaver: be found by faction, realm and play style, show verified activity and recruit through Discord.',
    robots: defaultRobots,
  },
  items: {
    component: Items,
    title: 'Item Catalog | Guildweaver',
    description: 'Community-observed item sources, dungeon loot, and crafting uses.',
    robots: defaultRobots,
    props: (url, route) => ({ itemId: route.itemId, queryString: url.search }),
  },
  guildweaver: {
    component: Guildweaver,
    title: 'Guildweaver Addon | Guildweaver',
    description: 'Download Guildweaver for Windows, macOS, or Linux and inspect the open-source bridge, addon, release pipeline, and data boundaries.',
    robots: defaultRobots,
  },
  'guildweaver-connect': {
    component: GuildweaverConnect,
    title: 'Connect Guildweaver | Guildweaver',
    description: 'Securely connect Guildweaver Bridge to your member profile.',
    robots: 'noindex,nofollow',
    // A focused pairing page opened from the bridge: no site chrome.
    navbar: false,
  },
  privacy: {
    component: Privacy,
    title: 'Privacy | Guildweaver',
    description: 'Guildweaver and Holdfast privacy information.',
    robots: 'noindex,follow',
  },
  admin: {
    component: Admin,
    title: 'Guild Control Room',
    description: 'Guild administrative control room.',
    robots: 'noindex,nofollow',
  },
  'admin-guildweaver': {
    component: GuildweaverAdmin,
    title: 'Guildweaver Sync Console | Guildweaver',
    description: 'Internal Guildweaver sync payload history and diagnostics.',
    robots: 'noindex,nofollow',
  },
}

// A guild's pages, by section. Holdfast keeps its long-standing titles; other
// guilds get theirs from their name.
const guildPages = {
  home: {
    component: Home,
    title: (name, holdfast) => (holdfast ? 'Holdfast | Alliance WoW Forever Guild' : `${name} | Guildweaver`),
    description: (name, holdfast, guild) => (holdfast
      ? 'Holdfast is an Alliance guild for WoW Forever focused on organized PvE, PvP, mentorship, shared prosperity, and a durable long-term community.'
      : guild?.tagline || `${name} on Guildweaver: who they are, what they play and how to join.`),
    robots: defaultRobots,
    organization: true,
  },
  quests: {
    component: Quests,
    title: (name, holdfast) => (holdfast ? 'Holdfast Quests | Alliance WoW Forever Guild' : `Quests | ${name}`),
    description: (name) => `${name} member quest board for guild objectives, assignments, and rewards.`,
    robots: 'noindex,nofollow',
  },
  members: {
    component: Members,
    title: (name) => `Members | ${name}`,
    description: (name) => `Browse the ${name} member directory.`,
    robots: 'noindex,nofollow',
  },
  member: {
    component: MemberProfile,
    title: (name) => `Member Profile | ${name}`,
    description: (name) => `View a ${name} member profile and service record.`,
    robots: 'noindex,nofollow',
    props: (url, route) => ({ memberId: route.memberId }),
  },
  intelligence: {
    component: GuildIntelligence,
    title: (name) => `GuildOS | ${name}`,
    description: (name) => `${name} GuildOS for synced characters, roster intelligence, crafting knowledge, and guild operations.`,
    robots: 'noindex,nofollow',
  },
  charter: {
    component: Charter,
    title: (name, holdfast) => (holdfast ? 'Holdfast Charter | Alliance WoW Forever Guild' : `Charter | ${name}`),
    description: (name, holdfast) => (holdfast
      ? 'Read the Holdfast charter: service-based leadership, high standards without elitism, shared prosperity, mentorship, and a guild built to endure.'
      : `Read the ${name} charter.`),
    robots: defaultRobots,
  },
  ranks: {
    component: Ranks,
    title: (name) => `Ranks & Roles | ${name}`,
    description: (name) => `Learn how ${name} ranks, Reputation, promotion, and guild roles work.`,
    robots: defaultRobots,
  },
  about: {
    component: GuildPage,
    title: (name) => `${name} | Guildweaver`,
    description: (name) => `${name} on Guildweaver: recruiting needs, schedule, verified roster activity and sister guilds.`,
    robots: defaultRobots,
    props: (url, route) => ({ slug: route.slug }),
  },
  join: {
    component: Join,
    title: () => 'Join Holdfast | Alliance WoW Forever Guild',
    description: () => 'Join Holdfast through Discord and create your Holdfast member profile.',
    robots: defaultRobots,
  },
}

const notFoundPage = {
  component: NotFound,
  title: 'Page Not Found | Guildweaver',
  description: 'The requested page could not be found.',
  robots: 'noindex,nofollow',
}

function GuildRoute({ page, route, url, path }) {
  const { guild, status } = useGuild()
  const holdfast = route.slug === HOLDFAST_SLUG
  const name = guild?.name || guildNameFromSlug(route.slug)
  const missing = status === 'missing'
  const shown = missing ? notFoundPage : page
  const Page = shown.component

  return (
    <>
      <SEO
        title={missing ? notFoundPage.title : page.title(name, holdfast, guild)}
        description={missing ? notFoundPage.description : page.description(name, holdfast, guild)}
        path={path}
        robots={shown.robots}
        organization={!missing && page.organization ? name : null}
      />
      {/* A slug no guild has is a missing page, not a guild. */}
      <Navbar variant={missing ? 'platform' : 'guild'} />
      <Suspense fallback={<PageLoading />}>
        <Page key={path} {...(missing ? {} : page.props?.(url, route) || {})} />
      </Suspense>
    </>
  )
}

function App() {
  // Follow client-side navigation in a transition: React keeps the current
  // page on screen while the next page's code loads, instead of falling back
  // to the loading screen. Links no longer reload the page.
  const [href, setHref] = useState(() => window.location.href)
  const [navigating, startNavigation] = useTransition()
  useEffect(() => subscribeLocation(() => startNavigation(() => setHref(window.location.href))), [])
  useEffect(() => interceptLinkClicks(), [])
  const url = new URL(href)
  const requestedPathname = normalizePathname(url.pathname)
  const redirectPathname = legacyRedirectPathname(requestedPathname)
  const pathname = redirectPathname || requestedPathname
  const route = matchRoute(pathname)

  // Old single-guild paths (/quests, /guilds/:slug, ...) move to where they
  // live now, keeping the query string and hash. The server answers them with
  // a 301 in production; this covers dev and links followed in the app.
  useEffect(() => {
    if (!redirectPathname) return
    const current = new URL(window.location.href)
    window.history.replaceState(null, '', `${redirectPathname}${current.search}${current.hash}`)
  }, [redirectPathname])

  // /join opens Holdfast's join flow over Holdfast's home.
  const guildRoute = route?.name === 'join'
    ? { name: 'guild', slug: HOLDFAST_SLUG, section: 'join' }
    : route?.name === 'guild' ? route : null
  const page = guildRoute ? null : (route && platformPages[route.name]) || notFoundPage
  const Page = page?.component

  return (
    <>
      {guildRoute ? (
        // Keyed by slug: moving between guilds starts from a fresh listing.
        <GuildProvider key={guildRoute.slug} slug={guildRoute.slug}>
          <GuildRoute page={guildPages[guildRoute.section]} route={guildRoute} url={url} path={pathname} />
        </GuildProvider>
      ) : (
        <>
          <SEO
            title={page.title}
            description={page.description}
            path={pathname}
            robots={page.robots}
            home={page.home}
          />

          {/* One navbar per kind of page: it never remounts between pages. */}
          {page.navbar === false ? null : <Navbar variant="platform" />}

          <Suspense fallback={<PageLoading />}>
            <Page key={pathname} {...(page.props?.(url, route) || {})} />
          </Suspense>
        </>
      )}

      {/* Fixed under the navbar; kept out of the navbar + page sibling pair
          that full-bleed pages are styled by (index.css). */}
      <RouteProgress active={navigating} />

      <AuthResultModal />
      <ResourceCacheSync />
    </>
  )
}

export default App
