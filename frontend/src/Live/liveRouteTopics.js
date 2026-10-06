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
