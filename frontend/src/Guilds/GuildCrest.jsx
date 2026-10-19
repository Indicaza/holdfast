import { useId } from 'react'
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
    <span className={`guild-faction guild-faction--${faction}`}>
      <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><path d="M5 0 L10 2 V6 C10 9 7.5 11 5 12 C2.5 11 0 9 0 6 V2 Z" fill="currentColor" /></svg>
      {faction === 'horde' ? 'Horde' : 'Alliance'}
    </span>
  )
}
