import { memo, useEffect, useMemo, useRef, useState } from 'react'

import { navigate } from '../Navigation/navigation.js'
import { ItemLabel } from '../Player/ui.jsx'
import {
  AddToList,
  Coins,
  ConfidenceBadge,
  FavoriteButton,
  Freshness,
  ListingState,
  Pct,
} from './MarketComponents.jsx'
import {
  BROWSE_COLUMNS,
  nextSort,
  readColumns,
  readOpenCategories,
  rowId,
  storeColumns,
  storeOpenCategories,
  visibleColumns,
} from './marketBrowse.js'
import { QUALITIES, auctionHref, formatAgeShort, readRecentSearches, rememberSearch } from './marketFormat.js'
import { marketWrite, useMarketResource, useSuggestions } from './useMarket.js'

function go(state, server, options = { preserveScroll: true }) {
  navigate(auctionHref(state, server), options)
}

function typing(event) {
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable || Boolean(event.target.closest?.('[role="dialog"]'))
}

// A variant whose base item has no known name is shown by its own name.
function rowItem(row) {
  return row.item.nameKnown || !row.variantName ? row.item : { ...row.item, name: row.variantName }
}

// The fields a search request depends on: anything else in the URL (the
// tab, an item deep link) never refetches the table.
function searchUrl(state) {
  if (!state.market) return ''
  const params = new URLSearchParams({ market: state.market, page: String(state.page), pageSize: '50' })
  for (const key of ['q', 'category', 'sub', 'quality', 'minLevel', 'maxLevel', 'sort']) if (state[key]) params.set(key, state[key])
  if (state.sort) params.set('dir', state.dir)
  if (state.listed) params.set('listed', '1')
  if (state.below) params.set('below', '1')
  return `/api/market/search?${params}`
}

function hasFilters(state) {
  return Boolean(state.category || state.quality || state.minLevel || state.maxLevel || state.listed || state.below)
}

// The name box: suggestions as you type (their own small request), recent
// searches, Enter or the Search button searches what is typed.
function NameField({ value, onChange, inputRef, marketKey, onPick, onSubmit }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  // Closing on blur waits a moment (a click on a suggestion lands first);
  // focusing again cancels it, so a stale close never hides the list.
  const blurTimer = useRef(0)
  useEffect(() => () => clearTimeout(blurTimer.current), [])
  const suggestions = useSuggestions(open ? value : '', marketKey)
  const [recent, setRecent] = useState(() => readRecentSearches())
  const showRecent = open && !value.trim() && recent.length > 0
  const options = showRecent ? recent.map((entry) => ({ recent: true, name: entry })) : suggestions
  function choose(entry) {
    setOpen(false)
    setActive(-1)
    if (entry.recent) { onChange(entry.name); onSubmit(entry.name); return }
    setRecent(rememberSearch(entry.name))
    onPick(entry)
  }
  return (
    <div className="gw-ahf__name">
      <label htmlFor="gw-ah-name" className="gw-sr">Item name or ID</label>
      <input id="gw-ah-name" ref={inputRef} type="search" value={value} placeholder="Search by item name or ID" autoComplete="off" maxLength={100}
        aria-label="Name" aria-autocomplete="list" aria-expanded={open && options.length > 0} aria-controls="gw-ah-suggest" role="combobox"
        aria-activedescendant={active >= 0 ? `gw-ah-opt-${active}` : undefined}
        onChange={(event) => { clearTimeout(blurTimer.current); onChange(event.target.value); setOpen(true); setActive(-1) }}
        onFocus={() => { clearTimeout(blurTimer.current); setOpen(true) }}
        onBlur={() => { clearTimeout(blurTimer.current); blurTimer.current = setTimeout(() => setOpen(false), 150) }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((index) => Math.min(options.length - 1, index + 1)) }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(-1, index - 1)) }
          else if (event.key === 'Enter') {
            // A highlighted suggestion opens that item; otherwise the form
            // submits what is typed.
            if (open && options[active]) { event.preventDefault(); choose(options[active]) }
            else { setOpen(false); setRecent(rememberSearch(value)) }
          } else if (event.key === 'Escape') {
            // The browser would clear a search box on Escape; the search in
            // the URL would then no longer match what the box shows.
            event.preventDefault()
            if (open) setOpen(false); else event.currentTarget.blur()
          }
        }} />
      {open && options.length ? (
        <ul id="gw-ah-suggest" className="gw-ahf__suggest" role="listbox" aria-label={showRecent ? 'Recent searches' : 'Suggestions'}>
          {showRecent ? <li className="gw-ahf__suggest-head" aria-hidden="true">Recent</li> : null}
          {options.map((entry, index) => (
            <li key={entry.recent ? `r:${entry.name}` : entry.itemId} id={`gw-ah-opt-${index}`} role="option" aria-selected={index === active}
              className={index === active ? 'is-active' : ''} onMouseDown={(event) => { event.preventDefault(); choose(entry) }}>
              {entry.recent ? <span className="gw-muted">↺ {entry.name}</span> : (
                <>
                  <ItemLabel item={entry} size={18} tooltip={false} />
                  <span className="gw-ahf__suggest-meta">
                    {entry.priced ? <><Coins value={entry.minUnitBuyout} compact /> · {entry.quantity?.toLocaleString('en-US')}</>
                      : entry.listed ? `${entry.variants} version${entry.variants === 1 ? '' : 's'} listed` : 'no listings here'}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

// The compact bar above the table: name or ID, Search, filters, Reset.
function SearchBar({ state, server, inputRef, onPick }) {
  const [value, setValue] = useState(state.q)
  const [minLevel, setMinLevel] = useState(state.minLevel)
  const [maxLevel, setMaxLevel] = useState(state.maxLevel)
  // Back, Forward and Reset put the URL's search back in the boxes.
  useEffect(() => { setValue(state.q) }, [state.q])
  useEffect(() => { setMinLevel(state.minLevel); setMaxLevel(state.maxLevel) }, [state.minLevel, state.maxLevel])
  const search = (q = value) => go({ ...state, q: q.trim(), minLevel, maxLevel, page: 1 }, server)
  return (
    <form className="gw-ahf__strip" role="search" aria-label="Search the auction house" onSubmit={(event) => { event.preventDefault(); search() }}>
      <NameField value={value} onChange={setValue} inputRef={inputRef} marketKey={state.market} onSubmit={search}
        onPick={(entry) => { setValue(entry.name); onPick(entry) }} />
      <button type="submit" className="gw-ahf__search">Search</button>
      <div className="gw-ahf__levels" role="group" aria-label="Level range">
        <span aria-hidden="true">Lvl</span>
        <input aria-label="Minimum level" inputMode="numeric" value={minLevel} maxLength={3} placeholder="min" onChange={(event) => setMinLevel(event.target.value.replace(/\D/g, ''))} />
        <span aria-hidden="true">–</span>
        <input aria-label="Maximum level" inputMode="numeric" value={maxLevel} maxLength={3} placeholder="max" onChange={(event) => setMaxLevel(event.target.value.replace(/\D/g, ''))} />
      </div>
      <label className="gw-ahf__rarity">
        <span className="gw-sr">Rarity</span>
        <select aria-label="Rarity" value={state.quality} onChange={(event) => go({ ...state, quality: event.target.value, page: 1 }, server)}>
          {QUALITIES.map((quality) => <option key={quality.id} value={quality.id}>{quality.id ? `${quality.label}+` : 'Any rarity'}</option>)}
        </select>
      </label>
      <label className="gw-ahf__check" title="Hide known items with no listings in this market">
        <input type="checkbox" checked={state.listed} onChange={(event) => go({ ...state, listed: event.target.checked, page: 1 }, server)} />
        Listed only
      </label>
      <label className="gw-ahf__check" title="Lowest ask at least 15% under its 14-day median (needs five days of history)">
        <input type="checkbox" checked={state.below} onChange={(event) => go({ ...state, below: event.target.checked, page: 1 }, server)} />
        Below median
      </label>
      <button type="button" className="gw-ahf__reset" onClick={() => { setValue(''); go({ tab: 'browse', market: state.market }, server) }}
        disabled={!state.q && !hasFilters(state) && !state.sort && state.page === 1}>Reset</button>
    </form>
  )
}

// Saved searches: a name for a search and its filters, kept with the
// account.
function SavedSearches({ state, server }) {
  const saved = useMarketResource('/api/market/searches')
  async function saveCurrent() {
    const name = window.prompt('Name this search', state.q || state.sub || state.category || 'Search')
    if (!name) return
    await marketWrite('/api/market/searches', { method: 'POST', body: { name, query: { q: state.q, category: state.category, sub: state.sub, sort: state.sort, direction: state.dir, market: state.market } } })
    saved.reload()
  }
  const entries = saved.data?.searches || []
  return (
    <div className="gw-ahf__saved">
      <div className="gw-ahf__saved-head"><span>Saved searches</span>
        <button type="button" className="gw-btn gw-btn--xs" onClick={saveCurrent} disabled={!state.q && !state.category} title="Save this search">Save</button></div>
      {entries.length ? (
        <ul>{entries.slice(0, 12).map((entry) => (
          <li key={entry.id} className="gw-ahf__savedrow">
            <a href={auctionHref({ ...state, q: entry.query.q || '', category: entry.query.category || '', sub: entry.query.sub || '', sort: entry.query.sort || '', dir: entry.query.direction || 'asc', page: 1, item: null }, server)}>{entry.name}</a>
            <button type="button" aria-label={`Delete saved search ${entry.name}`} onClick={() => marketWrite(`/api/market/searches/${entry.id}`, { method: 'DELETE' }).then(saved.reload)}>×</button>
          </li>
        ))}</ul>
      ) : <p className="gw-muted gw-small">Save a search to come back to it.</p>}
    </div>
  )
}

// The category tree: every category, always, in the game's order. Open
// branches are kept for the browser session; choosing one filters the
// results in place (a search stays a search).
const CategoryTree = memo(function CategoryTree({ state, server, categories }) {
  const [open, setOpen] = useState(() => new Set([...readOpenCategories(), ...(state.category ? [state.category] : [])]))
  useEffect(() => { storeOpenCategories(open) }, [open])
  useEffect(() => {
    if (state.category) setOpen((current) => (current.has(state.category) ? current : new Set([...current, state.category])))
  }, [state.category])
  const toggle = (key) => setOpen((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  const select = (category, sub = '') => go({ ...state, category, sub, page: 1 }, server)
  return (
    <nav className="gw-ahf__cats" aria-label="Categories">
      <ul className="gw-ahf__tree" role="tree" aria-label="Item categories">
        <li role="treeitem" aria-selected={!state.category}>
          <button type="button" className={`gw-ahf__cat${!state.category ? ' is-active' : ''}`} onClick={() => select('')}>All categories</button>
        </li>
        {categories.map((category) => {
          const expanded = open.has(category.key)
          const selected = state.category === category.key
          return (
            <li key={category.key} role="treeitem" aria-expanded={category.subcategories.length ? expanded : undefined} aria-selected={selected && !state.sub}>
              <div className="gw-ahf__catrow">
                {category.subcategories.length ? (
                  <button type="button" className="gw-ahf__twisty" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${category.label}`} onClick={() => toggle(category.key)}>
                    {expanded ? '−' : '+'}
                  </button>
                ) : <span className="gw-ahf__twisty" aria-hidden="true" />}
                <button type="button" className={`gw-ahf__cat${selected && !state.sub ? ' is-active' : ''}${selected ? ' is-within' : ''}${category.items ? '' : ' is-empty'}`}
                  onClick={() => { if (!expanded && category.subcategories.length) toggle(category.key); select(category.key) }}>
                  {category.label}{category.items ? <small>{category.items.toLocaleString('en-US')}</small> : null}
                </button>
              </div>
              {expanded && category.subcategories.length ? (
                <ul role="group">{category.subcategories.map((sub) => (
                  <li key={sub.key} role="treeitem" aria-selected={selected && state.sub === sub.key}>
                    <button type="button" className={`gw-ahf__cat gw-ahf__cat--sub${selected && state.sub === sub.key ? ' is-active' : ''}${sub.items ? '' : ' is-empty'}`}
                      onClick={() => select(category.key, sub.key)}>
                      {sub.label}{sub.items ? <small>{sub.items.toLocaleString('en-US')}</small> : null}
                    </button>
                  </li>
                ))}</ul>
              ) : null}
            </li>
          )
        })}
      </ul>
      <SavedSearches state={state} server={server} />
    </nav>
  )
})

function ColumnPicker({ optional, onChange }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="gw-ahf__columns">
      <button type="button" className="gw-ahf__linkbtn" aria-expanded={open} onClick={() => setOpen((value) => !value)}>Columns</button>
      {open ? (
        <fieldset className="gw-ahf__colmenu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
          <legend className="gw-sr">Optional columns</legend>
          {BROWSE_COLUMNS.filter((column) => column.optional).map((column) => (
            <label key={column.id} title={column.title}>
              <input type="checkbox" checked={optional.includes(column.id)}
                onChange={(event) => onChange(event.target.checked ? [...optional, column.id] : optional.filter((id) => id !== column.id))} />
              {column.title || column.label}
            </label>
          ))}
        </fieldset>
      ) : null}
    </div>
  )
}

function Cell({ column, row, stack }) {
  const listed = row.listing === 'listed'
  switch (column.id) {
    case 'price':
      return listed ? <Coins value={row.minUnitBuyout === null ? null : row.minUnitBuyout * stack} compact />
        : <ListingState listing={row.listing} observedAt={row.observedAt} note={row.listingNote} ageSeconds={row.ageSeconds} />
    case 'name':
      return (
        <>
          <ItemLabel item={rowItem(row)} size={20} />
          {row.variantName && row.item.nameKnown ? <span className="gw-ahf__variant">{row.variantName.replace(row.item.name, '').trim() || row.variantName}</span> : null}
        </>
      )
    case 'quantity': return listed ? row.quantity.toLocaleString('en-US') : <span className="gw-muted">—</span>
    case 'level': return row.item.requiredLevel || ''
    case 'ilvl': return row.item.itemLevel || ''
    case 'listings': return listed ? row.listings ?? '—' : ''
    case 'age': return listed ? <Freshness price={row} showSource={false} short /> : row.observedAt ? <span className="gw-fresh">{formatAgeShort(row.ageSeconds)}</span> : ''
    case 'pct': return listed ? <Pct value={row.pct} days={row.referenceDays} /> : ''
    case 'confidence': return listed && row.confidence ? <ConfidenceBadge confidence={row.confidence} /> : ''
    default: return null
  }
}

// One selected row, small: what it costs here and what can be done with it.
// Nothing buys: buying and posting happen in the game.
function Preview({ row, stack, favorite, onFavoritesChange, onInspect, state, server }) {
  if (!row) return <div className="gw-ahf__actions" aria-label="Selected item"><span className="gw-muted">Click a row to select it, double-click to inspect. Guildweaver shows prices; buying and posting happen in the game.</span></div>
  const listed = row.listing === 'listed'
  const unit = stack && row.item.stackCount > 1 ? row.item.stackCount : 1
  return (
    <div className="gw-ahf__actions" aria-label="Selected item">
      <span className="gw-ahf__selected"><ItemLabel item={rowItem(row)} size={20} tooltip={false} /></span>
      {listed ? (
        <>
          <span className="gw-ahf__buyout">Lowest <Coins value={row.minUnitBuyout * unit} />{unit > 1 ? <small>/ stack of {unit}</small> : <small>each</small>}</span>
          <span className="gw-ahf__buyout">{row.quantity.toLocaleString('en-US')} available{row.listings ? <small>· {row.listings} auctions</small> : null}</span>
          <Freshness price={row} />
        </>
      ) : <ListingState listing={row.listing} observedAt={row.observedAt} note={row.listingNote} ageSeconds={row.ageSeconds} />}
      <span className="gw-ahf__spacer" />
      <button type="button" className="gw-ahf__btn" onClick={() => onInspect(row)} title="Open the inspector (Enter or double-click)">Inspect</button>
      <FavoriteButton itemId={row.item.itemId} favorite={favorite} onChange={onFavoritesChange} />
      <AddToList itemId={row.item.itemId} className="gw-ahf__btn" />
      <a className="gw-ahf__btn gw-ahf__btn--link" href={auctionHref({ ...state, tab: 'appraiser', item: row.item.itemId, key: row.variant ? row.itemKey : '' }, server)}>Appraise</a>
    </div>
  )
}

function EmptyState({ state, server, data }) {
  if (data.mode === 'search') {
    return (
      <div className="gw-ahf__empty">
        <strong>{state.listed || state.below ? `No listings match “${state.q}” in this market.` : `No known item matches “${state.q}”.`}</strong>
        <p>{state.listed || state.below ? 'Items that match but have no listings here are hidden. ' : 'Search looks through every item the website knows, by name or exact item ID. '}
          {hasFilters(state) ? 'Filters are on. ' : ''}</p>
        <p className="gw-ahf__emptyacts">
          {state.listed ? <button type="button" className="gw-btn gw-btn--xs" onClick={() => go({ ...state, listed: false, page: 1 }, server)}>Show items without listings</button> : null}
          {state.category ? <button type="button" className="gw-btn gw-btn--xs" onClick={() => go({ ...state, category: '', sub: '', page: 1 }, server)}>Search all categories</button> : null}
        </p>
      </div>
    )
  }
  return (
    <div className="gw-ahf__empty">
      <strong>{hasFilters(state) ? 'No listings in this category or with these filters.' : 'This market has no listings yet.'}</strong>
      <p>Browse shows what is listed in the selected market. Search finds any known item, listed or not. Prices come from Blizzard's auction API and players' in-game searches; nothing is estimated.</p>
    </div>
  )
}

// Browse: the game's auction house layout. Kept mounted while other tabs
// are shown, so the search, the selection and the scroll position survive.
export default function AuctionBrowse({ state, server, active, inputRef, favorites, onFavoritesChange, onInspect }) {
  const url = searchUrl(state)
  const search = useMarketResource(url)
  const data = search.data
  const rows = useMemo(() => data?.results || [], [data])
  const [selectedId, setSelectedId] = useState(null)
  const [optional, setOptional] = useState(() => readColumns())
  const columns = visibleColumns(optional)
  const tableRef = useRef(null)
  const scrollRef = useRef(null)
  const selected = rows.find((row) => rowId(row) === selectedId) || null
  const total = data?.total || 0
  const pageSize = data?.pageSize || 50
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const stack = state.stack ? 1 : 0

  // A new search starts at the top of the list; inspectors, tabs and
  // selection never move it.
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0 }, [url])

  const inspect = (row) => onInspect({ itemId: row.item.itemId, itemKey: row.variant ? row.itemKey : '', name: row.variantName || rowItem(row).name, qualityId: row.item.qualityId })

  // Keys (while Browse is shown): / or Alt+K search, ↑↓ or j/k select,
  // Enter inspects, F favorite, [ ] pages.
  useEffect(() => {
    if (!active) return undefined
    function onKey(event) {
      if ((event.key === '/' && !typing(event)) || (event.altKey && event.key.toLowerCase() === 'k')) { event.preventDefault(); inputRef.current?.focus(); return }
      if (typing(event) || event.metaKey || event.ctrlKey || event.altKey) return
      const index = rows.findIndex((row) => rowId(row) === selectedId)
      const move = (delta) => {
        const next = Math.max(0, Math.min(rows.length - 1, (index < 0 ? (delta > 0 ? -1 : rows.length) : index) + delta))
        if (!rows[next]) return
        setSelectedId(rowId(rows[next]))
        tableRef.current?.querySelectorAll('tbody tr[data-row]')[next]?.scrollIntoView({ block: 'nearest' })
      }
      if (event.key === 'ArrowDown' || event.key === 'j') move(1)
      else if (event.key === 'ArrowUp' || event.key === 'k') move(-1)
      else if (event.key === 'Enter' && selected && !event.target.closest?.('button, a')) inspect(selected)
      else if (event.key === 'f' && selected) {
        const itemId = selected.item.itemId
        marketWrite(`/api/market/favorites/${itemId}`, { method: favorites.has(itemId) ? 'DELETE' : 'PUT' }).then(onFavoritesChange)
      } else if (event.key === '[' && state.page > 1) go({ ...state, page: state.page - 1 }, server)
      else if (event.key === ']' && state.page < pages) go({ ...state, page: state.page + 1 }, server)
      else return
      event.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const from = total ? (state.page - 1) * pageSize + 1 : 0
  const to = Math.min(total, state.page * pageSize)
  const firstUnlisted = rows.findIndex((row) => row.listing !== 'listed')
  const searching = data?.mode === 'search'
  return (
    <div className="gw-ahf__browse" hidden={!active}>
      <SearchBar state={state} server={server} inputRef={inputRef} onPick={(entry) => {
        go({ ...state, q: entry.name, page: 1 }, server)
        onInspect({ itemId: entry.itemId, itemKey: '', name: entry.name, qualityId: entry.qualityId })
      }} />
      <CategoryTree state={state} server={server} categories={data?.categories || []} />
      <section className="gw-ahf__results" aria-label="Results" aria-busy={search.status === 'loading' || search.status === 'refreshing'}>
        <div className="gw-ahf__resulthead">
          <span className="gw-ahf__context">
            {searching ? <>Results for <strong>“{data.query}”</strong> in every known item</> : data ? <>Listings in this market</> : null}
            {data?.filters?.category ? <> · {data.categories.find((entry) => entry.key === data.filters.category.key)?.label}{data.filters.category.subcategory ? ` › ${data.categories.find((entry) => entry.key === data.filters.category.key)?.subcategories.find((sub) => sub.key === data.filters.category.subcategory)?.label}` : ''}</> : null}
          </span>
          {searching && data.coverage && !data.coverage.complete ? <span className="gw-ahf__coverage" title={data.coverage.note}>Partial coverage: “Not seen here” may still be listed</span> : null}
          <ColumnPicker optional={optional} onChange={(next) => { setOptional(next); storeColumns(next) }} />
        </div>
        {search.status === 'loading' ? <div className="gw-skeleton gw-ahf__skeleton" aria-busy="true">{Array.from({ length: 14 }, (_, index) => <div key={index} className="gw-skeleton__row" />)}</div> : null}
        {search.status === 'error' ? <p className="gw-ahf__empty">Search failed. <button type="button" className="gw-btn gw-btn--sm" onClick={search.reload}>Retry</button></p> : null}
        {data && !rows.length && search.status !== 'loading' ? <EmptyState state={state} server={server} data={data} /> : null}
        {rows.length ? (
          <div className="gw-ahf__tablewrap" ref={scrollRef}>
            <table ref={tableRef} className={`gw-ahf__table${search.status === 'refreshing' ? ' is-refreshing' : ''}`} aria-rowcount={total + 1} aria-label="Auction items">
              <thead>
                <tr>
                  {columns.map((column) => {
                    const sorted = state.sort === column.id
                    return (
                      <th key={column.id} scope="col" className={`${column.numeric ? 'gw-col-num ' : ''}gw-ahf__col-${column.id}`} title={column.title}
                        aria-sort={sorted ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" className="gw-sort" onClick={() => go({ ...state, ...nextSort(state, column), page: 1 }, server)}>
                          {column.label}<span aria-hidden="true">{sorted ? (state.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                        </button>
                      </th>
                    )
                  })}
                  <th scope="col" className="gw-ahf__col-fav"><span className="gw-sr">Favorite</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const id = rowId(row)
                  const isSelected = id === selectedId
                  const unit = stack && row.item.stackCount > 1 ? row.item.stackCount : 1
                  return [
                    index === firstUnlisted && searching ? (
                      <tr key="divider" className="gw-ahf__divider"><td colSpan={columns.length + 1}>Known items without listings seen in this market</td></tr>
                    ) : null,
                    <tr key={id} data-row={id} aria-rowindex={from + index + 1} aria-selected={isSelected}
                      className={`${isSelected ? 'is-selected' : ''}${row.listing !== 'listed' ? ' is-unlisted' : ''}${row.stale ? ' is-stale' : ''}`}
                      onClick={() => setSelectedId(id)} onDoubleClick={() => { setSelectedId(id); inspect(row) }}>
                      {columns.map((column) => (
                        <td key={column.id} className={`${column.numeric ? 'gw-col-num ' : ''}gw-ahf__c-${column.id}`}><Cell column={column} row={row} stack={unit} /></td>
                      ))}
                      <td className="gw-ahf__c-fav"><FavoriteButton itemId={row.item.itemId} favorite={favorites.has(row.item.itemId)} onChange={onFavoritesChange} /></td>
                    </tr>,
                  ]
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <footer className="gw-ahf__foot">
          <label className="gw-ahf__check">
            <input type="checkbox" checked={state.stack} onChange={(event) => go({ ...state, stack: event.target.checked }, server)} />
            Stack prices
          </label>
          <span className="gw-ahf__count" aria-live="polite">{total ? `${from}–${to} of ${total.toLocaleString('en-US')}` : data ? 'No items' : ''}</span>
          <nav className="gw-ahf__pager" aria-label="Pages">
            <button type="button" disabled={state.page <= 1} onClick={() => go({ ...state, page: state.page - 1 }, server)} aria-label="Previous page">◀</button>
            <span>{state.page}/{pages}</span>
            <button type="button" disabled={state.page >= pages} onClick={() => go({ ...state, page: state.page + 1 }, server)} aria-label="Next page">▶</button>
          </nav>
        </footer>
      </section>
      <Preview row={selected} stack={stack} favorite={selected ? favorites.has(selected.item.itemId) : false} onFavoritesChange={onFavoritesChange}
        onInspect={inspect} state={state} server={server} />
    </div>
  )
}
