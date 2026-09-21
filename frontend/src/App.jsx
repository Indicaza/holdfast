import { lazy, Suspense } from 'react'
import Home from './Home/Home.jsx'
import SEO from './SEO/SEO.jsx'

const Admin = lazy(() => import('./Admin/Admin.jsx'))
const Charter = lazy(() => import('./Charter/Charter.jsx'))
const GuildOS = lazy(() => import('./GuildOS/GuildOS.jsx'))
const Join = lazy(() => import('./Join/Join.jsx'))
const Privacy = lazy(() => import('./Privacy/Privacy.jsx'))

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
  '/charter': {
    component: Charter,
    path: '/charter',
    title: 'Holdfast Charter | Alliance WoW Forever Guild',
    description:
      'Read the Holdfast charter: service-based leadership, high standards without elitism, shared prosperity, mentorship, and a guild built to endure.',
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
  '/join': {
    component: Join,
    path: '/join',
    title: 'Join Holdfast | Alliance WoW Forever Guild',
    description:
      'Join Holdfast, an Alliance guild for WoW Forever welcoming raiders, PvPers, crafters, gatherers, mentors, new players, and people with real lives.',
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

function App() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  const route = routes[pathname] ?? routes['/']
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
        <Page />
      </Suspense>
    </>
  )
}

export default App
