import { useEffect, useState } from 'react'
import Footer from '../Home/Footer/Footer.jsx'
import { navigate } from '../Navigation/navigation.js'
import GuildCard from './GuildCard.jsx'
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
  queryFromFilters,
  toggleValue,
} from './guildDirectoryModel.js'
import './Guilds.css'

function apiQuery(filters, offset) {
  const params = new URLSearchParams(queryFromFilters(filters).slice(1))
  if (offset) params.set('offset', String(offset))
  return params.toString()
}

function Chip({ active, onClick, children, count, tone }) {
  return (
    <button
      type="button"
      className={`guild-chip${active ? ' guild-chip--active' : ''}${tone ? ` guild-chip--${tone}` : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
      {count !== undefined ? <span className="guild-chip__count">{count}</span> : null}
    </button>
  )
}

function FilterSection({ title, children }) {
  return (
    <section className="guild-filters__section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function Filters({ filters, facets, update, onClear }) {
  const count = activeFilterCount(filters)
  return (
    <div className="guild-filters">
      <div className="guild-filters__head">
        <h2>Refine</h2>
        {count ? <button type="button" className="guild-filters__clear" onClick={onClear}>Clear {count}</button> : null}
      </div>

      <FilterSection title="Realm type">
        <div className="guild-chips">
          {Object.entries(REALM_TYPE_LABELS).map(([value, label]) => (
            <Chip key={value} active={filters.realmType.includes(value)} count={facets?.realmTypes?.[value]}
              onClick={() => update({ realmType: toggleValue(filters.realmType, value) })}>{label}</Chip>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Play style">
        <div className="guild-chips">
          {Object.entries(PLAY_STYLE_LABELS).map(([value, label]) => (
            <Chip key={value} active={filters.style.includes(value)} count={facets?.playStyles?.[value]}
              onClick={() => update({ style: toggleValue(filters.style, value) })}>{label}</Chip>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Recruiting my class">
        <div className="guild-classes">
          {Object.entries(CLASS_LABELS).map(([value, label]) => (
            <button key={value} type="button" className={`guild-class${filters.class === value ? ' guild-class--active' : ''}`}
              style={{ '--class-color': classColor(value) }} aria-pressed={filters.class === value}
              onClick={() => update({ class: filters.class === value ? '' : value })}>
              <span className="guild-class__swatch" aria-hidden="true" />{label}
            </button>
          ))}
        </div>
        <div className="guild-chips guild-chips--roles">
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <Chip key={value} active={filters.role === value} onClick={() => update({ role: filters.role === value ? '' : value })}>{label}</Chip>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Raid night">
        <div className="guild-chips guild-chips--days">
          {Object.entries(WEEKDAY_LABELS).map(([value, label]) => (
            <Chip key={value} active={filters.day === value} onClick={() => update({ day: filters.day === value ? '' : value })}>{label}</Chip>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Region & language">
        <div className="guild-selects">
          <label>
            <span>Region</span>
            <select value={filters.region[0] || ''} onChange={(event) => update({ region: event.target.value ? [event.target.value] : [] })}>
              <option value="">Any region</option>
              {Object.entries(REGION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            <span>Language</span>
            <select value={filters.language[0] || ''} onChange={(event) => update({ language: event.target.value ? [event.target.value] : [] })}>
              <option value="">Any language</option>
              {Object.entries(LANGUAGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
      </FilterSection>

      <label className="guild-switch">
        <input type="checkbox" checked={filters.recruiting} onChange={(event) => update({ recruiting: event.target.checked })} />
        <span className="guild-switch__track" aria-hidden="true"><span /></span>
        Only guilds recruiting now
      </label>
    </div>
  )
}

function ActivePills({ filters, update }) {
  const pills = [
    ...filters.faction.map((value) => ({ key: `f-${value}`, label: FACTION_LABELS[value], clear: { faction: toggleValue(filters.faction, value) } })),
    ...filters.realmType.map((value) => ({ key: `r-${value}`, label: REALM_TYPE_LABELS[value], clear: { realmType: toggleValue(filters.realmType, value) } })),
    ...filters.style.map((value) => ({ key: `s-${value}`, label: PLAY_STYLE_LABELS[value], clear: { style: toggleValue(filters.style, value) } })),
    ...(filters.class ? [{ key: 'class', label: `Needs ${CLASS_LABELS[filters.class]}`, clear: { class: '' } }] : []),
    ...(filters.role ? [{ key: 'role', label: `Needs ${ROLE_LABELS[filters.role]}`, clear: { role: '' } }] : []),
    ...(filters.day ? [{ key: 'day', label: `Raids ${WEEKDAY_LABELS[filters.day]}`, clear: { day: '' } }] : []),
    ...filters.region.map((value) => ({ key: `g-${value}`, label: REGION_LABELS[value], clear: { region: [] } })),
    ...filters.language.map((value) => ({ key: `l-${value}`, label: LANGUAGE_LABELS[value], clear: { language: [] } })),
    ...(filters.recruiting ? [{ key: 'rec', label: 'Recruiting now', clear: { recruiting: false } }] : []),
    ...(filters.q ? [{ key: 'q', label: `“${filters.q}”`, clear: { q: '' } }] : []),
  ]
  if (!pills.length) return null
  return (
    <ul className="guild-pills">
      {pills.map((pill) => (
        <li key={pill.key}>
          <button type="button" onClick={() => update(pill.clear)} aria-label={`Remove ${pill.label}`}>{pill.label}<span aria-hidden="true">×</span></button>
        </li>
      ))}
    </ul>
  )
}

function SkeletonGrid() {
  return (
    <div className="guild-grid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => <div key={index} className="guild-card guild-card--skeleton" />)}
    </div>
  )
}

export default function GuildBrowser({ queryString = '' }) {
  const filters = filtersFromQuery(queryString)
  const [result, setResult] = useState({ loading: true })
  const [extra, setExtra] = useState({ guilds: [], offset: 0, loading: false })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [retry, setRetry] = useState(0)
  const query = apiQuery(filters, 0)

  useEffect(() => {
    const controller = new AbortController()
    setResult((current) => ({ ...current, loading: true, error: '' }))
    setExtra({ guilds: [], offset: 0, loading: false })
    fetch(`/api/guilds${query ? `?${query}` : ''}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('The guild directory could not be loaded.')
        setResult({ data: await response.json() })
      })
      .catch((error) => { if (error.name !== 'AbortError') setResult({ error: error.message }) })
    return () => controller.abort()
  }, [query, retry])

  function update(change) {
    navigate(`/guilds${queryFromFilters({ ...filters, ...change })}`, { replace: true, preserveScroll: true })
  }

  async function loadMore() {
    const offset = (result.data?.guilds.length || 0) + extra.guilds.length
    setExtra((current) => ({ ...current, loading: true }))
    try {
      const response = await fetch(`/api/guilds?${apiQuery(filters, offset)}`)
      if (!response.ok) throw new Error('More guilds could not be loaded.')
      const page = await response.json()
      setExtra((current) => ({ guilds: [...current.guilds, ...page.guilds], offset, loading: false, hasMore: page.pagination.hasMore }))
    } catch {
      setExtra((current) => ({ ...current, loading: false }))
    }
  }

  const data = result.data
  const facets = data?.facets
  const guilds = data ? [...data.guilds, ...extra.guilds] : []
  const hasMore = extra.guilds.length ? extra.hasMore : data?.pagination.hasMore
  const recruitingCount = data ? data.guilds.filter((guild) => guild.recruiting).length : 0
  const filterCount = activeFilterCount(filters)

  return (
    <div className="guild-browser">
      <div className="guild-browser__backdrop" aria-hidden="true" />
      <div className="guild-browser__frame">
        <main>
          <header className="guild-hero">
            <p className="guild-hero__eyebrow">Guildweaver · Guild directory</p>
            <h1 className="guild-hero__title">Find your guild.</h1>
            <p className="guild-hero__intro">
              Browse guilds by faction, realm and play style. Verified guilds show real activity synced by the Guildweaver addon, not just a recruitment post.
            </p>

            <form className="guild-search" role="search" onSubmit={(event) => {
              event.preventDefault()
              update({ q: String(new FormData(event.currentTarget).get('q') || '').trim() })
            }}>
              <div className="guild-search__factions" role="group" aria-label="Faction">
                {Object.entries(FACTION_LABELS).map(([value, label]) => (
                  <button key={value} type="button" className={`guild-search__faction guild-search__faction--${value}`}
                    aria-pressed={filters.faction.includes(value)}
                    onClick={() => update({ faction: filters.faction.includes(value) ? [] : [value] })}>
                    {label}<span>{facets?.factions?.[value] ?? '–'}</span>
                  </button>
                ))}
              </div>
              <label className="guild-search__field">
                <span className="visually-hidden">Search guilds</span>
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" fill="none" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                <input name="q" type="search" placeholder="Guild name, realm or motto" defaultValue={filters.q} key={filters.q} maxLength={64} />
              </label>
              <button type="submit" className="guild-search__submit">Search</button>
            </form>

            <div className="guild-hero__actions">
              <a className="guild-hero__primary" href="/guilds/register">Register your guild</a>
              <a className="guild-hero__secondary" href="/guildweaver">Get the addon</a>
            </div>
          </header>

          <section className="guild-directory" aria-label="Guilds">
            <button type="button" className="guild-directory__filters-toggle" aria-expanded={drawerOpen} onClick={() => setDrawerOpen((open) => !open)}>
              Filters{filterCount ? ` · ${filterCount}` : ''}
            </button>
            <aside className={`guild-directory__rail${drawerOpen ? ' guild-directory__rail--open' : ''}`}>
              <Filters filters={filters} facets={facets} update={update} onClear={() => update(emptyFilters())} />
            </aside>

            <div className="guild-directory__results">
              <div className="guild-toolbar">
                <p className="guild-toolbar__count" aria-live="polite">
                  {data ? <><strong>{data.total.toLocaleString()}</strong> {data.total === 1 ? 'guild' : 'guilds'}{recruitingCount ? <> · {recruitingCount} recruiting</> : null}</> : 'Searching guilds…'}
                </p>
                <label className="guild-toolbar__sort">
                  <span>Sort</span>
                  <select value={filters.sort} onChange={(event) => update({ sort: event.target.value })}>
                    {Object.entries(SORT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              </div>
              <ActivePills filters={filters} update={update} />

              {result.error ? (
                <div className="guild-empty" role="alert">
                  <h3>Something went wrong</h3>
                  <p>{result.error}</p>
                  <button type="button" className="guild-empty__action" onClick={() => setRetry((value) => value + 1)}>Try again</button>
                </div>
              ) : !data ? <SkeletonGrid /> : guilds.length ? (
                <>
                  <div className={`guild-grid${result.loading ? ' guild-grid--refreshing' : ''}`}>
                    {guilds.map((guild) => <GuildCard key={guild.id} guild={guild} />)}
                  </div>
                  {hasMore ? (
                    <button type="button" className="guild-more" onClick={loadMore} disabled={extra.loading}>
                      {extra.loading ? 'Loading…' : 'Show more guilds'}
                    </button>
                  ) : null}
                </>
              ) : (
                <div className="guild-empty">
                  <h3>No guilds match yet</h3>
                  <p>Loosen a filter, or be the first: register your guild and it will appear here.</p>
                  <div className="guild-empty__actions">
                    {filterCount ? <button type="button" className="guild-empty__action" onClick={() => update(emptyFilters())}>Clear filters</button> : null}
                    <a className="guild-empty__action guild-empty__action--primary" href="/guilds/register">Register your guild</a>
                  </div>
                </div>
              )}
            </div>
          </section>
        </main>
        <Footer />
      </div>
    </div>
  )
}
