import { FactionMark, GuildCrest } from './GuildCrest.jsx'
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
      <span className="guild-card__glow" aria-hidden="true" />
      <div className="guild-card__head">
        <GuildCrest name={guild.name} accentColor={guild.accentColor} faction={guild.faction} size={52} />
        <div className="guild-card__identity">
          <h3>{guild.name}</h3>
          <p>{guild.realm} · {guild.region}</p>
        </div>
      </div>

      <div className="guild-card__badges">
        <FactionMark faction={guild.faction} />
        <span className={`guild-badge guild-badge--realm guild-badge--${guild.realmType}`}>{REALM_TYPE_LABELS[guild.realmType]}</span>
        {guild.recruiting ? <span className="guild-badge guild-badge--recruiting">Recruiting</span> : null}
        {stats?.verified ? (
          <span className="guild-badge guild-badge--verified" title="Activity verified by the Guildweaver addon">
            <svg width="11" height="12" viewBox="0 0 12 13" aria-hidden="true"><path d="M6 0 7.6 1.4 9.7 1.2 10.3 3.2 12 4.5 11.2 6.5 12 8.5 10.3 9.8 9.7 11.8 7.6 11.6 6 13 4.4 11.6 2.3 11.8 1.7 9.8 0 8.5.8 6.5 0 4.5 1.7 3.2 2.3 1.2 4.4 1.4Z" fill="currentColor" /><path d="m3.6 6.4 1.6 1.6 3.3-3.4" stroke="#07111f" strokeWidth="1.4" fill="none" strokeLinecap="round" /></svg>
            Verified
          </span>
        ) : null}
      </div>

      {guild.tagline ? <p className="guild-card__tagline">{guild.tagline}</p> : null}

      <ul className="guild-card__styles">
        {guild.playStyles.slice(0, 4).map((style) => <li key={style}>{PLAY_STYLE_LABELS[style] || style}</li>)}
      </ul>

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
