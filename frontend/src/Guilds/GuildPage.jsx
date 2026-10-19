import { useEffect, useState } from 'react'
import { apiJson } from '../Api/apiClient.js'
import { useSession } from '../Auth/sessionContext.js'
import Footer from '../Home/Footer/Footer.jsx'
import { FactionMark, GuildCrest } from './GuildCrest.jsx'
import {
  CLASS_LABELS,
  LANGUAGE_LABELS,
  PLAY_STYLE_LABELS,
  REALM_TYPE_LABELS,
  REGION_LABELS,
  ROLE_LABELS,
  classColor,
  classMixSegments,
  guildPath,
  lastActiveLabel,
  scheduleSummary,
  sizeLabel,
} from './guildDirectoryModel.js'
import './Guilds.css'

const APPLICATION_ERRORS = {
  already_in_guild: 'You are already in a guild. Leave it before applying to another.',
  application_pending: 'Your application is already with the officers.',
  guild_not_recruiting: 'This guild is not recruiting right now.',
}

function ApplyPanel({ guild, onClose }) {
  const [state, setState] = useState({ status: 'idle' })
  async function submit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setState({ status: 'sending' })
    try {
      await apiJson(`/api/guilds/${encodeURIComponent(guild.slug)}/applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      })
      setState({ status: 'sent' })
    } catch (error) {
      setState({ status: 'error', message: APPLICATION_ERRORS[error.body?.error] || 'Your application could not be sent. Please try again.' })
    }
  }

  if (state.status === 'sent') {
    return (
      <div className="guild-apply guild-apply--sent" role="status">
        <h3>Application sent</h3>
        <p>{guild.name}&rsquo;s officers will review it. {guild.discordInviteUrl ? 'Join their Discord to say hello in the meantime.' : ''}</p>
        <button type="button" className="guild-page__secondary" onClick={onClose}>Done</button>
      </div>
    )
  }

  return (
    <form className="guild-apply" onSubmit={submit}>
      <div className="guild-apply__head">
        <h3>Apply to {guild.name}</h3>
        <button type="button" className="guild-apply__close" onClick={onClose} aria-label="Close application">×</button>
      </div>
      <div className="guild-apply__row">
        <label><span>Character</span><input name="characterName" maxLength={48} required placeholder="Your main" /></label>
        <label><span>Class</span>
          <select name="classToken" defaultValue="">
            <option value="" disabled>Choose a class</option>
            {Object.entries(CLASS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label><span>Role</span>
          <select name="role" defaultValue="">
            <option value="">Any</option>
            {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <label><span>Message</span><textarea name="message" rows={4} maxLength={1000} placeholder="What you play, when you play, and what you’re looking for." /></label>
      {state.status === 'error' ? <p className="guild-apply__error" role="alert">{state.message}</p> : null}
      <button type="submit" className="guild-page__primary" disabled={state.status === 'sending'}>
        {state.status === 'sending' ? 'Sending…' : 'Send application'}
      </button>
    </form>
  )
}

function RosterPanel({ guild }) {
  const { stats } = guild
  const segments = classMixSegments(stats.classMix)
  if (!stats.verified) {
    return (
      <section className="guild-panel guild-panel--roster guild-panel--unverified">
        <h2>Verified roster</h2>
        <p>{guild.name} hasn&rsquo;t synced characters yet. Guilds that use the Guildweaver addon show real activity, level spread and class mix here.</p>
        <a className="guild-page__secondary" href="/guildweaver">Get the addon</a>
      </section>
    )
  }
  return (
    <section className="guild-panel guild-panel--roster">
      <div className="guild-panel__title">
        <h2>Verified roster</h2>
        <span className="guild-panel__live"><span className="guild-card__pulse" aria-hidden="true" />{lastActiveLabel(stats.lastActiveAt)}</span>
      </div>
      <div className="guild-stats">
        <div><strong>{stats.activeCharacters}</strong><span>active this week</span></div>
        <div><strong>{stats.verifiedCharacters}</strong><span>synced this month</span></div>
        <div><strong>{stats.averageLevel ?? '–'}</strong><span>average level</span></div>
        <div><strong>{stats.maxLevelCharacters}</strong><span>at level 60</span></div>
      </div>
      {segments.length ? (
        <>
          <div className="guild-classmix" role="img" aria-label={segments.map((segment) => `${segment.label} ${segment.count}`).join(', ')}>
            {segments.map((segment) => <span key={segment.token} style={{ flexGrow: segment.share, '--class-color': segment.color }} title={`${segment.label}: ${segment.count}`} />)}
          </div>
          <ul className="guild-classmix__legend">
            {segments.map((segment) => (
              <li key={segment.token} style={{ '--class-color': segment.color }}><span aria-hidden="true" />{segment.label}<em>{segment.count}</em></li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="guild-panel__note">Synced by the Guildweaver addon from members&rsquo; own characters. Shown as totals only.</p>
    </section>
  )
}

export default function GuildPage({ slug }) {
  const { authenticated, signIn } = useSession()
  const [result, setResult] = useState({ loading: true })
  const [applying, setApplying] = useState(false)
  const [mine, setMine] = useState(null)

  useEffect(() => {
    if (!authenticated) return undefined
    const controller = new AbortController()
    apiJson('/api/guilds/mine', { signal: controller.signal })
      .then((body) => setMine(body.guild))
      .catch(() => {})
    return () => controller.abort()
  }, [authenticated])

  useEffect(() => {
    const controller = new AbortController()
    setResult({ loading: true })
    fetch(`/api/guilds/${encodeURIComponent(slug)}`, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) { setResult({ missing: true }); return }
        if (!response.ok) throw new Error('This guild could not be loaded.')
        setResult({ guild: (await response.json()).guild })
      })
      .catch((error) => { if (error.name !== 'AbortError') setResult({ error: error.message }) })
    return () => controller.abort()
  }, [slug])

  useEffect(() => {
    if (result.guild) document.title = `${result.guild.name} | Guildweaver`
  }, [result.guild])

  // Back from signing in to apply: open the application straight away.
  useEffect(() => {
    if (authenticated && result.guild?.recruiting && mine?.slug !== result.guild.slug && new URLSearchParams(window.location.search).get('apply') === '1') {
      setApplying(true)
    }
  }, [authenticated, result.guild, mine])

  const guild = result.guild
  if (!guild) {
    return (
      <div className="guild-browser guild-page">
        <div className="guild-browser__backdrop" aria-hidden="true" />
        <div className="guild-browser__frame">
          <main className="guild-page__state">
            {result.missing ? <><h1>Guild not found</h1><p>It may have been renamed or unlisted.</p><a className="guild-page__secondary" href="/">Browse guilds</a></>
              : result.error ? <><h1>Something went wrong</h1><p role="alert">{result.error}</p><a className="guild-page__secondary" href="/">Browse guilds</a></>
              : <div className="guild-page__loading" role="status" aria-label="Loading guild"><span /><span /><span /></div>}
          </main>
          <Footer />
        </div>
      </div>
    )
  }

  const facts = [
    ['Realm', `${guild.realm} · ${REGION_LABELS[guild.region] || guild.region}`],
    ['Realm type', REALM_TYPE_LABELS[guild.realmType]],
    ['Language', LANGUAGE_LABELS[guild.language] || guild.language],
    ['Schedule', scheduleSummary(guild.schedule, guild.timezone)],
    ['Voice', guild.voiceRequired ? 'Required for raids' : 'Optional'],
    ['Minimum level', guild.minimumLevel > 1 ? `Level ${guild.minimumLevel}+` : 'Any level'],
    ['Age', guild.agePolicy === 'adult' ? '18+' : 'All ages'],
  ]

  return (
    <div className="guild-browser guild-page" style={{ '--guild-accent': guild.accentColor }}>
      <div className="guild-browser__backdrop guild-page__backdrop" aria-hidden="true" />
      <div className="guild-browser__frame">
        <main>
          <a className="guild-page__back" href="/">← All guilds</a>
          <header className="guild-page__hero">
            <GuildCrest name={guild.name} accentColor={guild.accentColor} faction={guild.faction} size={112} />
            <div className="guild-page__identity">
              <div className="guild-card__badges">
                <FactionMark faction={guild.faction} />
                <span className={`guild-badge guild-badge--realm guild-badge--${guild.realmType}`}>{REALM_TYPE_LABELS[guild.realmType]}</span>
                {guild.recruiting ? <span className="guild-badge guild-badge--recruiting">Recruiting</span> : <span className="guild-badge">Not recruiting</span>}
                {guild.stats.verified ? <span className="guild-badge guild-badge--verified">Verified activity</span> : null}
              </div>
              <h1>{guild.name}</h1>
              {guild.tagline ? <p className="guild-page__tagline">{guild.tagline}</p> : null}
              <p className="guild-page__meta">{guild.realm} · {REGION_LABELS[guild.region] || guild.region} · {sizeLabel(guild.stats)}</p>
            </div>
            <div className="guild-page__actions">
              {guild.discordInviteUrl ? <a className="guild-page__primary" href={guild.discordInviteUrl} target="_blank" rel="noreferrer noopener">Join their Discord</a> : null}
              {mine?.slug === guild.slug ? (
                <span className="guild-page__member">{mine.role === 'owner' ? 'You lead this guild' : 'You’re a member'}</span>
              ) : guild.recruiting ? (
                <button type="button" className={guild.discordInviteUrl ? 'guild-page__secondary' : 'guild-page__primary'}
                  onClick={() => (authenticated ? setApplying(true) : signIn(`${guildPath(guild.slug)}/about?apply=1`))}>
                  Apply to join
                </button>
              ) : null}
            </div>
          </header>

          {applying ? <ApplyPanel guild={guild} onClose={() => setApplying(false)} /> : null}

          <div className="guild-page__grid">
            <div className="guild-page__main">
              <section className="guild-panel">
                <h2>About</h2>
                {guild.description ? guild.description.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)
                  : <p className="guild-panel__muted">This guild hasn&rsquo;t written a description yet.</p>}
                <ul className="guild-card__styles guild-card__styles--large">
                  {guild.playStyles.map((style) => <li key={style}>{PLAY_STYLE_LABELS[style] || style}</li>)}
                </ul>
              </section>
              <RosterPanel guild={guild} />
            </div>

            <aside className="guild-page__side">
              <section className="guild-panel">
                <h2>At a glance</h2>
                <dl className="guild-facts">
                  {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl>
              </section>

              {guild.recruiting ? (
                <section className="guild-panel">
                  <h2>Looking for</h2>
                  {guild.recruitingClasses.length ? (
                    <ul className="guild-wanted">
                      {guild.recruitingClasses.map((token) => <li key={token} style={{ '--class-color': classColor(token) }}><span aria-hidden="true" />{CLASS_LABELS[token]}</li>)}
                    </ul>
                  ) : <p className="guild-panel__muted">Every class is welcome.</p>}
                  {guild.recruitingRoles.length ? <p className="guild-panel__roles">{guild.recruitingRoles.map((role) => ROLE_LABELS[role]).join(' · ')}</p> : null}
                </section>
              ) : null}

              {guild.sisters?.length ? (
                <section className="guild-panel">
                  <h2>Sister guilds</h2>
                  <ul className="guild-sisters">
                    {guild.sisters.map((sister) => (
                      <li key={sister.id}>
                        <a href={guildPath(sister.slug)}>
                          <GuildCrest name={sister.name} accentColor={sister.accentColor} faction={sister.faction} size={32} />
                          <span><strong>{sister.name}</strong><small>{sister.realm}</small></span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </aside>
          </div>
        </main>
        <Footer />
      </div>
    </div>
  )
}
