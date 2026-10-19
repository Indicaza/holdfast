import { createContext, useContext } from 'react'
import { HOLDFAST_SLUG, guildHref } from '../routing.js'

export const GuildContext = createContext(null)

// Pages that render outside a guild (the join flow, platform pages) still link
// to guild pages: those links go to Holdfast's until the user picks a guild.
const outsideGuild = {
  slug: HOLDFAST_SLUG,
  guild: null,
  status: 'none',
  href: (path = '') => guildHref(HOLDFAST_SLUG, path),
}

// The guild whose pages are showing: { slug, guild, status, href(path) }.
// guild is the /api/guilds/:slug listing once it has loaded.
export function useGuild() {
  return useContext(GuildContext) || outsideGuild
}

// A path under the current guild: useGuildHref()('/quests').
export function useGuildHref() {
  return useGuild().href
}
