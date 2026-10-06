import { Fragment, useEffect, useMemo, useState } from 'react'
import { useLiveUpdates } from './LiveUpdatesProvider.jsx'

function routeTopics(pathname, hash) {
  if (pathname === '/quests') return ['quests']
  if (pathname === '/members' || pathname.startsWith('/members/')) return ['members', 'ranks', 'authority']
  if (pathname === '/ranks') return ['members', 'ranks', 'authority']
  if (pathname.startsWith('/armory/')) return ['armory', 'intelligence']
  if (pathname === '/admin') return ['audit']
  if (pathname === '/admin/guildweaver') return ['guildweaver']
  if (pathname === '/guildweaver' || pathname === '/guildweaver/connect') return ['guildweaver']

  if (pathname === '/intelligence') {
    const view = String(hash || '').replace(/^#/, '').toLowerCase()
    if (view === 'audit') return ['audit']
    if (view === 'guildweaver') return ['guildweaver']
    return ['intelligence', 'armory', 'members', 'ranks', 'authority']
  }

  return []
}

function matches(eventTopics, topics) {
  if (!eventTopics?.length || !topics.length) return false
  if (eventTopics.includes('*')) return true
  return topics.some((topic) => eventTopics.includes(topic))
}

export default function LiveRouteBoundary({ children }) {
  const { event } = useLiveUpdates()
  const [version, setVersion] = useState(0)
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  const hash = window.location.hash
  const topics = useMemo(() => routeTopics(pathname, hash), [pathname, hash])

  useEffect(() => {
    if (!event || !matches(event.topics, topics)) return

    if (pathname === '/quests') {
      window.dispatchEvent(new Event('holdfast:quests-changed'))
      return
    }

    setVersion((current) => current + 1)
  }, [event, pathname, topics])

  return <Fragment key={version}>{children}</Fragment>
}

export { matches, routeTopics }
