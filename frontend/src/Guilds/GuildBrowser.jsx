import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../Auth/sessionContext.js'
import { Button, Select, Switch } from '../DesignSystem/index.js'
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
  SORT_LABELS,
  WEEKDAY_LABELS,
  activeFilterCount,
  activityShare,
  classColor,
  classMixSegments,
  emptyFilters,
  filtersFromQuery,
  finderHref,
  guildPath,
  lastActiveLabel,
  queryFromFilters,
  scheduleSummary,
  selectedGuildFromQuery,
  stepSelection,
  toggleValue,
  weekStrip,
} from './guildDirectoryModel.js'
import './GuildFinder.css'

const PAGE_SIZE = 40
const RETRY_DELAYS = [600, 1500, 3500, 8000]

function apiQuery(filters, offset = 0) {
  const params = new URLSearchParams(queryFromFilters(filters).slice(1))
  params.set('limit', String(PAGE_SIZE))
  if (offset) params.set('offset', String(offset))
  return params.toString()
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
  })
}

// Fetches JSON, retrying transient failures with backoff so a backend
// restart or a dropped request never shows the user an error page.
async function fetchWithRetry(url, signal) {
  let lastError
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt += 1) {
    try {
      const response = await fetch(url, { signal })
      if (response.status === 404) return { missing: true }
      if (response.ok) return { data: await response.json() }
      lastError = new Error(`Request failed (${response.status})`)
      if (response.status < 500 && response.status !== 429) throw lastError
    } catch (error) {
      if (error.name === 'AbortError' || error === lastError) throw error
      lastError = error
    }
    if (attempt < RETRY_DELAYS.length) await wait(RETRY_DELAYS[attempt], signal)
  }
  throw lastError
}

function isTyping(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

const applyPath = (slug) => `${guildPath(slug)}/about?apply=1`

function CloseIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
}

function VerifiedTick() {
  return (
    <svg className="finder-verified" width="13" height="14" viewBox="0 0 12 13" role="img" aria-label="Verified activity">
      <path d="M6 0 7.6 1.4 9.7 1.2 10.3 3.2 12 4.5 11.2 6.5 12 8.5 10.3 9.8 9.7 11.8 7.6 11.6 6 13 4.4 11.6 2.3 11.8 1.7 9.8 0 8.5.8 6.5 0 4.5 1.7 3.2 2.3 1.2 4.4 1.4Z" fill="currentColor" />
      <path d="m3.6 6.4 1.6 1.6 3.3-3.4" stroke="#07111f" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  )
}

/* Filter rail */

function CheckRow({ checked, count, onChange, children, tone }) {
  return (
    <label className={`finder-check${checked ? ' finder-check--on' : ''}`} data-tone={tone}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="finder-check__box" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="m2.5 6.2 2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span className="finder-check__label">{children}</span>
      {count !== undefined ? <span className="finder-check__count">{count}</span> : null}
    </label>
  )
}

function RailSection({ title, action, children }) {
  return (
    <section className="finder-rail__section">
      <header>
        <h3>{title}</h3>
        {action}
      </header>
      {children}
    </section>
  )
}

function FilterRail({ filters, facets, update, onClose }) {
  const count = activeFilterCount(filters)
  return (
    <>
      <div className="finder-rail__head">
        <h2>Filters</h2>
        {count ? <button type="button" className="finder-link" onClick={() => update(emptyFilters())}>Clear all</button> : null}
        {onClose ? <button type="button" className="finder-icon-button" onClick={onClose} aria-label="Close filters"><CloseIcon /></button> : null}
      </div>

      <div className="finder-rail__scroll">
        <RailSection title="Realm type">
          {Object.entries(REALM_TYPE_LABELS).map(([value, label]) => (
            <CheckRow key={value} tone={value} checked={filters.realmType.includes(value)} count={facets?.realmTypes?.[value]}
              onChange={() => update({ realmType: toggleValue(filters.realmType, value) })}>{label}</CheckRow>
          ))}
        </RailSection>

        <RailSection title="Play style">
          {Object.entries(PLAY_STYLE_LABELS).map(([value, label]) => (
            <CheckRow key={value} checked={filters.style.includes(value)} count={facets?.playStyles?.[value]}
              onChange={() => update({ style: toggleValue(filters.style, value) })}>{label}</CheckRow>
          ))}
        </RailSection>

        <RailSection title="Recruiting my class"
          action={filters.class ? <button type="button" className="finder-link" onClick={() => update({ class: '' })}>Any</button> : null}>
          <div className="finder-classes" role="group" aria-label="Class">
            {Object.entries(CLASS_LABELS).map(([value, label]) => (
              <button key={value} type="button" className="finder-class" aria-pressed={filters.class === value}
                style={{ '--class-color': classColor(value) }} onClick={() => update({ class: filters.class === value ? '' : value })}>
                <span className="finder-class__dot" aria-hidden="true" />{label}
              </button>
            ))}
          </div>
          <div className="finder-segmented finder-segmented--full" role="group" aria-label="Role">
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={filters.role === value}
                onClick={() => update({ role: filters.role === value ? '' : value })}>{label}</button>
            ))}
          </div>
        </RailSection>

        <RailSection title="Raid night">
          <div className="finder-week" role="group" aria-label="Raid night">
            {Object.entries(WEEKDAY_LABELS).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={filters.day === value} aria-label={label}
                onClick={() => update({ day: filters.day === value ? '' : value })}>{label.slice(0, 2)}</button>
            ))}
          </div>
        </RailSection>

        <RailSection title="Region & language">
          <div className="finder-rail__selects">
            <Select label="Region" size="sm" value={filters.region[0] || ''} placeholder="Any region" options={Object.entries(REGION_LABELS)}
              onChange={(event) => update({ region: event.target.value ? [event.target.value] : [] })} />
            <Select label="Language" size="sm" value={filters.language[0] || ''} placeholder="Any language" options={Object.entries(LANGUAGE_LABELS)}
              onChange={(event) => update({ language: event.target.value ? [event.target.value] : [] })} />
          </div>
        </RailSection>

        <RailSection title="Availability">
          <Switch label="Recruiting now" checked={filters.recruiting} onChange={(event) => update({ recruiting: event.target.checked })} />
        </RailSection>
      </div>
    </>
  )
}

/* Results */

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

function GuildRow({ guild, selected, onSelect }) {
  return (
    <li role="option" aria-selected={selected} id={`finder-row-${guild.slug}`}
      className={`finder-row${selected ? ' finder-row--selected' : ''}`} data-faction={guild.faction}
      style={{ '--guild-accent': guild.accentColor }} onClick={() => onSelect(guild.slug)}>
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

function SkeletonRows() {
  return (
    <ul className="finder-list" aria-hidden="true">
      {Array.from({ length: 10 }, (_, index) => (
        <li key={index} className="finder-row finder-row--skeleton">
          <span className="finder-skel finder-skel--crest" />
          <span className="finder-row__identity"><span className="finder-skel finder-skel--title" /><span className="finder-skel finder-skel--line" /></span>
          <span className="finder-skel finder-skel--line" /><span className="finder-skel finder-skel--line" />
        </li>
      ))}
    </ul>
  )
}

/* Detail */

function DetailEmpty() {
  return (
    <div className="finder-detail__empty">
      <svg width="48" height="56" viewBox="0 0 100 115" aria-hidden="true"><path d="M50 3 L94 16 V54 C94 82 74 101 50 112 C26 101 6 82 6 54 V16 Z" fill="none" stroke="currentColor" strokeWidth="3" /></svg>
      <p>Select a guild to see its roster, schedule and what it&rsquo;s recruiting.</p>
      <p className="finder-keys"><kbd>↑</kbd><kbd>↓</kbd> browse <kbd>Enter</kbd> open <kbd>/</kbd> search</p>
    </div>
  )
}

function DetailPane({ slug, summary, onClose, authenticated, signIn }) {
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchWithRetry(`/api/guilds/${encodeURIComponent(slug)}`, controller.signal)
      .then((result) => setDetail({ guild: result.data?.guild || null, missing: Boolean(result.missing) }))
      .catch((error) => { if (error.name !== 'AbortError') setDetail({ guild: null, error: true }) })
    return () => controller.abort()
  }, [slug])

  const guild = detail?.guild || summary
  if (!guild) {
    return (
      <div className="finder-detail__empty">
        {detail?.missing ? <p>This guild is no longer listed.</p> : detail?.error ? <p>This guild could not be loaded.</p> : <span className="finder-spinner" aria-label="Loading guild" />}
      </div>
    )
  }

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
    <article className="finder-detail__card" data-faction={guild.faction} style={{ '--guild-accent': guild.accentColor }} aria-label={guild.name}>
      <header className="finder-detail__head">
        <span className="finder-detail__glow" aria-hidden="true" />
        <button type="button" className="finder-icon-button finder-detail__close" onClick={onClose} aria-label="Close guild details"><CloseIcon /></button>
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
        <div className="finder-detail__actions">
          <Button variant="primary" size="sm" href={guildPath(guild.slug)}>Visit guild</Button>
          {guild.recruiting ? (
            <Button size="sm" onClick={() => (authenticated ? navigate(applyPath(guild.slug)) : signIn(applyPath(guild.slug)))}>Apply</Button>
          ) : null}
          {guild.discordInviteUrl ? (
            <a className="finder-icon-button finder-discord" href={guild.discordInviteUrl} target="_blank" rel="noreferrer noopener" aria-label="Join their Discord" title="Join their Discord">
              <svg width="20" height="16" viewBox="0 0 28 22" aria-hidden="true"><path fill="currentColor" d="M23.7 1.8A23 23 0 0 0 18 0l-.7 1.5a21 21 0 0 0-6.4 0L10.2 0a23 23 0 0 0-5.8 1.8C.8 7.3-.2 12.6.3 17.9A23 23 0 0 0 7.4 21.5l1.4-2.3a15 15 0 0 1-2.3-1.1l.6-.4a16.4 16.4 0 0 0 14.1 0l.6.4c-.7.4-1.5.8-2.3 1.1l1.4 2.3a23 23 0 0 0 7-3.6c.6-6.2-1-11.4-4.2-16.1ZM9.4 14.7c-1.4 0-2.5-1.3-2.5-2.8s1.1-2.8 2.5-2.8 2.5 1.3 2.5 2.8-1.1 2.8-2.5 2.8Zm9.2 0c-1.4 0-2.5-1.3-2.5-2.8s1.1-2.8 2.5-2.8 2.5 1.3 2.5 2.8-1.1 2.8-2.5 2.8Z" /></svg>
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

        {detail?.guild?.sisters?.length ? (
          <section className="finder-section">
            <h3>Sister guilds</h3>
            <ul className="finder-sisters">
              {detail.guild.sisters.map((sister) => (
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

/* Finder */

export default function GuildBrowser({ queryString = '' }) {
  const filters = useMemo(() => filtersFromQuery(queryString), [queryString])
  const selected = selectedGuildFromQuery(queryString)
  const { authenticated, signIn } = useSession()
  const [result, setResult] = useState({ loading: true, guilds: [], total: 0 })
  const [loadingMore, setLoadingMore] = useState(false)
  const [railOpen, setRailOpen] = useState(false)
  const [retry, setRetry] = useState(0)
  const searchRef = useRef(null)
  const listRef = useRef(null)
  const sentinelRef = useRef(null)
  const query = apiQuery(filters)

  useEffect(() => {
    const controller = new AbortController()
    setResult((current) => ({ ...current, loading: true, error: false }))
    fetchWithRetry(`/api/guilds?${query}`, controller.signal)
      .then(({ data }) => setResult({ loading: false, guilds: data.guilds, total: data.total, facets: data.facets, hasMore: data.pagination.hasMore }))
      .catch((error) => { if (error.name !== 'AbortError') setResult((current) => ({ ...current, loading: false, error: true })) })
    return () => controller.abort()
  }, [query, retry])

  const go = useCallback((nextFilters, nextSelected) => {
    navigate(finderHref(nextFilters, nextSelected), { replace: true, preserveScroll: true })
  }, [])
  const update = useCallback((change) => go({ ...filters, ...change }, selected), [filters, selected, go])
  const select = useCallback((slug) => go(filters, slug), [filters, go])

  const loadMore = useCallback(async () => {
    if (loadingMore || !result.hasMore) return
    setLoadingMore(true)
    try {
      const { data } = await fetchWithRetry(`/api/guilds?${apiQuery(filters, result.guilds.length)}`)
      setResult((current) => ({ ...current, guilds: [...current.guilds, ...data.guilds], hasMore: data.pagination.hasMore }))
    } catch {
      // The sentinel stays in view, so the next scroll tries again.
    } finally {
      setLoadingMore(false)
    }
  }, [filters, loadingMore, result.guilds.length, result.hasMore])

  // Infinite scroll inside the results pane.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !result.hasMore) return undefined
    const observer = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) loadMore() }, { root: listRef.current, rootMargin: '240px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore, result.hasMore])

  // Keyboard: / searches, arrows (or j/k) browse, Enter opens, Esc backs out.
  const slugs = useMemo(() => result.guilds.map((guild) => guild.slug), [result.guilds])
  useEffect(() => {
    function onKey(event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '/' && !isTyping(event.target)) {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (event.key === 'Escape') {
        if (railOpen) setRailOpen(false)
        else if (isTyping(event.target)) event.target.blur()
        else if (selected) select('')
        return
      }
      if (isTyping(event.target)) return
      const down = event.key === 'ArrowDown' || event.key === 'j'
      const up = event.key === 'ArrowUp' || event.key === 'k'
      if (down || up) {
        event.preventDefault()
        const next = stepSelection(slugs, selected, down ? 1 : -1)
        if (next) {
          select(next)
          document.getElementById(`finder-row-${next}`)?.scrollIntoView({ block: 'nearest' })
        }
        return
      }
      if (event.key === 'Enter' && selected && !(event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement)) {
        navigate(guildPath(selected))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [railOpen, select, selected, slugs])

  const filterCount = activeFilterCount(filters)
  const selectedSummary = result.guilds.find((guild) => guild.slug === selected) || null
  const factionValue = filters.faction.length === 1 ? filters.faction[0] : ''

  return (
    <div className={`finder${selected ? ' finder--selected' : ''}${railOpen ? ' finder--rail-open' : ''}`}>
      <aside className="finder-rail" aria-label="Filters">
        <FilterRail filters={filters} facets={result.facets} update={update} onClose={railOpen ? () => setRailOpen(false) : null} />
        <div className="finder-rail__foot">
          <Button variant="primary" size="sm" block href="/register">Register your guild</Button>
          <a className="finder-link" href="/guildweaver">Get the addon to verify activity →</a>
        </div>
      </aside>
      {railOpen ? <button type="button" className="finder-scrim" aria-label="Close filters" onClick={() => setRailOpen(false)} /> : null}

      <section className="finder-main" aria-label="Guilds">
        <div className="finder-toolbar">
          <button type="button" className="finder-icon-button finder-toolbar__filters" onClick={() => setRailOpen(true)}
            aria-label={`Filters${filterCount ? `, ${filterCount} active` : ''}`}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 4h14M5 9h8M7.5 14h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            {filterCount ? <span className="finder-count-dot">{filterCount}</span> : null}
          </button>
          <form className="finder-search" role="search" onSubmit={(event) => {
            event.preventDefault()
            update({ q: String(new FormData(event.currentTarget).get('q') || '').trim() })
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" fill="none" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <input ref={searchRef} name="q" type="search" placeholder="Search guilds, realms, mottos" defaultValue={filters.q} key={filters.q}
              maxLength={64} aria-label="Search guilds" />
            <kbd aria-hidden="true">/</kbd>
          </form>
          <div className="finder-segmented finder-toolbar__faction" role="group" aria-label="Faction">
            <button type="button" aria-pressed={!factionValue} onClick={() => update({ faction: [] })}>All<span>{result.facets?.total ?? ''}</span></button>
            {Object.entries(FACTION_LABELS).map(([value, label]) => (
              <button key={value} type="button" data-faction={value} aria-pressed={factionValue === value}
                onClick={() => update({ faction: factionValue === value ? [] : [value] })}>
                <i aria-hidden="true" />{label}<span>{result.facets?.factions?.[value] ?? ''}</span>
              </button>
            ))}
          </div>
          <label className="finder-sort">
            <span>Sort</span>
            <select value={filters.sort} onChange={(event) => update({ sort: event.target.value })}>
              {Object.entries(SORT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><path d="m3 5 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </label>
        </div>

        <div className="finder-status" aria-live="polite">
          <span>
            <strong>{result.total.toLocaleString()}</strong> {result.total === 1 ? 'guild' : 'guilds'}
            {filterCount ? <> · <button type="button" className="finder-link" onClick={() => update(emptyFilters())}>clear {filterCount} {filterCount === 1 ? 'filter' : 'filters'}</button></> : null}
          </span>
          {result.loading && result.guilds.length ? <span className="finder-progress" role="progressbar" aria-label="Updating results" /> : null}
        </div>

        <div className="finder-table" ref={listRef}>
          <div className="finder-table__head" aria-hidden="true">
            <span /><span>Guild</span><span>Play style</span><span>Recruiting</span><span>Raid nights</span><span>Members</span><span>Active / wk</span>
          </div>
          {result.error && !result.guilds.length ? (
            <div className="finder-empty" role="alert">
              <h3>The directory is unreachable</h3>
              <p>We tried a few times. Check your connection and try again.</p>
              <Button onClick={() => setRetry((value) => value + 1)}>Try again</Button>
            </div>
          ) : result.loading && !result.guilds.length ? <SkeletonRows /> : result.guilds.length ? (
            <>
              <ul className={`finder-list${result.loading ? ' finder-list--stale' : ''}`} role="listbox" aria-label="Guilds"
                aria-activedescendant={selected ? `finder-row-${selected}` : undefined} tabIndex={0}>
                {result.guilds.map((guild) => <GuildRow key={guild.id} guild={guild} selected={guild.slug === selected} onSelect={select} />)}
              </ul>
              {result.hasMore ? <div ref={sentinelRef} className="finder-more">{loadingMore ? <span className="finder-spinner" aria-label="Loading more guilds" /> : null}</div> : null}
            </>
          ) : (
            <div className="finder-empty">
              <h3>No guilds match</h3>
              <p>{filterCount ? 'Try removing a filter.' : 'No guilds are listed yet.'} Run a guild? List it in a few minutes.</p>
              <div>
                {filterCount ? <Button onClick={() => update(emptyFilters())}>Clear filters</Button> : null}
                <Button variant="primary" href="/register">Register your guild</Button>
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="finder-detail" aria-label="Guild details">
        {selected
          ? <DetailPane key={selected} slug={selected} summary={selectedSummary} authenticated={authenticated} signIn={signIn} onClose={() => select('')} />
          : <DetailEmpty />}
      </aside>
      {selected ? <button type="button" className="finder-scrim finder-scrim--detail" aria-label="Close guild details" onClick={() => select('')} /> : null}
    </div>
  )
}
