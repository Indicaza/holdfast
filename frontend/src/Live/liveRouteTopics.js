export function routeTopics(pathname, hash) {
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

export function matchesLiveTopics(eventTopics, topics) {
  if (!eventTopics?.length || !topics.length) return false
  if (eventTopics.includes('*')) return true
  return topics.some((topic) => eventTopics.includes(topic))
}

// Routes whose pages keep their own data current (useLiveResource) and must
// never be remounted by a live update: remounting would close an open
// character modal and lose the user's place.
export function refreshesInPlace(pathname, hash) {
  if (pathname.startsWith('/armory/')) return true
  if (pathname !== '/intelligence') return false
  const view = String(hash || '').replace(/^#/, '').toLowerCase()
  return view !== 'audit' && view !== 'guildweaver'
}
