import { useId } from 'react'
import { Badge } from '../DesignSystem/index.js'
import { FACTION_COLORS, guildInitials } from './guildDirectoryModel.js'

// A heraldic shield in the guild's accent colour with its initials, edged in
// its faction's colour. Drawn, not uploaded, so every guild has a crest.
export function GuildCrest({ name, accentColor = '#c4a667', faction = 'alliance', size = 64 }) {
  const id = useId().replace(/:/g, '')
  const edge = FACTION_COLORS[faction] || FACTION_COLORS.alliance
  return (
    <svg className="guild-crest" width={size} height={size * 1.15} viewBox="0 0 100 115" role="img" aria-label={`${name} crest`}>
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={accentColor} stopOpacity="0.95" />
          <stop offset="1" stopColor="#07111f" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M50 3 L94 16 V54 C94 82 74 101 50 112 C26 101 6 82 6 54 V16 Z" fill={`url(#${id}-fill)`} stroke={edge} strokeWidth="3.5" />
      <path d="M50 11 L86 22 V54 C86 77 70 93 50 103 C30 93 14 77 14 54 V22 Z" fill="none" stroke="rgba(247,245,239,0.28)" strokeWidth="1.25" />
      <path d="M50 3 L94 16 V54 C94 60 93 65 91 70 L9 70 C7 65 6 60 6 54 V16 Z" fill={`url(#${id}-sheen)`} />
      <text x="50" y="66" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontSize="34" fill="#f7f5ef" letterSpacing="1">
        {guildInitials(name)}
      </text>
    </svg>
  )
}

export function FactionMark({ faction }) {
  return (
    <Badge faction={faction === 'horde' ? 'horde' : 'alliance'}
      icon={<svg width="11" height="13" viewBox="0 0 10 12"><path d="M5 0 L10 2 V6 C10 9 7.5 11 5 12 C2.5 11 0 9 0 6 V2 Z" fill="currentColor" /></svg>}>
      {faction === 'horde' ? 'Horde' : 'Alliance'}
    </Badge>
  )
}

const REALM_TONES = { hardcore: 'danger', pvp: 'gold', rp_pvp: 'gold', rp: 'arcane' }

export function RealmBadge({ realmType, label }) {
  return <Badge tone={REALM_TONES[realmType] || 'neutral'}>{label}</Badge>
}

export function VerifiedBadge({ children = 'Verified' }) {
  return (
    <Badge tone="gold" title="Activity verified by the Guildweaver addon"
      icon={<svg width="12" height="13" viewBox="0 0 12 13"><path d="M6 0 7.6 1.4 9.7 1.2 10.3 3.2 12 4.5 11.2 6.5 12 8.5 10.3 9.8 9.7 11.8 7.6 11.6 6 13 4.4 11.6 2.3 11.8 1.7 9.8 0 8.5.8 6.5 0 4.5 1.7 3.2 2.3 1.2 4.4 1.4Z" fill="currentColor" /><path d="m3.6 6.4 1.6 1.6 3.3-3.4" stroke="#07111f" strokeWidth="1.4" fill="none" strokeLinecap="round" /></svg>}>
      {children}
    </Badge>
  )
}
