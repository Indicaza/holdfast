import { lazy, Suspense } from 'react'
import Home from './Home/Home.jsx'
import SEO from './SEO/SEO.jsx'

const Admin = lazy(() => import('./Admin/Admin.jsx'))
const Charter = lazy(() => import('./Charter/Charter.jsx'))
const GuildOS = lazy(() => import('./GuildOS/GuildOS.jsx'))
const Join = lazy(() => import('./Join/Join.jsx'))
const MemberProfile = lazy(() => import('./Members/MemberProfile.jsx'))
const Members = lazy(() => import('./Members/Members.jsx'))
const Privacy = lazy(() => import('./Privacy/Privacy.jsx'))
const Quests = lazy(() => import('./Quests/Quests.jsx'))

const defaultRobots =
  'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'

const routes = {
  '/': {
    component: Home,
    path: '/',
    title: 'Holdfast | Alliance WoW Forever Guild',
    description:
      'Holdfast is an Alliance guild for WoW Forever focused on organized PvE, PvP, mentorship, shared prosperity, and a durable long-term community.',
    robots: defaultRobots,
    home: true,
  },
  '/quests': {
    component: Quests,
    path: '/quests',
    title: 'Holdfast Quests | Alliance WoW Forever Guild',
    description:
      'Browse Holdfast published guild quests, objectives, assignments, and rewards for WoW Forever.',
    robots: defaultRobots,
  },
  '/members': {
    component: Members,
    path: '/members',
    title: 'Members | Holdfast',
    description: 'Browse the Holdfast member directory.',
    robots: 'noindex,nofollow',
  },
  '/charter': {
    component: Charter,
    path: '/charter',
    title: 'Holdfast Charter | Alliance WoW Forever Guild',
    description:
      'Read the Holdfast charter: service-based leadership, high standards without elitism, shared prosperity, mentorship, and a guild built to endure.',
    robots: defaultRobots,
  },
  '/join': {
    component: Join,
    path: '/join',
    title: 'Join Holdfast | Alliance WoW Forever Guild',
    description:
      'Join Holdfast through Discord and create your GuildOS member profile.',
    robots: defaultRobots,
  },
  '/guildos': {
    component: GuildOS,
    path: '/guildos',
    title: 'GuildOS | Holdfast',
    description:
      'GuildOS is Holdfast’s supporting system for coordination, administration, and long-term guild operations in WoW Forever.',
    robots: defaultRobots,
  },
  '/privacy': {
    component: Privacy,
    path: '/privacy',
    title: 'Privacy | Holdfast',
    description: 'Holdfast privacy information.',
    robots: 'noindex,follow',
  },
  '/admin': {
    component: Admin,
    path: '/admin',
    title: 'Guild Control Room',
    description: 'Guild administrative control room.',
    robots: 'noindex,nofollow',
  },
}

function memberProfileRoute(pathname) {
  const match = pathname.match(/^\/members\/([^/]+)$/)

  if (!match) {
    return null
  }

  let memberId = match[1]

  try {
    memberId = decodeURIComponent(memberId)
  } catch {
    memberId = match[1]
  }

  return {
    component: MemberProfile,
    path: pathname,
    title: 'Member Profile | Holdfast',
    description: 'View a Holdfast member profile and service record.',
    robots: 'noindex,nofollow',
    props: { memberId },
  }
}

function App() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  const route = memberProfileRoute(pathname) ?? routes[pathname] ?? routes['/']
  const Page = route.component

  return (
    <>
      <SEO
        title={route.title}
        description={route.description}
        path={route.path}
        robots={route.robots}
        home={route.home}
      />

      <Suspense fallback={null}>
        <Page {...(route.props || {})} />
      </Suspense>
    </>
  )
}

export default App
