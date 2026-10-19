import { useEffect, useState } from 'react'
import { Button, Chip, Panel, SearchIcon, Select, Switch, TextInput, ToggleChip } from '../DesignSystem/index.js'
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
    <Panel as="div" className="guild-filters" title="Refine" titleAs="h2"
      actions={count ? <Button variant="ghost" size="sm" onClick={onClear}>Clear {count}</Button> : null}>
      <FilterSection title="Realm type">
        <div className="guild-chips">
          {Object.entries(REALM_TYPE_LABELS).map(([value, label]) => (
            <ToggleChip key={value} pressed={filters.realmType.includes(value)} count={facets?.realmTypes?.[value]}
              onClick={() => update({ realmType: toggleValue(filters.realmType, value) })}>{label}</ToggleChip>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Play style">
        <div className="guild-chips">
          {Object.entries(PLAY_STYLE_LABELS).map(([value, label]) => (
            <ToggleChip key={value} pressed={filters.style.includes(value)} count={facets?.playStyles?.[value]}
              onClick={() => update({ style: toggleValue(filters.style, value) })}>{label}</ToggleChip>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Recruiting my class">
        <div className="guild-classes">
          {Object.entries(CLASS_LABELS).map(([value, label]) => (
            <ToggleChip key={value} className="guild-classes__chip" color={classColor(value)} pressed={filters.class === value}
              onClick={() => update({ class: filters.class === value ? '' : value })}>{label}</ToggleChip>
          ))}
        </div>
        <div className="guild-chips guild-chips--roles">
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <ToggleChip key={value} pressed={filters.role === value} onClick={() => update({ role: filters.role === value ? '' : value })}>{label}</ToggleChip>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Raid night">
        <div className="guild-chips guild-chips--days">
          {Object.entries(WEEKDAY_LABELS).map(([value, label]) => (
            <ToggleChip key={value} pressed={filters.day === value} onClick={() => update({ day: filters.day === value ? '' : value })}>{label}</ToggleChip>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Region & language">
        <div className="guild-selects">
          <Select label="Region" placeholder="Any region" options={Object.entries(REGION_LABELS)}
            value={filters.region[0] || ''} onChange={(event) => update({ region: event.target.value ? [event.target.value] : [] })} />
          <Select label="Language" placeholder="Any language" options={Object.entries(LANGUAGE_LABELS)}
            value={filters.language[0] || ''} onChange={(event) => update({ language: event.target.value ? [event.target.value] : [] })} />
        </div>
      </FilterSection>

      <div className="guild-filters__section">
        <Switch label="Only guilds recruiting now" checked={filters.recruiting} onChange={(event) => update({ recruiting: event.target.checked })} />
      </div>
    </Panel>
  )
}

function ActivePills({ filters, update }) {
  const pills = [
    ...filters.faction.map((value) => ({ key: `f-${value}`, label: FACTION_LABELS[value], clear: { faction: toggleValue(filters.faction, value) } })),
    ...filters.realmType.map((value) => ({ key: `r-${value}`, label: REALM_TYPE_LABELS[value], clear: { realmType: toggleValue(filters.realmType, value) } })),
    ...filters.style.map((value) => ({ key: `s-${value}`, label: PLAY_STYLE_LABELS[value], clear: { style: toggleValue(filters.style, value) } })),
    ...(filters.class ? [{ key: 'class', label: `Needs ${CLASS_LABELS[filters.class]}`, color: classColor(filters.class), clear: { class: '' } }] : []),
    ...(filters.role ? [{ key: 'role', label: `Needs ${ROLE_LABELS[filters.role]}`, clear: { role: '' } }] : []),
    ...(filters.day ? [{ key: 'day', label: `Raids ${WEEKDAY_LABELS[filters.day]}`, clear: { day: '' } }] : []),
    ...filters.region.map((value) => ({ key: `g-${value}`, label: REGION_LABELS[value], clear: { region: [] } })),
    ...filters.language.map((value) => ({ key: `l-${value}`, label: LANGUAGE_LABELS[value], clear: { language: [] } })),
    ...(filters.recruiting ? [{ key: 'rec', label: 'Recruiting now', clear: { recruiting: false } }] : []),
    ...(filters.q ? [{ key: 'q', label: `“${filters.q}”`, clear: { q: '' } }] : []),
  ]
  if (!pills.length) return null
  return (
    <ul className="guild-pills" aria-label="Active filters">
      {pills.map((pill) => (
        <li key={pill.key}>
          <Chip color={pill.color} onRemove={() => update(pill.clear)} removeLabel={`Remove ${pill.label}`}>{pill.label}</Chip>
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
                  <ToggleChip key={value} className="guild-search__faction" faction={value} pressed={filters.faction.includes(value)}
                    count={facets?.factions?.[value] ?? '–'}
                    onClick={() => update({ faction: filters.faction.includes(value) ? [] : [value] })}>
                    {label}
                  </ToggleChip>
                ))}
              </div>
              <TextInput className="guild-search__field" label="Search guilds" hideLabel icon={<SearchIcon />} size="lg"
                name="q" type="search" placeholder="Guild name, realm or motto" defaultValue={filters.q} key={filters.q} maxLength={64} />
              <Button type="submit" variant="primary" size="lg" className="guild-search__submit">Search</Button>
            </form>

            <div className="guild-hero__actions">
              <Button href="/guilds/register" variant="secondary" size="lg">Register your guild</Button>
              <Button href="/guildweaver" variant="ghost" size="lg">Get the addon →</Button>
            </div>
          </header>

          <section className="guild-directory" aria-label="Guilds">
            <Button className="guild-directory__filters-toggle" block aria-expanded={drawerOpen} onClick={() => setDrawerOpen((open) => !open)}
              icon={<svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 4h14M5 9h8M7.5 14h3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>}>
              {drawerOpen ? 'Hide filters' : 'Filters'}{filterCount ? ` · ${filterCount}` : ''}
            </Button>
            <aside className={`guild-directory__rail${drawerOpen ? ' guild-directory__rail--open' : ''}`} aria-label="Filters">
              <Filters filters={filters} facets={facets} update={update} onClear={() => update(emptyFilters())} />
            </aside>

            <div className="guild-directory__results">
              <div className="guild-toolbar">
                <p className="guild-toolbar__count" aria-live="polite">
                  {data ? <><strong>{data.total.toLocaleString()}</strong> {data.total === 1 ? 'guild' : 'guilds'}{recruitingCount ? <> · <span className="guild-toolbar__recruiting">{recruitingCount} recruiting</span></> : null}</> : 'Searching guilds…'}
                </p>
                <Select className="guild-toolbar__sort" label="Sort by" inline options={Object.entries(SORT_LABELS)}
                  value={filters.sort} onChange={(event) => update({ sort: event.target.value })} />
              </div>
              <ActivePills filters={filters} update={update} />

              {result.error ? (
                <Panel tone="dashed" padding="lg" className="guild-empty" role="alert">
                  <h3>Something went wrong</h3>
                  <p>{result.error}</p>
                  <Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>Try again</Button>
                </Panel>
              ) : !data ? <SkeletonGrid /> : guilds.length ? (
                <>
                  <div className={`guild-grid${result.loading ? ' guild-grid--refreshing' : ''}`}>
                    {guilds.map((guild) => <GuildCard key={guild.id} guild={guild} />)}
                  </div>
                  {hasMore ? (
                    <Button className="guild-more" size="lg" onClick={loadMore} loading={extra.loading}>
                      {extra.loading ? 'Loading…' : 'Show more guilds'}
                    </Button>
                  ) : null}
                </>
              ) : (
                <Panel tone="dashed" padding="lg" className="guild-empty">
                  <h3>No guilds match yet</h3>
                  <p>Loosen a filter, or be the first: register your guild and it will appear here.</p>
                  <div className="guild-empty__actions">
                    {filterCount ? <Button variant="secondary" onClick={() => update(emptyFilters())}>Clear filters</Button> : null}
                    <Button variant="primary" href="/guilds/register">Register your guild</Button>
                  </div>
                </Panel>
              )}
            </div>
          </section>
        </main>
        <Footer />
      </div>
    </div>
  )
}
