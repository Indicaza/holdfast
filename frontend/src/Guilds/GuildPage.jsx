import { useEffect, useState } from 'react'
import { apiJson } from '../Api/apiClient.js'
import { useSession } from '../Auth/sessionContext.js'
import { Badge, Button, Chip, Panel, Select, TextArea, TextInput } from '../DesignSystem/index.js'
import Footer from '../Home/Footer/Footer.jsx'
import { FactionMark, GuildCrest, RealmBadge, VerifiedBadge } from './GuildCrest.jsx'
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
      <Panel tone="raised" padding="lg" className="guild-apply" role="status" title="Application sent" titleAs="h3">
        <p>{guild.name}&rsquo;s officers will review it. {guild.discordInviteUrl ? 'Join their Discord to say hello in the meantime.' : ''}</p>
        <div><Button onClick={onClose}>Done</Button></div>
      </Panel>
    )
  }

  return (
    <Panel as="form" tone="raised" padding="lg" className="guild-apply" onSubmit={submit} title={`Apply to ${guild.name}`} titleAs="h3"
      actions={<Button variant="ghost" size="sm" className="guild-apply__close" onClick={onClose} aria-label="Close application">✕</Button>}>
      <div className="guild-apply__row">
        <TextInput label="Character" name="characterName" maxLength={48} required placeholder="Your main" />
        <Select label="Class" name="classToken" defaultValue="" placeholder="Choose a class" placeholderDisabled options={Object.entries(CLASS_LABELS)} />
        <Select label="Role" name="role" defaultValue="" placeholder="Any" options={Object.entries(ROLE_LABELS)} />
      </div>
      <TextArea label="Message" name="message" rows={4} maxLength={1000} placeholder="What you play, when you play, and what you’re looking for." />
      {state.status === 'error' ? <p className="guild-alert" role="alert">{state.message}</p> : null}
      <div>
        <Button type="submit" variant="primary" size="lg" loading={state.status === 'sending'}>
          {state.status === 'sending' ? 'Sending…' : 'Send application'}
        </Button>
      </div>
    </Panel>
  )
}

function RosterPanel({ guild }) {
  const { stats } = guild
  const segments = classMixSegments(stats.classMix)
  if (!stats.verified) {
    return (
      <Panel tone="dashed" padding="lg" className="guild-roster guild-roster--unverified" title="Verified roster">
        <p>{guild.name} hasn&rsquo;t synced characters yet. Guilds that use the Guildweaver addon show real activity, level spread and class mix here.</p>
        <div><Button href="/guildweaver">Get the addon</Button></div>
      </Panel>
    )
  }
  return (
    <Panel padding="lg" className="guild-roster" title="Verified roster"
      actions={<span className="guild-roster__live"><span className="guild-card__pulse" aria-hidden="true" />{lastActiveLabel(stats.lastActiveAt)}</span>}>
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
      <p className="guild-note">Synced by the Guildweaver addon from members&rsquo; own characters. Shown as totals only.</p>
    </Panel>
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
            {result.missing ? <><h1>Guild not found</h1><p>It may have been renamed or unlisted.</p><Button href="/" size="lg">Browse guilds</Button></>
              : result.error ? <><h1>Something went wrong</h1><p role="alert">{result.error}</p><Button href="/" size="lg">Browse guilds</Button></>
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
          <a className="guild-back" href="/"><span aria-hidden="true">←</span> All guilds</a>
          <header className="guild-page__hero">
            <span className="guild-page__hero-glow" aria-hidden="true" />
            <GuildCrest name={guild.name} accentColor={guild.accentColor} faction={guild.faction} size={128} />
            <div className="guild-page__identity">
              <div className="guild-card__badges">
                <FactionMark faction={guild.faction} />
                <RealmBadge realmType={guild.realmType} label={REALM_TYPE_LABELS[guild.realmType]} />
                {guild.recruiting ? <Badge tone="success">Recruiting</Badge> : <Badge>Not recruiting</Badge>}
                {guild.stats.verified ? <VerifiedBadge>Verified activity</VerifiedBadge> : null}
              </div>
              <h1>{guild.name}</h1>
              {guild.tagline ? <p className="guild-page__tagline">{guild.tagline}</p> : null}
              <p className="guild-page__meta">{guild.realm} · {REGION_LABELS[guild.region] || guild.region} · {sizeLabel(guild.stats)}</p>
            </div>
            <div className="guild-page__actions">
              {guild.discordInviteUrl ? <Button variant="primary" size="lg" href={guild.discordInviteUrl} target="_blank" rel="noreferrer noopener">Join their Discord</Button> : null}
              {mine?.slug === guild.slug ? (
                <span className="guild-page__member">{mine.role === 'owner' ? 'You lead this guild' : 'You’re a member'}</span>
              ) : guild.recruiting ? (
                <Button variant={guild.discordInviteUrl ? 'secondary' : 'primary'} size="lg"
                  onClick={() => (authenticated ? setApplying(true) : signIn(`${guildPath(guild.slug)}/about?apply=1`))}>
                  Apply to join
                </Button>
              ) : null}
            </div>
          </header>

          {applying ? <ApplyPanel guild={guild} onClose={() => setApplying(false)} /> : null}

          <div className="guild-page__grid">
            <div className="guild-page__main">
              <Panel padding="lg" title="About" className="guild-about">
                {guild.description ? guild.description.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)
                  : <p className="guild-muted">This guild hasn&rsquo;t written a description yet.</p>}
                {guild.playStyles.length ? (
                  <ul className="guild-tags" aria-label="Play styles">
                    {guild.playStyles.map((style) => <li key={style}><Chip>{PLAY_STYLE_LABELS[style] || style}</Chip></li>)}
                  </ul>
                ) : null}
              </Panel>
              <RosterPanel guild={guild} />
            </div>

            <aside className="guild-page__side">
              <Panel title="At a glance">
                <dl className="guild-facts">
                  {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl>
              </Panel>

              {guild.recruiting ? (
                <Panel title="Looking for">
                  {guild.recruitingClasses.length ? (
                    <ul className="guild-tags">
                      {guild.recruitingClasses.map((token) => <li key={token}><Chip color={classColor(token)}>{CLASS_LABELS[token]}</Chip></li>)}
                    </ul>
                  ) : <p className="guild-muted">Every class is welcome.</p>}
                  {guild.recruitingRoles.length ? <p className="guild-roles">{guild.recruitingRoles.map((role) => ROLE_LABELS[role]).join(' · ')}</p> : null}
                </Panel>
              ) : null}

              {guild.sisters?.length ? (
                <Panel title="Sister guilds">
                  <ul className="guild-sisters">
                    {guild.sisters.map((sister) => (
                      <li key={sister.id}>
                        <a href={guildPath(sister.slug)}>
                          <GuildCrest name={sister.name} accentColor={sister.accentColor} faction={sister.faction} size={36} />
                          <span><strong>{sister.name}</strong><small>{sister.realm}</small></span>
                          <span className="guild-sisters__arrow" aria-hidden="true">→</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ) : null}
            </aside>
          </div>
        </main>
        <Footer />
      </div>
    </div>
  )
}
