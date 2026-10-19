import { useEffect, useState } from 'react'
import { apiJson } from '../Api/apiClient.js'
import { useSession } from '../Auth/sessionContext.js'
import Footer from '../Home/Footer/Footer.jsx'
import { navigate } from '../Navigation/navigation.js'
import GuildCard from './GuildCard.jsx'
import {
  ACCENT_SWATCHES,
  CLASS_LABELS,
  FACTION_LABELS,
  FIELD_ERRORS,
  FIELD_STEPS,
  LANGUAGE_LABELS,
  PLAY_STYLE_LABELS,
  REALM_TYPE_LABELS,
  REGION_LABELS,
  ROLE_LABELS,
  WEEKDAY_LABELS,
  classColor,
  draftSlug,
  guildPath,
  previewGuild,
  registrationDraft,
  stepErrors,
  toggleValue,
} from './guildDirectoryModel.js'
import './Guilds.css'

const STEPS = [
  { title: 'Identity', hint: 'Who you are and where you play.' },
  { title: 'How you play', hint: 'Play styles and your schedule.' },
  { title: 'Recruiting & Discord', hint: 'Who you need and where they find you.' },
]

const REALM_TYPE_HINTS = {
  normal: 'No forced world PvP',
  pvp: 'Open world PvP',
  rp: 'Roleplay rules',
  rp_pvp: 'Roleplay with world PvP',
  hardcore: 'One life per character',
}

function FieldError({ code }) {
  return code ? <p className="guild-form__error" role="alert">{FIELD_ERRORS[code] || 'Check this field.'}</p> : null
}

function Choice({ active, onClick, children, tone, label, className = '' }) {
  return (
    <button type="button" className={`guild-choice${active ? ' guild-choice--active' : ''}${tone ? ` guild-choice--${tone}` : ''} ${className}`}
      aria-pressed={active} aria-label={label} onClick={onClick}>
      {children}
    </button>
  )
}

function IdentityStep({ draft, set, errors }) {
  const slug = draftSlug(draft.name)
  return (
    <>
      <label className="guild-form__field">
        <span>Guild name</span>
        <input value={draft.name} maxLength={48} autoFocus placeholder="Ashen Vanguard" onChange={(event) => set({ name: event.target.value })} />
        <small>{window.location.host}{guildPath(slug || 'your-guild')}</small>
        <FieldError code={errors.name || errors.slug} />
      </label>
      <label className="guild-form__field">
        <span>Motto</span>
        <input value={draft.tagline} maxLength={120} placeholder="One line that says who you are." onChange={(event) => set({ tagline: event.target.value })} />
      </label>

      <fieldset className="guild-form__field">
        <legend>Faction</legend>
        <div className="guild-form__factions">
          {Object.entries(FACTION_LABELS).map(([value, label]) => (
            <Choice key={value} tone={value} label={label} active={draft.faction === value} onClick={() => set({ faction: value })}>
              <strong>{label}</strong>
            </Choice>
          ))}
        </div>
        <FieldError code={errors.faction} />
      </fieldset>

      <div className="guild-form__row">
        <label className="guild-form__field">
          <span>Region</span>
          <select value={draft.region} onChange={(event) => set({ region: event.target.value })}>
            {Object.entries(REGION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="guild-form__field">
          <span>Realm</span>
          <input value={draft.realm} maxLength={48} placeholder="Doomhowl" onChange={(event) => set({ realm: event.target.value })} />
          <FieldError code={errors.realm} />
        </label>
        <label className="guild-form__field">
          <span>Language</span>
          <select value={draft.language} onChange={(event) => set({ language: event.target.value })}>
            {Object.entries(LANGUAGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      <fieldset className="guild-form__field">
        <legend>Realm type</legend>
        <div className="guild-form__realm-types">
          {Object.entries(REALM_TYPE_LABELS).map(([value, label]) => (
            <Choice key={value} tone={value} label={`${label}: ${REALM_TYPE_HINTS[value]}`} active={draft.realmType === value} onClick={() => set({ realmType: value })}>
              <strong>{label}</strong><small>{REALM_TYPE_HINTS[value]}</small>
            </Choice>
          ))}
        </div>
        <FieldError code={errors.realmType} />
      </fieldset>

      <fieldset className="guild-form__field">
        <legend>Banner colour</legend>
        <div className="guild-form__swatches">
          {ACCENT_SWATCHES.map((color) => (
            <button key={color} type="button" className={`guild-swatch${draft.accentColor === color ? ' guild-swatch--active' : ''}`}
              style={{ '--swatch': color }} aria-label={`Banner colour ${color}`} aria-pressed={draft.accentColor === color}
              onClick={() => set({ accentColor: color })} />
          ))}
        </div>
      </fieldset>
    </>
  )
}

function PlayStep({ draft, set, errors }) {
  return (
    <>
      <fieldset className="guild-form__field">
        <legend>Play styles <em>up to five</em></legend>
        <div className="guild-chips">
          {Object.entries(PLAY_STYLE_LABELS).map(([value, label]) => (
            <button key={value} type="button" className={`guild-chip${draft.playStyles.includes(value) ? ' guild-chip--active' : ''}`}
              aria-pressed={draft.playStyles.includes(value)}
              disabled={!draft.playStyles.includes(value) && draft.playStyles.length >= 5}
              onClick={() => set({ playStyles: toggleValue(draft.playStyles, value) })}>{label}</button>
          ))}
        </div>
        <FieldError code={errors.playStyles} />
      </fieldset>

      <fieldset className="guild-form__field">
        <legend>Raid or event nights <em>optional</em></legend>
        <div className="guild-chips guild-chips--days">
          {Object.entries(WEEKDAY_LABELS).map(([value, label]) => (
            <button key={value} type="button" className={`guild-chip${draft.raidDays.includes(value) ? ' guild-chip--active' : ''}`}
              aria-pressed={draft.raidDays.includes(value)} onClick={() => set({ raidDays: toggleValue(draft.raidDays, value) })}>{label}</button>
          ))}
        </div>
      </fieldset>

      <div className="guild-form__row">
        <label className="guild-form__field">
          <span>Starts</span>
          <input type="time" value={draft.raidStart} onChange={(event) => set({ raidStart: event.target.value })} />
          <FieldError code={errors.raidStart} />
        </label>
        <label className="guild-form__field">
          <span>Ends</span>
          <input type="time" value={draft.raidEnd} onChange={(event) => set({ raidEnd: event.target.value })} />
        </label>
        <label className="guild-form__field">
          <span>Time zone</span>
          <input value={draft.timezone} maxLength={64} placeholder="America/Chicago" onChange={(event) => set({ timezone: event.target.value })} />
          <FieldError code={errors.timezone} />
        </label>
      </div>

      <div className="guild-form__row">
        <label className="guild-form__field">
          <span>Voice chat</span>
          <select value={draft.voiceRequired ? 'yes' : 'no'} onChange={(event) => set({ voiceRequired: event.target.value === 'yes' })}>
            <option value="no">Optional</option>
            <option value="yes">Required for raids</option>
          </select>
        </label>
        <label className="guild-form__field">
          <span>Age</span>
          <select value={draft.agePolicy} onChange={(event) => set({ agePolicy: event.target.value })}>
            <option value="any">All ages</option>
            <option value="adult">18+</option>
          </select>
        </label>
        <label className="guild-form__field">
          <span>Minimum level</span>
          <input type="number" min={1} max={60} value={draft.minimumLevel}
            onChange={(event) => set({ minimumLevel: Math.min(60, Math.max(1, Number.parseInt(event.target.value, 10) || 1)) })} />
        </label>
      </div>
    </>
  )
}

function RecruitingStep({ draft, set, errors, templateUrl }) {
  return (
    <>
      <label className="guild-switch guild-switch--inline">
        <input type="checkbox" checked={draft.recruiting} onChange={(event) => set({ recruiting: event.target.checked })} />
        <span className="guild-switch__track" aria-hidden="true"><span /></span>
        We&rsquo;re recruiting
      </label>

      {draft.recruiting ? (
        <>
          <fieldset className="guild-form__field">
            <legend>Classes you need <em>leave empty for everyone</em></legend>
            <div className="guild-classes guild-classes--wide">
              {Object.entries(CLASS_LABELS).map(([value, label]) => (
                <button key={value} type="button" className={`guild-class${draft.recruitingClasses.includes(value) ? ' guild-class--active' : ''}`}
                  style={{ '--class-color': classColor(value) }} aria-pressed={draft.recruitingClasses.includes(value)}
                  onClick={() => set({ recruitingClasses: toggleValue(draft.recruitingClasses, value) })}>
                  <span className="guild-class__swatch" aria-hidden="true" />{label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="guild-form__field">
            <legend>Roles</legend>
            <div className="guild-chips">
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <button key={value} type="button" className={`guild-chip${draft.recruitingRoles.includes(value) ? ' guild-chip--active' : ''}`}
                  aria-pressed={draft.recruitingRoles.includes(value)} onClick={() => set({ recruitingRoles: toggleValue(draft.recruitingRoles, value) })}>{label}</button>
              ))}
            </div>
          </fieldset>
        </>
      ) : null}

      <label className="guild-form__field">
        <span>About your guild</span>
        <textarea rows={6} maxLength={4000} value={draft.description}
          placeholder="What you value, what a typical week looks like, and who will feel at home."
          onChange={(event) => set({ description: event.target.value })} />
      </label>

      <section className="guild-discord">
        <div className="guild-discord__mark" aria-hidden="true">
          <svg width="28" height="22" viewBox="0 0 28 22"><path fill="currentColor" d="M23.7 1.8A23 23 0 0 0 18 0l-.7 1.5a21 21 0 0 0-6.4 0L10.2 0a23 23 0 0 0-5.8 1.8C.8 7.3-.2 12.6.3 17.9A23 23 0 0 0 7.4 21.5l1.4-2.3a15 15 0 0 1-2.3-1.1l.6-.4a16.4 16.4 0 0 0 14.1 0l.6.4c-.7.4-1.5.8-2.3 1.1l1.4 2.3a23 23 0 0 0 7-3.6c.6-6.2-1-11.4-4.2-16.1ZM9.4 14.7c-1.4 0-2.5-1.3-2.5-2.8s1.1-2.8 2.5-2.8 2.5 1.3 2.5 2.8-1.1 2.8-2.5 2.8Zm9.2 0c-1.4 0-2.5-1.3-2.5-2.8s1.1-2.8 2.5-2.8 2.5 1.3 2.5 2.8-1.1 2.8-2.5 2.8Z" /></svg>
        </div>
        <div className="guild-discord__body">
          <h3>Connect your Discord</h3>
          <p>Paste a permanent invite so players can join straight from your guild page.</p>
          <label className="guild-form__field">
            <span className="visually-hidden">Discord invite link</span>
            <input value={draft.discordInviteUrl} maxLength={200} placeholder="discord.gg/yourguild" onChange={(event) => set({ discordInviteUrl: event.target.value })} />
            <FieldError code={errors.discordInviteUrl} />
          </label>
          <p className="guild-discord__alt">
            No server yet?{' '}
            {templateUrl
              ? <><a href={templateUrl} target="_blank" rel="noreferrer noopener">Create one from the Guildweaver template</a> with raid, recruitment and officer channels ready to go, then paste its invite here.</>
              : <><a href="https://discord.com/" target="_blank" rel="noreferrer noopener">Create a free server on Discord</a> in a minute, then paste its invite here.</>}
          </p>
        </div>
      </section>
    </>
  )
}

function Gate({ title, children }) {
  return (
    <div className="guild-browser">
      <div className="guild-browser__backdrop" aria-hidden="true" />
      <div className="guild-browser__frame">
        <main className="guild-register__gate">
          <p className="guild-hero__eyebrow">Guildweaver · Register</p>
          <h1 className="guild-hero__title">{title}</h1>
          {children}
        </main>
        <Footer />
      </div>
    </div>
  )
}

export default function RegisterGuild() {
  const { status, authenticated, signIn } = useSession()
  const [membership, setMembership] = useState({ loading: true })
  const [templateUrl, setTemplateUrl] = useState('')
  const [draft, setDraft] = useState(registrationDraft)
  const [step, setStep] = useState(0)
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    fetch('/api/guilds/vocabulary').then((response) => (response.ok ? response.json() : null))
      .then((vocabulary) => setTemplateUrl(vocabulary?.discordTemplateUrl || '')).catch(() => {})
  }, [])

  useEffect(() => {
    if (!authenticated) return undefined
    const controller = new AbortController()
    apiJson('/api/guilds/mine', { signal: controller.signal })
      .then((body) => setMembership({ guild: body.guild }))
      .catch((error) => { if (error.name !== 'AbortError') setMembership({ guild: null }) })
    return () => controller.abort()
  }, [authenticated])

  function set(change) {
    setDraft((current) => ({ ...current, ...change }))
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !(key in change) && !(key === 'slug' && 'name' in change))))
  }

  function next() {
    const found = stepErrors(draft, step)
    setErrors(found)
    if (!Object.keys(found).length) setStep((current) => Math.min(STEPS.length - 1, current + 1))
  }

  async function submit(event) {
    event.preventDefault()
    if (step < STEPS.length - 1) { next(); return }
    setSubmitting(true)
    setFormError('')
    try {
      const body = await apiJson('/api/guilds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      navigate(guildPath(body.slug))
    } catch (error) {
      const fields = error.body?.fields || (error.body?.error === 'guild_slug_taken' ? { name: 'guild_slug_taken' } : null)
      if (fields) {
        setErrors(fields)
        setStep(Math.min(...Object.keys(fields).map((field) => FIELD_STEPS[field] ?? STEPS.length - 1)))
      } else if (error.body?.error === 'already_in_guild') {
        setMembership({ guild: { name: 'a guild' } })
      } else {
        setFormError('Your guild could not be registered. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function leave() {
    setLeaving(true)
    try {
      await apiJson('/api/guilds/mine/leave', { method: 'POST' })
      setMembership({ guild: null })
    } catch (error) {
      setFormError(error.body?.error === 'owner_must_transfer'
        ? 'You own this guild. Hand it to another officer before founding a new one.'
        : 'You could not leave your guild. Please try again.')
    } finally {
      setLeaving(false)
    }
  }

  if (status !== 'ready' && !authenticated) {
    return <Gate title="Register your guild."><div className="guild-page__loading" role="status" aria-label="Loading"><span /><span /><span /></div></Gate>
  }

  if (!authenticated) {
    return (
      <Gate title="Register your guild.">
        <p className="guild-hero__intro">List your guild in the directory, show players real activity from the Guildweaver addon, and send recruits straight to your Discord. Free.</p>
        <ul className="guild-register__perks">
          <li><strong>Be found</strong><span>Faction, realm type, play style and schedule filters put you in front of the right players.</span></li>
          <li><strong>Prove you&rsquo;re active</strong><span>Synced characters earn a verified badge, live activity and a real class mix.</span></li>
          <li><strong>Recruit on autopilot</strong><span>Applications and your Discord invite in one place.</span></li>
        </ul>
        <div className="guild-hero__actions">
          <button type="button" className="guild-hero__primary" onClick={() => signIn('/guilds/register')}>Sign in with Discord</button>
          <a className="guild-hero__secondary" href="/guilds">Browse guilds</a>
        </div>
      </Gate>
    )
  }

  if (membership.loading) {
    return <Gate title="Register your guild."><div className="guild-page__loading" role="status" aria-label="Loading"><span /><span /><span /></div></Gate>
  }

  if (membership.guild) {
    return (
      <Gate title="One guild at a time.">
        <p className="guild-hero__intro">
          You&rsquo;re a member of <strong>{membership.guild.name}</strong>. Players belong to one guild on Guildweaver, so leave it first to found your own.
        </p>
        {formError ? <p className="guild-form__error" role="alert">{formError}</p> : null}
        <div className="guild-hero__actions">
          {membership.guild.slug ? <a className="guild-hero__secondary" href={guildPath(membership.guild.slug)}>View {membership.guild.name}</a> : null}
          <button type="button" className="guild-hero__primary" disabled={leaving}
            onClick={() => { if (window.confirm(`Leave ${membership.guild.name}?`)) leave() }}>
            {leaving ? 'Leaving…' : `Leave ${membership.guild.name}`}
          </button>
        </div>
      </Gate>
    )
  }

  const preview = previewGuild(draft)
  return (
    <div className="guild-browser guild-register" style={{ '--guild-accent': draft.accentColor }}>
      <div className="guild-browser__backdrop guild-page__backdrop" aria-hidden="true" />
      <div className="guild-browser__frame">
        <main>
          <a className="guild-page__back" href="/guilds">← All guilds</a>
          <header className="guild-register__head">
            <p className="guild-hero__eyebrow">Guildweaver · Register</p>
            <h1>Register your guild</h1>
            <ol className="guild-steps">
              {STEPS.map((entry, index) => (
                <li key={entry.title} className={index === step ? 'guild-steps__current' : index < step ? 'guild-steps__done' : ''}>
                  <button type="button" disabled={index > step} onClick={() => setStep(index)} aria-label={`Step ${index + 1}: ${entry.title}`} aria-current={index === step ? 'step' : undefined}>
                    <span className="guild-steps__number">{index < step ? '✓' : index + 1}</span>
                    <span><strong>{entry.title}</strong><small>{entry.hint}</small></span>
                  </button>
                </li>
              ))}
            </ol>
          </header>

          <div className="guild-register__layout">
            <form className="guild-form" onSubmit={submit} noValidate>
              {step === 0 ? <IdentityStep draft={draft} set={set} errors={errors} /> : null}
              {step === 1 ? <PlayStep draft={draft} set={set} errors={errors} /> : null}
              {step === 2 ? <RecruitingStep draft={draft} set={set} errors={errors} templateUrl={templateUrl} /> : null}
              {formError ? <p className="guild-form__error" role="alert">{formError}</p> : null}
              <div className="guild-form__actions">
                {step > 0 ? <button type="button" className="guild-page__secondary" onClick={() => setStep(step - 1)}>Back</button> : <span />}
                <button type="submit" className="guild-page__primary" disabled={submitting}>
                  {step < STEPS.length - 1 ? 'Continue' : submitting ? 'Registering…' : 'Register guild'}
                </button>
              </div>
            </form>

            <aside className="guild-register__preview" aria-label="Preview">
              <p className="guild-register__preview-label">Live preview</p>
              <GuildCard guild={preview} preview />
              <p className="guild-panel__note">This is how players will see your guild in the directory. Install the Guildweaver addon to earn the verified badge.</p>
            </aside>
          </div>
        </main>
        <Footer />
      </div>
    </div>
  )
}
