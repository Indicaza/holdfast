import { useEffect, useRef, useState } from 'react'
import { apiJson } from '../Api/apiClient.js'
import { useSession } from '../Auth/sessionContext.js'
import { Button, Select, Switch, TextArea, TextInput, ToggleChip } from '../DesignSystem/index.js'
import { navigate } from '../Navigation/navigation.js'
import { CloseIcon, GuildDetailCard, GuildRow } from './FinderParts.jsx'
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
  firstInvalidStep,
  guildPath,
  previewGuild,
  registrationDraft,
  registrationProgress,
  stepErrors,
  toggleValue,
} from './guildDirectoryModel.js'
import './Guilds.css'
import './RegisterGuild.css'

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

function errorText(code) {
  return code ? FIELD_ERRORS[code] || 'Check this field.' : undefined
}

function FieldError({ code }) {
  return code ? <p className="ds-field__error" role="alert">{errorText(code)}</p> : null
}

function Choice({ active, onClick, children, tone, faction, label }) {
  return (
    <button type="button" className={`guild-choice${active ? ' guild-choice--active' : ''}${tone ? ` guild-choice--${tone}` : ''}${faction ? ' guild-choice--faction' : ''}`}
      data-faction={faction} aria-pressed={active} aria-label={label} onClick={onClick}>
      {children}
    </button>
  )
}

function IdentityStep({ draft, set, errors }) {
  const slug = draftSlug(draft.name)
  return (
    <>
      <TextInput label="Guild name" size="lg" value={draft.name} maxLength={48} autoFocus placeholder="Ashen Vanguard"
        hint={`${window.location.host}${guildPath(slug || 'your-guild')}`} error={errorText(errors.name || errors.slug)}
        onChange={(event) => set({ name: event.target.value })} />
      <TextInput label="Motto" value={draft.tagline} maxLength={120} placeholder="One line that says who you are."
        onChange={(event) => set({ tagline: event.target.value })} />

      <fieldset className="guild-form__group">
        <legend>Faction</legend>
        <div className="guild-form__factions">
          {Object.entries(FACTION_LABELS).map(([value, label]) => (
            <Choice key={value} faction={value} label={label} active={draft.faction === value} onClick={() => set({ faction: value })}>
              <strong>{label}</strong>
            </Choice>
          ))}
        </div>
        <FieldError code={errors.faction} />
      </fieldset>

      <div className="guild-form__row">
        <Select label="Region" value={draft.region} options={Object.entries(REGION_LABELS)} onChange={(event) => set({ region: event.target.value })} />
        <TextInput label="Realm" value={draft.realm} maxLength={48} placeholder="Doomhowl" error={errorText(errors.realm)}
          onChange={(event) => set({ realm: event.target.value })} />
        <Select label="Language" value={draft.language} options={Object.entries(LANGUAGE_LABELS)} onChange={(event) => set({ language: event.target.value })} />
      </div>

      <fieldset className="guild-form__group">
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

      <fieldset className="guild-form__group">
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
      <fieldset className="guild-form__group">
        <legend>Play styles <em>up to five</em></legend>
        <div className="guild-chips">
          {Object.entries(PLAY_STYLE_LABELS).map(([value, label]) => (
            <ToggleChip key={value} pressed={draft.playStyles.includes(value)}
              disabled={!draft.playStyles.includes(value) && draft.playStyles.length >= 5}
              onClick={() => set({ playStyles: toggleValue(draft.playStyles, value) })}>{label}</ToggleChip>
          ))}
        </div>
        <FieldError code={errors.playStyles} />
      </fieldset>

      <fieldset className="guild-form__group">
        <legend>Raid or event nights <em>optional</em></legend>
        <div className="guild-chips guild-chips--days">
          {Object.entries(WEEKDAY_LABELS).map(([value, label]) => (
            <ToggleChip key={value} pressed={draft.raidDays.includes(value)} onClick={() => set({ raidDays: toggleValue(draft.raidDays, value) })}>{label}</ToggleChip>
          ))}
        </div>
      </fieldset>

      <div className="guild-form__row">
        <TextInput label="Starts" type="time" value={draft.raidStart} error={errorText(errors.raidStart)} onChange={(event) => set({ raidStart: event.target.value })} />
        <TextInput label="Ends" type="time" value={draft.raidEnd} onChange={(event) => set({ raidEnd: event.target.value })} />
        <TextInput label="Time zone" value={draft.timezone} maxLength={64} placeholder="America/Chicago" error={errorText(errors.timezone)}
          onChange={(event) => set({ timezone: event.target.value })} />
      </div>

      <div className="guild-form__row">
        <Select label="Voice chat" value={draft.voiceRequired ? 'yes' : 'no'} options={[['no', 'Optional'], ['yes', 'Required for raids']]}
          onChange={(event) => set({ voiceRequired: event.target.value === 'yes' })} />
        <Select label="Age" value={draft.agePolicy} options={[['any', 'All ages'], ['adult', '18+']]} onChange={(event) => set({ agePolicy: event.target.value })} />
        <TextInput label="Minimum level" type="number" min={1} max={60} value={draft.minimumLevel}
          onChange={(event) => set({ minimumLevel: Math.min(60, Math.max(1, Number.parseInt(event.target.value, 10) || 1)) })} />
      </div>
    </>
  )
}

function RecruitingStep({ draft, set, errors, templateUrl }) {
  return (
    <>
      <Switch label="We’re recruiting" checked={draft.recruiting} onChange={(event) => set({ recruiting: event.target.checked })} />

      {draft.recruiting ? (
        <>
          <fieldset className="guild-form__group">
            <legend>Classes you need <em>leave empty for everyone</em></legend>
            <div className="guild-classes guild-classes--wide">
              {Object.entries(CLASS_LABELS).map(([value, label]) => (
                <ToggleChip key={value} className="guild-classes__chip" color={classColor(value)} pressed={draft.recruitingClasses.includes(value)}
                  onClick={() => set({ recruitingClasses: toggleValue(draft.recruitingClasses, value) })}>{label}</ToggleChip>
              ))}
            </div>
          </fieldset>
          <fieldset className="guild-form__group">
            <legend>Roles</legend>
            <div className="guild-chips">
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <ToggleChip key={value} pressed={draft.recruitingRoles.includes(value)}
                  onClick={() => set({ recruitingRoles: toggleValue(draft.recruitingRoles, value) })}>{label}</ToggleChip>
              ))}
            </div>
          </fieldset>
        </>
      ) : null}

      <TextArea label="About your guild" rows={6} maxLength={4000} value={draft.description}
        placeholder="What you value, what a typical week looks like, and who will feel at home."
        onChange={(event) => set({ description: event.target.value })} />

      <section className="guild-discord">
        <div className="guild-discord__mark" aria-hidden="true">
          <svg width="28" height="22" viewBox="0 0 28 22"><path fill="currentColor" d="M23.7 1.8A23 23 0 0 0 18 0l-.7 1.5a21 21 0 0 0-6.4 0L10.2 0a23 23 0 0 0-5.8 1.8C.8 7.3-.2 12.6.3 17.9A23 23 0 0 0 7.4 21.5l1.4-2.3a15 15 0 0 1-2.3-1.1l.6-.4a16.4 16.4 0 0 0 14.1 0l.6.4c-.7.4-1.5.8-2.3 1.1l1.4 2.3a23 23 0 0 0 7-3.6c.6-6.2-1-11.4-4.2-16.1ZM9.4 14.7c-1.4 0-2.5-1.3-2.5-2.8s1.1-2.8 2.5-2.8 2.5 1.3 2.5 2.8-1.1 2.8-2.5 2.8Zm9.2 0c-1.4 0-2.5-1.3-2.5-2.8s1.1-2.8 2.5-2.8 2.5 1.3 2.5 2.8-1.1 2.8-2.5 2.8Z" /></svg>
        </div>
        <div className="guild-discord__body">
          <h3>Connect your Discord</h3>
          <p>Paste a permanent invite so players can join straight from your guild page.</p>
          <TextInput label="Discord invite link" hideLabel value={draft.discordInviteUrl} maxLength={200} placeholder="discord.gg/yourguild"
            error={errorText(errors.discordInviteUrl)} onChange={(event) => set({ discordInviteUrl: event.target.value })} />
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

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function CheckIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 6.2 2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

// The signed-out pitch, the loading state and the one-guild gate: a compact
// panel in the middle of the workspace instead of a page of its own.
function GatePanel({ title, eyebrow = 'Register your guild', children }) {
  return (
    <div className="reg reg--gate">
      <section className="reg-dialog" role="dialog" aria-labelledby="reg-dialog-title">
        <p className="reg-dialog__eyebrow">{eyebrow}</p>
        <h1 id="reg-dialog-title">{title}</h1>
        {children}
      </section>
    </div>
  )
}

function Loading() {
  return <div className="reg reg--gate"><span className="finder-spinner" role="status" aria-label="Loading" /></div>
}

const PERKS = [
  ['Be found', 'Faction, realm type, play style and schedule filters put you in front of the right players.'],
  ['Prove you’re active', 'Synced characters earn a verified badge, live activity and a real class mix.'],
  ['Recruit on autopilot', 'Applications and your Discord invite in one place.'],
]

function StepRail({ step, reached, draft, errorSteps, progress, onStep }) {
  const percent = Math.round((progress.done / progress.total) * 100)
  return (
    <aside className="reg-rail" aria-label="Registration steps">
      <div className="reg-rail__head">
        <a className="finder-link reg-rail__back" href="/"><span aria-hidden="true">←</span> All guilds</a>
        <h1>Register your guild</h1>
      </div>
      <div className="reg-progress">
        <div className="reg-progress__label"><span>Required fields</span><strong>{progress.done} / {progress.total}</strong></div>
        <div className="reg-progress__bar" role="progressbar" aria-label="Required fields complete" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>
      <ol className="reg-steps">
        {STEPS.map((entry, index) => {
          const done = index < step || (index <= reached && !Object.keys(stepErrors(draft, index)).length)
          const state = errorSteps.has(index) ? 'error' : index === step ? 'current' : done ? 'done' : 'todo'
          return (
            <li key={entry.title} className={`reg-step reg-step--${state}${index === step ? ' reg-step--active' : ''}`}>
              <button type="button" onClick={() => onStep(index)} aria-current={index === step ? 'step' : undefined}
                aria-label={`Step ${index + 1}: ${entry.title}${state === 'error' ? ', needs attention' : state === 'done' ? ', done' : ''}`}>
                <span className="reg-step__marker">{state === 'done' ? <CheckIcon /> : state === 'error' ? '!' : index + 1}</span>
                <span className="reg-step__text"><strong>{entry.title}</strong><small>{state === 'error' ? 'Needs attention' : entry.hint}</small></span>
              </button>
            </li>
          )
        })}
      </ol>
      <div className="reg-rail__foot">
        <p>Listing is free. You can edit everything later from your guild page.</p>
        <a className="finder-link" href="/guildweaver">Get the addon to verify activity →</a>
      </div>
    </aside>
  )
}

function PreviewPane({ guild, onClose }) {
  return (
    <aside className="reg-preview" aria-label="Preview">
      <div className="reg-preview__head">
        <h2>Live preview</h2>
        <span className="reg-preview__hint">As players see it</span>
        <button type="button" className="finder-icon-button reg-preview__close" onClick={onClose} aria-label="Close preview"><CloseIcon /></button>
      </div>
      <p className="reg-preview__label">Directory row</p>
      <div className="finder-table reg-preview__table">
        <ul className="finder-list" role="listbox" aria-label="Directory row preview">
          <GuildRow guild={guild} selected />
        </ul>
      </div>
      <p className="reg-preview__label">Guild details</p>
      <div className="reg-preview__detail">
        <GuildDetailCard guild={guild} preview />
      </div>
    </aside>
  )
}

export default function RegisterGuild() {
  const { status, authenticated, signIn } = useSession()
  const [membership, setMembership] = useState({ loading: true })
  const [templateUrl, setTemplateUrl] = useState('')
  const [draft, setDraft] = useState(registrationDraft)
  const [step, setStep] = useState(0)
  const [reached, setReached] = useState(0)
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [leaving, setLeaving] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const scrollRef = useRef(null)
  const titleRef = useRef(null)
  const stepChanged = useRef(false)

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

  // A new step starts at the top of its pane, with focus on its heading.
  useEffect(() => {
    if (!stepChanged.current) return
    stepChanged.current = false
    scrollRef.current?.scrollTo({ top: 0 })
    titleRef.current?.focus({ preventScroll: true })
  }, [step])

  useEffect(() => {
    if (!previewOpen) return undefined
    const onKey = (event) => { if (event.key === 'Escape') setPreviewOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewOpen])

  function showStep(index) {
    if (index !== step) stepChanged.current = true
    setStep(index)
    setReached((current) => Math.max(current, index))
  }

  function set(change) {
    setDraft((current) => ({ ...current, ...change }))
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !(key in change) && !(key === 'slug' && 'name' in change))))
  }

  // Checks every step before `index`, and opens the first that fails.
  function validateBefore(index) {
    const invalid = firstInvalidStep(draft, 0, index)
    if (invalid === -1) { setErrors({}); return true }
    setErrors(stepErrors(draft, invalid))
    showStep(invalid)
    return false
  }

  // Moving forward checks every step on the way; moving back never does.
  function goTo(index) {
    if (index <= step || validateBefore(index)) showStep(index)
  }

  async function submit(event) {
    event.preventDefault()
    if (step < STEPS.length - 1) { goTo(step + 1); return }
    if (!validateBefore(STEPS.length)) return
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
        setPreviewOpen(false)
        showStep(Math.min(...Object.keys(fields).map((field) => FIELD_STEPS[field] ?? STEPS.length - 1)))
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

  if (status !== 'ready' && !authenticated) return <Loading />

  if (!authenticated) {
    return (
      <GatePanel title="List your guild in a few minutes.">
        <p className="reg-dialog__intro">Get found in the directory, show real activity from the Guildweaver addon, and send recruits straight to your Discord. Free.</p>
        <ul className="reg-dialog__perks">
          {PERKS.map(([title, text]) => (
            <li key={title}><span className="reg-dialog__tick" aria-hidden="true"><CheckIcon /></span><span><strong>{title}</strong>{text}</span></li>
          ))}
        </ul>
        <div className="reg-dialog__actions">
          <Button variant="primary" onClick={() => signIn('/register')}>Sign in with Discord</Button>
          <Button variant="ghost" href="/">Browse guilds</Button>
        </div>
      </GatePanel>
    )
  }

  if (membership.loading) return <Loading />

  if (membership.guild) {
    return (
      <GatePanel title="One guild at a time.">
        <p className="reg-dialog__intro">
          You&rsquo;re a member of <strong>{membership.guild.name}</strong>. Players belong to one guild on Guildweaver, so leave it first to found your own.
        </p>
        {formError ? <p className="guild-alert" role="alert">{formError}</p> : null}
        <div className="reg-dialog__actions">
          {membership.guild.slug ? <Button href={guildPath(membership.guild.slug)}>View {membership.guild.name}</Button> : null}
          <Button variant="danger" loading={leaving}
            onClick={() => { if (window.confirm(`Leave ${membership.guild.name}?`)) leave() }}>
            {leaving ? 'Leaving…' : `Leave ${membership.guild.name}`}
          </Button>
        </div>
      </GatePanel>
    )
  }

  const preview = previewGuild(draft)
  const errorSteps = new Set(Object.keys(errors).map((field) => FIELD_STEPS[field] ?? STEPS.length - 1))
  const last = step === STEPS.length - 1
  const submitLabel = last ? (submitting ? 'Registering…' : 'Register guild') : 'Continue'

  return (
    <div className={`reg${previewOpen ? ' reg--preview-open' : ''}`}>
      <StepRail step={step} reached={reached} draft={draft} errorSteps={errorSteps} progress={registrationProgress(draft)} onStep={goTo} />

      <form className="reg-main" onSubmit={submit} noValidate aria-labelledby="reg-step-title">
        <header className="reg-toolbar">
          <div className="reg-toolbar__title">
            <p>Step {step + 1} of {STEPS.length}</p>
            <h2 id="reg-step-title" ref={titleRef} tabIndex={-1}>{STEPS[step].title}</h2>
          </div>
          <span className="reg-toolbar__hint">{STEPS[step].hint}</span>
          <button type="button" className="finder-icon-button reg-toolbar__preview" onClick={() => setPreviewOpen(true)} aria-label="Show preview" title="Show preview">
            <EyeIcon />
          </button>
        </header>

        <div className="reg-scroll" ref={scrollRef}>
          <div className="reg-fields" key={step}>
            {step === 0 ? <IdentityStep draft={draft} set={set} errors={errors} /> : null}
            {step === 1 ? <PlayStep draft={draft} set={set} errors={errors} /> : null}
            {step === 2 ? <RecruitingStep draft={draft} set={set} errors={errors} templateUrl={templateUrl} /> : null}
            {formError ? <p className="guild-alert" role="alert">{formError}</p> : null}
          </div>
        </div>

        <footer className="reg-actions">
          {step > 0 ? <Button onClick={() => showStep(step - 1)}>Back</Button> : <Button variant="ghost" href="/">Cancel</Button>}
          <Button className="reg-actions__preview" icon={<EyeIcon />} onClick={() => setPreviewOpen(true)}>Preview</Button>
          <Button type="submit" variant="primary" loading={submitting}>{submitLabel}</Button>
        </footer>
      </form>

      <PreviewPane guild={preview} onClose={() => setPreviewOpen(false)} />
      {previewOpen ? <button type="button" className="finder-scrim reg-scrim" aria-label="Close preview" onClick={() => setPreviewOpen(false)} /> : null}
    </div>
  )
}
