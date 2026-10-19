import { useCallback, useEffect, useMemo } from 'react'
import { useLiveResource } from '../Live/useLiveResource.js'
import { guildHref } from '../routing.js'
import { GuildContext } from './guildContext.js'

const selectGuild = (body) => body?.guild ?? null

// Loads the guild a /:slug page is in and shares it with the navbar and the
// page. While a guild's pages are showing, <html data-faction> is its faction
// so faction-scoped theme tokens apply everywhere, navbar included.
export default function GuildProvider({ slug, children }) {
  const { status, data: guild } = useLiveResource(`/api/guilds/${encodeURIComponent(slug)}`, {
    topics: ['guilds'],
    select: selectGuild,
  })

  const faction = guild?.slug === slug ? guild.faction : null
  useEffect(() => {
    if (!faction) return undefined
    const root = document.documentElement
    root.dataset.faction = faction
    return () => {
      if (root.dataset.faction === faction) delete root.dataset.faction
    }
  }, [faction])

  const href = useCallback((path = '') => guildHref(slug, path), [slug])
  const value = useMemo(() => ({
    slug,
    guild: guild?.slug === slug ? guild : null,
    status,
    href,
  }), [slug, guild, status, href])

  return <GuildContext.Provider value={value}>{children}</GuildContext.Provider>
}
