import {
  FACTION_LABELS,
  PLAY_STYLE_LABELS,
  REALM_TYPE_LABELS,
  REGION_LABELS,
  scheduleSummary,
} from '../Guilds/guildDirectoryModel.js'
import { recruitmentFacts } from '../Home/recruitmentContent.js'
import { HOLDFAST_SLUG, guildHref, guildNameFromSlug } from '../routing.js'

// What a guild's home says. Holdfast keeps its own slides and copy; every
// other guild gets defaults built from its directory listing until guild
// pages are editable.
//
//   slideSet   'holdfast' | 'default' (see Home/HeroStory/heroStory.js)
//   eyebrow, name, motto   the hero heading
//   snapshot   { eyebrow, title, facts: [{ id, label, value, detail }] }

const holdfastContent = {
  holdfast: true,
  slideSet: 'holdfast',
  eyebrow: 'World of Warcraft · Forever · Alliance · PvP',
  name: 'Holdfast',
  motto: 'Servimus ut permaneat.',
  snapshot: {
    eyebrow: 'Holdfast at a glance',
    title: 'Find your pace. Find your people.',
    facts: recruitmentFacts,
  },
}

function listingFacts(guild) {
  const styles = (guild.playStyles || []).map((style) => PLAY_STYLE_LABELS[style] || style)
  return [
    {
      id: 'realm',
      label: REGION_LABELS[guild.region] || guild.region || 'Realm',
      value: guild.realm || 'Realm to be announced',
      detail: `${FACTION_LABELS[guild.faction] || 'Alliance'} on a ${REALM_TYPE_LABELS[guild.realmType] || 'Normal'} realm.`,
    },
    {
      id: 'schedule',
      label: 'Schedule',
      value: scheduleSummary(guild.schedule, guild.timezone),
      detail: guild.voiceRequired ? 'Voice is required for raids.' : 'Voice is optional.',
    },
    {
      id: 'styles',
      label: 'Play style',
      value: styles.slice(0, 2).join(' & ') || 'Play your way',
      detail: styles.length > 2 ? `Also ${styles.slice(2).join(', ').toLowerCase()}.` : 'Every kind of player has a place here.',
    },
    {
      id: 'recruiting',
      label: guild.recruiting ? 'Recruiting' : 'Roster',
      value: guild.recruiting ? 'Now recruiting' : 'Not recruiting',
      detail: guild.minimumLevel > 1 ? `Level ${guild.minimumLevel} and up.` : 'Every level welcome.',
    },
  ]
}

export function guildHomeContent(slug, guild = null) {
  if (slug === HOLDFAST_SLUG) return holdfastContent
  const name = guild?.name || guildNameFromSlug(slug)
  const faction = FACTION_LABELS[guild?.faction] || ''
  return {
    holdfast: false,
    slideSet: 'default',
    eyebrow: ['World of Warcraft', guild?.realm, faction, REALM_TYPE_LABELS[guild?.realmType]].filter(Boolean).join(' · '),
    name,
    motto: guild?.tagline || '',
    snapshot: {
      eyebrow: `${name} at a glance`,
      title: 'Find your pace. Find your people.',
      facts: guild ? listingFacts(guild) : [],
    },
  }
}

// The hero's two buttons. A primary with join: true opens Holdfast's join
// flow; everything else is a link.
export function guildHeroActions({ slug, guild = null, authenticated = false, memberSlug = null }) {
  const base = guildHref(slug)
  if (slug === HOLDFAST_SLUG) {
    return {
      primary: authenticated ? { label: 'View Quests', href: `${base}/quests` } : { label: 'Join Holdfast', join: true },
      secondary: { label: 'Read the Charter', href: `${base}/charter` },
    }
  }
  const profile = { label: 'Guild profile', href: `${base}/about` }
  if (authenticated && memberSlug === slug) {
    return { primary: { label: 'View Quests', href: `${base}/quests` }, secondary: profile }
  }
  if (guild?.recruiting) {
    return { primary: { label: 'Apply to join', href: `${base}/about?apply=1` }, secondary: profile }
  }
  return { primary: profile, secondary: { label: 'Find more guilds', href: '/' } }
}
