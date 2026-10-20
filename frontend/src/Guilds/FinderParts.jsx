// The guild finder's directory row and detail card. The finder renders them
// for listed guilds; registration renders them for the draft, so leaders see
// exactly how their guild will appear.
import { Button } from '../DesignSystem/index.js'
import { navigate } from '../Navigation/navigation.js'
import { FactionMark, GuildCrest, RealmBadge, VerifiedBadge } from './GuildCrest.jsx'
import {
  CLASS_LABELS,
  CLASS_SHORT,
  FACTION_LABELS,
  LANGUAGE_LABELS,
  PLAY_STYLE_LABELS,
  REALM_TYPE_LABELS,
  REGION_LABELS,
  ROLE_LABELS,
  WEEKDAY_LABELS,
  activityShare,
  classColor,
  classMixSegments,
  guildPath,
  lastActiveLabel,
  scheduleSummary,
  weekStrip,
} from './guildDirectoryModel.js'
import './GuildFinder.css'

const applyPath = (slug) => `${guildPath(slug)}/about?apply=1`

export function CloseIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
}

export function DiscordIcon({ width = 20, height = 16 }) {
  return (
    <svg width={width} height={height} viewBox="0 0 28 22" aria-hidden="true"><path fill="currentColor" d="M23.7 1.8A23 23 0 0 0 18 0l-.7 1.5a21 21 0 0 0-6.4 0L10.2 0a23 23 0 0 0-5.8 1.8C.8 7.3-.2 12.6.3 17.9A23 23 0 0 0 7.4 21.5l1.4-2.3a15 15 0 0 1-2.3-1.1l.6-.4a16.4 16.4 0 0 0 14.1 0l.6.4c-.7.4-1.5.8-2.3 1.1l1.4 2.3a23 23 0 0 0 7-3.6c.6-6.2-1-11.4-4.2-16.1ZM9.4 14.7c-1.4 0-2.5-1.3-2.5-2.8s1.1-2.8 2.5-2.8 2.5 1.3 2.5 2.8-1.1 2.8-2.5 2.8Zm9.2 0c-1.4 0-2.5-1.3-2.5-2.8s1.1-2.8 2.5-2.8 2.5 1.3 2.5 2.8-1.1 2.8-2.5 2.8Z" /></svg>
  )
}

function VerifiedTick() {
  return (
    <svg className="finder-verified" width="13" height="14" viewBox="0 0 12 13" role="img" aria-label="Verified activity">
      <path d="M6 0 7.6 1.4 9.7 1.2 10.3 3.2 12 4.5 11.2 6.5 12 8.5 10.3 9.8 9.7 11.8 7.6 11.6 6 13 4.4 11.6 2.3 11.8 1.7 9.8 0 8.5.8 6.5 0 4.5 1.7 3.2 2.3 1.2 4.4 1.4Z" fill="currentColor" />
      <path d="m3.6 6.4 1.6 1.6 3.3-3.4" stroke="#07111f" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  )
}

/* Row */

function RecruitTokens({ guild, limit = 3 }) {
  if (!guild.recruiting) return <span className="finder-muted">Closed</span>
  if (!guild.recruitingClasses.length) return <span className="finder-open">All classes</span>
  const shown = guild.recruitingClasses.slice(0, limit)
  const rest = guild.recruitingClasses.slice(limit)
  return (
    <span className="finder-tokens" aria-label={`Recruiting ${guild.recruitingClasses.map((token) => CLASS_LABELS[token]).join(', ')}`}>
      {shown.map((token) => (
        <span key={token} className="finder-token" style={{ '--class-color': classColor(token) }} title={CLASS_LABELS[token]}>{CLASS_SHORT[token]}</span>
      ))}
      {rest.length ? <span className="finder-token finder-token--more" title={rest.map((token) => CLASS_LABELS[token]).join(', ')}>+{rest.length}</span> : null}
    </span>
  )
}

function WeekStrip({ schedule }) {
  const days = weekStrip(schedule?.raidDays)
  if (!days.some((day) => day.active)) return <span className="finder-muted">Flexible</span>
  return (
    <span className="finder-weekstrip" aria-label={`Raids ${days.filter((day) => day.active).map((day) => WEEKDAY_LABELS[day.day]).join(', ')}`}>
      {days.map((day) => <span key={day.day} className={day.active ? 'on' : ''} aria-hidden="true">{day.label}</span>)}
    </span>
  )
}

function ActivityMeter({ stats }) {
  if (!stats?.verified) return <span className="finder-muted">—</span>
  return (
    <span className="finder-activity" title={`${stats.activeCharacters} characters active this week`}>
      <span className="finder-activity__value">{stats.activeCharacters}</span>
      <span className="finder-activity__bar" aria-hidden="true"><span style={{ width: `${Math.max(8, activityShare(stats) * 100)}%` }} /></span>
    </span>
  )
}

export function GuildRow({ guild, selected, onSelect }) {
  return (
    <li role="option" aria-selected={selected} id={`finder-row-${guild.slug}`}
      className={`finder-row${selected ? ' finder-row--selected' : ''}`} data-faction={guild.faction}
      style={{ '--guild-accent': guild.accentColor }} onClick={onSelect ? () => onSelect(guild.slug) : undefined}>
      <span className="finder-row__crest"><GuildCrest name={guild.name} accentColor={guild.accentColor} faction={guild.faction} size={34} /></span>
      <span className="finder-row__identity">
        <span className="finder-row__name">{guild.name}{guild.stats?.verified ? <VerifiedTick /> : null}</span>
        <span className="finder-row__meta">
          <span className="finder-row__faction">{FACTION_LABELS[guild.faction]}</span>
          <span className={`finder-row__realmtype finder-row__realmtype--${guild.realmType}`}>{REALM_TYPE_LABELS[guild.realmType]}</span>
          <span className="finder-row__realm">{guild.realm}</span>
        </span>
      </span>
      <span className="finder-row__styles">
        {guild.playStyles.slice(0, 2).map((style) => PLAY_STYLE_LABELS[style]).join(' · ')}
        {guild.playStyles.length > 2 ? <em> +{guild.playStyles.length - 2}</em> : null}
      </span>
      <span className="finder-row__recruit"><RecruitTokens guild={guild} /></span>
      <span className="finder-row__schedule"><WeekStrip schedule={guild.schedule} /></span>
      <span className="finder-row__members">{(guild.stats?.memberCount ?? 0).toLocaleString()}</span>
      <span className="finder-row__activity"><ActivityMeter stats={guild.stats} /></span>
    </li>
  )
}

/* Detail */

// preview: the draft of a guild that is not listed yet. Its actions are shown
// as players will see them but do nothing, and there is nothing to close.
export function GuildDetailCard({ guild, sisters, onClose, authenticated, signIn, preview = false }) {
  const stats = guild.stats || {}
  const segments = classMixSegments(stats.classMix)
  const facts = [
    ['Realm', `${guild.realm} · ${REGION_LABELS[guild.region] || guild.region}`],
    ['Language', LANGUAGE_LABELS[guild.language] || guild.language],
    ['Schedule', scheduleSummary(guild.schedule, guild.timezone)],
    ['Voice', guild.voiceRequired ? 'Required for raids' : 'Optional'],
    ['Level', guild.minimumLevel > 1 ? `${guild.minimumLevel}+` : 'Any'],
    ['Age', guild.agePolicy === 'adult' ? '18+' : 'All ages'],
  ]

  return (
    <article className={`finder-detail__card${preview ? ' finder-detail__card--preview' : ''}`} data-faction={guild.faction}
      style={{ '--guild-accent': guild.accentColor }} aria-label={guild.name}>
      <header className="finder-detail__head">
        <span className="finder-detail__glow" aria-hidden="true" />
        {onClose ? <button type="button" className="finder-icon-button finder-detail__close" onClick={onClose} aria-label="Close guild details"><CloseIcon /></button> : null}
        <div className="finder-detail__identity">
          <GuildCrest name={guild.name} accentColor={guild.accentColor} faction={guild.faction} size={60} />
          <div>
            <h2>{guild.name}</h2>
            {guild.tagline ? <p>{guild.tagline}</p> : null}
          </div>
        </div>
        <div className="finder-detail__badges">
          <FactionMark faction={guild.faction} />
          <RealmBadge realmType={guild.realmType} label={REALM_TYPE_LABELS[guild.realmType]} />
          {stats.verified ? <VerifiedBadge /> : null}
        </div>
        <div className="finder-detail__actions" inert={preview || undefined}>
          <Button variant="primary" size="sm" href={guildPath(guild.slug)}>Visit guild</Button>
          {guild.recruiting ? (
            <Button size="sm" onClick={() => (authenticated ? navigate(applyPath(guild.slug)) : signIn(applyPath(guild.slug)))}>Apply</Button>
          ) : null}
          {guild.discordInviteUrl ? (
            <a className="finder-icon-button finder-discord" href={guild.discordInviteUrl} target="_blank" rel="noreferrer noopener" aria-label="Join their Discord" title="Join their Discord">
              <DiscordIcon />
            </a>
          ) : null}
        </div>
      </header>

      <div className="finder-detail__body">
        <section className="finder-stats" aria-label="Roster">
          <div><strong>{(stats.memberCount ?? 0).toLocaleString()}</strong><span>Members</span></div>
          <div><strong>{stats.verified ? stats.activeCharacters : '—'}</strong><span>Active / wk</span></div>
          <div><strong>{stats.verified ? stats.averageLevel ?? '—' : '—'}</strong><span>Avg level</span></div>
          <div><strong>{stats.verified ? stats.maxLevelCharacters : '—'}</strong><span>Level 60</span></div>
        </section>

        {segments.length ? (
          <section className="finder-section">
            <h3>Class mix <span className="finder-live">{lastActiveLabel(stats.lastActiveAt)}</span></h3>
            <div className="finder-mix" role="img" aria-label={segments.map((segment) => `${segment.label} ${segment.count}`).join(', ')}>
              {segments.map((segment) => <span key={segment.token} style={{ flexGrow: segment.share, '--class-color': segment.color }} title={`${segment.label}: ${segment.count}`} />)}
            </div>
            <ul className="finder-mix__legend">
              {segments.map((segment) => <li key={segment.token} style={{ '--class-color': segment.color }}>{segment.label}<em>{segment.count}</em></li>)}
            </ul>
          </section>
        ) : !stats.verified ? (
          <section className="finder-section finder-section--note">
            <p>No synced activity yet. Guilds using the Guildweaver addon show live roster activity and class mix here.</p>
          </section>
        ) : null}

        <section className="finder-section">
          <h3>Recruiting</h3>
          {guild.recruiting ? (
            <>
              <div className="finder-wanted">
                {guild.recruitingClasses.length
                  ? guild.recruitingClasses.map((token) => <span key={token} className="finder-token finder-token--wide" style={{ '--class-color': classColor(token) }}>{CLASS_LABELS[token]}</span>)
                  : <span className="finder-open">Every class welcome</span>}
              </div>
              {guild.recruitingRoles.length ? <p className="finder-roles">{guild.recruitingRoles.map((role) => ROLE_LABELS[role]).join(' · ')}</p> : null}
            </>
          ) : <p className="finder-muted">Not recruiting right now.</p>}
        </section>

        <section className="finder-section">
          <h3>At a glance</h3>
          <dl className="finder-facts">
            {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        </section>

        {guild.playStyles.length ? (
          <section className="finder-section">
            <h3>Play styles</h3>
            <div className="finder-styles">{guild.playStyles.map((style) => <span key={style}>{PLAY_STYLE_LABELS[style] || style}</span>)}</div>
          </section>
        ) : null}

        {guild.description ? (
          <section className="finder-section">
            <h3>About</h3>
            <div className="finder-about">{guild.description.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
          </section>
        ) : null}

        {sisters?.length ? (
          <section className="finder-section">
            <h3>Sister guilds</h3>
            <ul className="finder-sisters">
              {sisters.map((sister) => (
                <li key={sister.id}><a href={guildPath(sister.slug)}>
                  <GuildCrest name={sister.name} accentColor={sister.accentColor} faction={sister.faction} size={26} />
                  <span>{sister.name}<small>{sister.realm}</small></span>
                </a></li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </article>
  )
}
