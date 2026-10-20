import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../Auth/sessionContext.js'
import { Button, Select, Switch } from '../DesignSystem/index.js'
import { navigate } from '../Navigation/navigation.js'
import { CloseIcon, GuildDetailCard, GuildRow } from './FinderParts.jsx'
import {
  CLASS_LABELS,
  FACTION_LABELS,
  LANGUAGE_LABELS,
  PLAY_STYLE_LABELS,
  REALM_TYPE_LABELS,
  REGION_LABELS,
  ROLE_LABELS,
  SORT_LABELS,
  WEEKDAY_LABELS,
  activeFilterCount,
  classColor,
  emptyFilters,
  filtersFromQuery,
  finderHref,
  guildPath,
  queryFromFilters,
  selectedGuildFromQuery,
  stepSelection,
  toggleValue,
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

  return <GuildDetailCard guild={guild} sisters={detail?.guild?.sisters} onClose={onClose} authenticated={authenticated} signIn={signIn} />
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
