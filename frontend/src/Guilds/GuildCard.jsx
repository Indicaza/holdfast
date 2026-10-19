import { Badge, Chip } from '../DesignSystem/index.js'
import { FactionMark, GuildCrest, RealmBadge, VerifiedBadge } from './GuildCrest.jsx'
import {
  CLASS_LABELS,
  PLAY_STYLE_LABELS,
  REALM_TYPE_LABELS,
  classColor,
  guildPath,
  scheduleSummary,
  sizeLabel,
} from './guildDirectoryModel.js'

function RecruitingPips({ recruiting, classes }) {
  if (!recruiting) return <span className="guild-card__muted">Not recruiting</span>
  if (!classes.length) return <span>All classes welcome</span>
  return (
    <span className="guild-card__pips" aria-label={`Recruiting ${classes.map((token) => CLASS_LABELS[token]).join(', ')}`}>
      {classes.map((token) => (
        <span key={token} className="guild-card__pip" style={{ '--pip': classColor(token) }} title={CLASS_LABELS[token]} />
      ))}
    </span>
  )
}

export default function GuildCard({ guild, preview = false }) {
  const { stats } = guild
  const Frame = preview ? 'div' : 'a'
  return (
    <Frame className={`guild-card${preview ? ' guild-card--preview' : ''}`} {...(preview ? {} : { href: guildPath(guild.slug) })} style={{ '--guild-accent': guild.accentColor }}>
      <span className="guild-card__banner" aria-hidden="true" />
      <div className="guild-card__head">
        <GuildCrest name={guild.name} accentColor={guild.accentColor} faction={guild.faction} size={64} />
        <div className="guild-card__identity">
          <h3>{guild.name}</h3>
          <p>{guild.realm} · {guild.region}</p>
        </div>
      </div>

      <div className="guild-card__badges">
        <FactionMark faction={guild.faction} />
        <RealmBadge realmType={guild.realmType} label={REALM_TYPE_LABELS[guild.realmType]} />
        {guild.recruiting ? <Badge tone="success">Recruiting</Badge> : null}
        {stats?.verified ? <VerifiedBadge /> : null}
      </div>

      {guild.tagline ? <p className="guild-card__tagline">{guild.tagline}</p> : null}

      {guild.playStyles.length ? (
        <ul className="guild-card__styles" aria-label="Play styles">
          {guild.playStyles.slice(0, 4).map((style) => <li key={style}><Chip>{PLAY_STYLE_LABELS[style] || style}</Chip></li>)}
        </ul>
      ) : null}

      <dl className="guild-card__facts">
        <div><dt>Looking for</dt><dd><RecruitingPips recruiting={guild.recruiting} classes={guild.recruitingClasses} /></dd></div>
        <div><dt>Schedule</dt><dd>{scheduleSummary(guild.schedule, guild.timezone)}</dd></div>
      </dl>

      <div className="guild-card__footer">
        <span>{sizeLabel(stats)}</span>
        {stats?.activeCharacters ? (
          <span className="guild-card__active"><span className="guild-card__pulse" aria-hidden="true" />{stats.activeCharacters} active this week</span>
        ) : <span className="guild-card__muted">Activity not yet synced</span>}
      </div>
    </Frame>
  )
}
