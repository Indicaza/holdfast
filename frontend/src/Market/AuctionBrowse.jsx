import { memo, useEffect, useMemo, useRef, useState } from 'react'

import { navigate } from '../Navigation/navigation.js'
import { ItemLabel } from '../Player/ui.jsx'
import { Coins, FavoriteButton, Freshness, ListingState } from './MarketComponents.jsx'
import { BROWSE_COLUMNS, nextSort, readOpenCategories, rowId, storeOpenCategories } from './marketBrowse.js'
import { QUALITIES, auctionHref, readRecentSearches, rememberSearch } from './marketFormat.js'
import { marketWrite, useMarketResource, useSuggestions } from './useMarket.js'

const COLUMNS = BROWSE_COLUMNS.filter((column) => !column.optional)

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

// The fields a search depends on: nothing else in the URL refetches it.
// Searches show what is on the house, as in the game.
function searchUrl(state) {
  if (!state.market) return ''
  const params = new URLSearchParams({ market: state.market, page: String(state.page), pageSize: '50', listed: '1' })
  for (const key of ['q', 'category', 'sub', 'quality', 'minLevel', 'maxLevel', 'sort']) if (state[key]) params.set(key, state[key])
  if (state.sort) params.set('dir', state.dir)
  return `/api/market/search?${params}`
}

// Nothing searched, no category, no filter: the favorites.
function isHome(state) {
  return !state.q && !state.category && !state.quality && !state.minLevel && !state.maxLevel
}

// Favorites as table rows, priced from the selected house.
function favoriteRow(entry) {
  const price = entry.price
  const listed = Boolean(price && !price.variantsOnly && price.quantity > 0)
  return { item: entry.item, itemKey: price?.itemKey && !price.variantsOnly ? price.itemKey : null, variant: null, variantName: null,
    ...(price && !price.variantsOnly ? price : {}), listing: listed ? 'listed' : price?.variantsOnly ? 'variants' : price ? 'none_listed' : 'unknown',
    variants: price?.variantsOnly ? price.variants.length : 0, observedAt: price?.observedAt ?? null, ageSeconds: price?.ageSeconds ?? null }
}

// The name box: suggestions as you type, recent searches; Enter or the
// Search button searches what is typed.
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
            if (open && options[active]) { event.preventDefault(); choose(options[active]) }
            else { setOpen(false); setRecent(rememberSearch(value)) }
          } else if (event.key === 'Escape') {
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
                      : entry.listed ? `${entry.variants} version${entry.variants === 1 ? '' : 's'}` : 'none on this AH'}
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

// The bar above the table: name or ID, Search, level range, rarity, Reset.
function SearchBar({ state, server, inputRef, onPick }) {
  const [value, setValue] = useState(state.q)
  const [minLevel, setMinLevel] = useState(state.minLevel)
  const [maxLevel, setMaxLevel] = useState(state.maxLevel)
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
      <button type="button" className="gw-ahf__reset" onClick={() => { setValue(''); go({ market: state.market }, server) }}
        disabled={isHome(state) && !state.sort && state.page === 1}>Reset</button>
    </form>
  )
}

// The category tree, as in the game. Open branches are kept for the
// browser session; choosing one filters what is shown.
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
    </nav>
  )
})

function Cell({ column, row }) {
  const listed = row.listing === 'listed'
  switch (column.id) {
    case 'price':
      if (listed) return <Coins value={row.minUnitBuyout} compact />
      if (row.listing === 'variants') return <span className="gw-listing gw-listing--none">{row.variants} versions</span>
      return <ListingState listing={row.listing} observedAt={row.observedAt} note={row.listingNote} ageSeconds={row.ageSeconds} />
    case 'name':
      return (
        <>
          <ItemLabel item={rowItem(row)} size={20} />
          {row.variantName && row.item.nameKnown ? <span className="gw-ahf__variant">{row.variantName.replace(row.item.name, '').trim() || row.variantName}</span> : null}
        </>
      )
    case 'quantity': return listed ? row.quantity.toLocaleString('en-US') : <span className="gw-muted">—</span>
    default: return null
  }
}

// The selected row, small: what it costs here. Buying happens in the game.
function Preview({ row, favorite, onFavoritesChange, onInspect }) {
  if (!row) return <div className="gw-ahf__actions" aria-label="Selected item"><span className="gw-muted">Click an item to select it, double-click to open it. Buying happens in the game.</span></div>
  return (
    <div className="gw-ahf__actions" aria-label="Selected item">
      <span className="gw-ahf__selected"><ItemLabel item={rowItem(row)} size={20} tooltip={false} /></span>
      {row.listing === 'listed' ? (
        <>
          <span className="gw-ahf__buyout">Buyout <Coins value={row.minUnitBuyout} /><small>each</small></span>
          <span className="gw-ahf__buyout">{row.quantity.toLocaleString('en-US')} available</span>
          <Freshness price={row} />
        </>
      ) : <ListingState listing={row.listing} observedAt={row.observedAt} note={row.listingNote} ageSeconds={row.ageSeconds} />}
      <span className="gw-ahf__spacer" />
      <FavoriteButton itemId={row.item.itemId} favorite={favorite} onChange={onFavoritesChange} />
      <button type="button" className="gw-ahf__btn" onClick={() => onInspect(row)} title="Open the item (Enter or double-click)">Open</button>
    </div>
  )
}

// A search with nothing on this house: say so, and name the known items
// that matched but are not listed here.
function NothingListed({ state, data, onInspect }) {
  const known = data?.unlisted?.items || []
  return (
    <div className="gw-ahf__empty">
      <strong>No auctions for “{state.q}” on this auction house.</strong>
      {known.length ? (
        <ul className="gw-ahf__known">{known.map((row) => (
          <li key={row.item.itemId}>
            <button type="button" className="gw-ahf__linkbtn" onClick={() => onInspect(row)}><ItemLabel item={row.item} size={18} tooltip={false} /></button>
            <ListingState listing={row.listing} observedAt={row.observedAt} note={row.listingNote} ageSeconds={row.ageSeconds} />
          </li>
        ))}</ul>
      ) : <p>No item by that name or ID is known yet.</p>}
      {state.category || state.quality || state.minLevel || state.maxLevel ? <p>Filters are on: try Reset.</p> : null}
    </div>
  )
}

// The Auction House screen: the search bar, the categories, and the table
// (favorites when nothing is searched). Selection and scroll stay put while
// item windows open and close.
export default function AuctionBrowse({ state, server, active, inputRef, favorites, favoriteRows, favoritesStatus, onFavoritesChange, onInspect }) {
  const home = isHome(state)
  // The search also runs at home: its category counts fill the tree.
  const search = useMarketResource(searchUrl(state))
  const data = search.data
  const rows = useMemo(() => (home ? favoriteRows.map(favoriteRow) : data?.results || []), [home, favoriteRows, data])
  const [selectedId, setSelectedId] = useState(null)
  const tableRef = useRef(null)
  const scrollRef = useRef(null)
  const selected = rows.find((row) => rowId(row) === selectedId) || null
  const total = home ? rows.length : data?.total || 0
  const pageSize = data?.pageSize || 50
  const pages = home ? 1 : Math.max(1, Math.ceil(total / pageSize))
  const status = home ? favoritesStatus : search.status
  const url = home ? 'home' : searchUrl(state)

  // A new search starts at the top; windows and selection never move it.
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0 }, [url])

  const inspect = (row) => onInspect({ itemId: row.item.itemId, itemKey: row.variant ? row.itemKey : '', name: row.variantName || rowItem(row).name, qualityId: row.item.qualityId })

  // Keys: / searches, ↑↓ select, Enter opens, F favorites, [ ] pages.
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
  const to = home ? total : Math.min(total, state.page * pageSize)
  const categoryLabel = data?.filters?.category ? (() => {
    const entry = data.categories.find((candidate) => candidate.key === data.filters.category.key)
    const sub = entry?.subcategories.find((candidate) => candidate.key === data.filters.category.subcategory)
    return [entry?.label, sub?.label].filter(Boolean).join(' › ')
  })() : ''
  return (
    <div className="gw-ahf__browse" hidden={!active}>
      <SearchBar state={state} server={server} inputRef={inputRef} onPick={(entry) => {
        go({ ...state, q: entry.name, page: 1 }, server)
        onInspect({ itemId: entry.itemId, itemKey: '', name: entry.name, qualityId: entry.qualityId })
      }} />
      <CategoryTree state={state} server={server} categories={data?.categories || []} />
      <section className="gw-ahf__results" aria-label="Results" aria-busy={status === 'loading' || status === 'refreshing'}>
        <div className="gw-ahf__resulthead">
          <span className="gw-ahf__context">
            {home ? <strong>Favorites</strong> : state.q ? <>Results for <strong>“{state.q}”</strong></> : <strong>{categoryLabel || 'Search results'}</strong>}
            {!home && state.q && categoryLabel ? <> in {categoryLabel}</> : null}
          </span>
        </div>
        {status === 'loading' ? <div className="gw-skeleton gw-ahf__skeleton" aria-busy="true">{Array.from({ length: 12 }, (_, index) => <div key={index} className="gw-skeleton__row" />)}</div> : null}
        {status === 'error' ? <p className="gw-ahf__empty">Could not load. <button type="button" className="gw-btn gw-btn--sm" onClick={search.reload}>Retry</button></p> : null}
        {home && status !== 'loading' && !rows.length ? (
          <div className="gw-ahf__empty"><strong>No favorites yet.</strong><p>Search for an item or pick a category, then star items to keep them here with their prices on this auction house.</p></div>
        ) : null}
        {!home && data && !rows.length && status !== 'loading' ? (state.q ? <NothingListed state={state} data={data} onInspect={inspect} />
          : <div className="gw-ahf__empty"><strong>Nothing listed here in this category.</strong></div>) : null}
        {rows.length ? (
          <div className="gw-ahf__tablewrap" ref={scrollRef}>
            <table ref={tableRef} className={`gw-ahf__table${status === 'refreshing' ? ' is-refreshing' : ''}`} aria-rowcount={total + 1} aria-label="Auction items">
              <thead>
                <tr>
                  {COLUMNS.map((column) => {
                    const sorted = !home && state.sort === column.id
                    return (
                      <th key={column.id} scope="col" className={`${column.numeric ? 'gw-col-num ' : ''}gw-ahf__col-${column.id}`} title={column.title}
                        aria-sort={sorted ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        {home ? column.label : (
                          <button type="button" className="gw-sort" onClick={() => go({ ...state, ...nextSort(state, column), page: 1 }, server)}>
                            {column.label}<span aria-hidden="true">{sorted ? (state.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                          </button>
                        )}
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
                  return (
                    <tr key={id} data-row={id} aria-rowindex={from + index + 1} aria-selected={isSelected}
                      className={`${isSelected ? 'is-selected' : ''}${row.listing !== 'listed' ? ' is-unlisted' : ''}${row.stale ? ' is-stale' : ''}`}
                      onClick={() => setSelectedId(id)} onDoubleClick={() => { setSelectedId(id); inspect(row) }}>
                      {COLUMNS.map((column) => (
                        <td key={column.id} className={`${column.numeric ? 'gw-col-num ' : ''}gw-ahf__c-${column.id}`}><Cell column={column} row={row} /></td>
                      ))}
                      <td className="gw-ahf__c-fav"><FavoriteButton itemId={row.item.itemId} favorite={favorites.has(row.item.itemId)} onChange={onFavoritesChange} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {!home && total ? (
          <footer className="gw-ahf__foot">
            <span className="gw-ahf__count" aria-live="polite">{total ? `${from}–${to} of ${total.toLocaleString('en-US')}` : data ? 'No items' : ''}</span>
            <nav className="gw-ahf__pager" aria-label="Pages">
              <button type="button" disabled={state.page <= 1} onClick={() => go({ ...state, page: state.page - 1 }, server)} aria-label="Previous page">◀</button>
              <span>{state.page}/{pages}</span>
              <button type="button" disabled={state.page >= pages} onClick={() => go({ ...state, page: state.page + 1 }, server)} aria-label="Next page">▶</button>
            </nav>
          </footer>
        ) : null}
      </section>
      <Preview row={selected} favorite={selected ? favorites.has(selected.item.itemId) : false} onFavoritesChange={onFavoritesChange} onInspect={inspect} />
    </div>
  )
}
