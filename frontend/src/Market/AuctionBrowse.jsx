import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AuctionItem, FavoriteStar } from './AuctionParts.jsx'
import { goAuction } from './auctionNavigation.js'
import { Coins, Freshness, ListingState } from './MarketComponents.jsx'
import { nextSort, pickCategory, rowId } from './marketBrowse.js'
import { RARITIES, rarityList, rarityValue, readRecentSearches, rememberSearch } from './marketFormat.js'
import { marketWrite, useMarketResource, useSuggestions } from './useMarket.js'

// The Buy tab: WoW Forever's browse view. Search bar on top, the category
// list on the left, the results list (Price, Name, Available) on the right.

const COLUMNS = [
  { id: 'price', label: 'Price', numeric: true, firstDir: 'asc' },
  { id: 'name', label: 'Name', firstDir: 'asc' },
  { id: 'level', label: 'Req. Lvl', numeric: true, firstDir: 'desc', detail: true },
  { id: 'quantity', label: 'Available', numeric: true, firstDir: 'desc' },
]

function typing(event) {
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable || Boolean(event.target.closest?.('[role="dialog"]'))
}

function rowItem(row) {
  return row.item.nameKnown || !row.variantName || row.variant ? row.item : { ...row.item, name: row.variantName }
}

// A random-suffix version is shown by its own name, as in the game.
function rowVariant(row) {
  return row.variant && row.variantName ? row.variantName : ''
}

// What a search depends on: nothing else in the URL refetches it. Searches
// show what is on the house, as in the game.
function searchUrl(state, home) {
  if (!state.market) return ''
  const params = new URLSearchParams({ market: state.market, page: String(home ? 1 : state.page), pageSize: home ? '10' : '50', listed: '1' })
  if (!home) {
    for (const key of ['q', 'category', 'sub', 'slot', 'rarity', 'minLevel', 'maxLevel', 'sort']) if (state[key]) params.set(key, state[key])
    if (state.sort) params.set('dir', state.dir)
  }
  return `/api/market/search?${params}`
}

// Nothing searched, no category, no filter: the favorites.
function isHome(state) {
  return !state.q && !state.category && !state.rarity && !state.minLevel && !state.maxLevel
}

function favoriteRow(entry) {
  const price = entry.price
  const listed = Boolean(price && !price.variantsOnly && price.quantity > 0)
  return { item: entry.item, itemKey: price?.itemKey && !price.variantsOnly ? price.itemKey : null, variant: null, variantName: null,
    ...(price && !price.variantsOnly ? price : {}), listing: listed ? 'listed' : price?.variantsOnly ? 'variants' : price ? 'none_listed' : 'unknown',
    variants: price?.variantsOnly ? price.variants.length : 0, observedAt: price?.observedAt ?? null, ageSeconds: price?.ageSeconds ?? null }
}

// The name box: suggestions as you type (their own small request), recent
// searches; Enter or Search searches what is typed.
function NameField({ value, onChange, inputRef, marketKey, onPick, onSubmit }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
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
    <div className="ah-search__box">
      <span className="ah-search__icon" aria-hidden="true" />
      <input ref={inputRef} type="search" value={value} placeholder="Search" autoComplete="off" maxLength={100}
        aria-label="Name" aria-autocomplete="list" aria-expanded={open && options.length > 0} aria-controls="ah-suggest" role="combobox"
        aria-activedescendant={active >= 0 ? `ah-opt-${active}` : undefined}
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
      {value ? <button type="button" className="ah-search__clear" aria-label="Clear search text" title="Clear"
        onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(''); inputRef.current?.focus() }} /> : null}
      {open && options.length ? (
        <ul id="ah-suggest" className="ah-suggest" role="listbox" aria-label={showRecent ? 'Recent searches' : 'Suggestions'}>
          {showRecent ? <li className="ah-suggest__head" aria-hidden="true">Recent</li> : null}
          {options.map((entry, index) => (
            <li key={entry.recent ? `r:${entry.name}` : entry.itemId} id={`ah-opt-${index}`} role="option" aria-selected={index === active}
              className={index === active ? 'is-active' : ''} onMouseDown={(event) => { event.preventDefault(); choose(entry) }}>
              {entry.recent ? <span>↺ {entry.name}</span> : (
                <>
                  <AuctionItem item={entry} size={20} />
                  <span className="ah-suggest__meta">
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

// The Filter dropdown (WowStyle1FilterDropdown): Level Range, then a
// checkbox per rarity, as in the game. A rarity applies when it is ticked;
// a level range on Enter or Search. The red X on the button clears them.
// The game's "Uncollected Only" and "Usable Only" are left out: the website
// cannot tell what a character has collected or can use.
function FilterMenu({ state, server, levels, setLevels }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false) }
    const escape = (event) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false) } }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  // Ticks show at once; the results follow.
  const [checked, setChecked] = useState(() => rarityList(state.rarity))
  useEffect(() => { setChecked(rarityList(state.rarity)) }, [state.rarity])
  const active = Boolean(state.rarity || state.minLevel || state.maxLevel || levels.minLevel || levels.maxLevel)
  const apply = (patch) => goAuction({ ...state, ...levels, ...patch, page: 1, sel: '' }, server)
  const level = (name) => (
    <input aria-label={name === 'minLevel' ? 'Minimum level' : 'Maximum level'} inputMode="numeric" value={levels[name]} maxLength={3}
      onChange={(event) => setLevels({ ...levels, [name]: event.target.value.replace(/\D/g, '') })}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); apply({}) } }} />
  )
  return (
    <div className="ah-filter" ref={ref}>
      <button type="button" className="ah-filter__button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((value) => !value)}>Filter</button>
      {active ? (
        <button type="button" className="ah-filter__clear" aria-label="Clear filters" title="Clear filters"
          onClick={() => { setLevels({ minLevel: '', maxLevel: '' }); goAuction({ ...state, minLevel: '', maxLevel: '', rarity: '', page: 1, sel: '' }, server) }} />
      ) : null}
      {open ? (
        <div className="ah-filter__menu" role="group" aria-label="Filters">
          <div className="ah-filter__title" id="ah-filter-level">Level Range</div>
          <div className="ah-filter__levels" role="group" aria-labelledby="ah-filter-level">
            {level('minLevel')}<span aria-hidden="true">-</span>{level('maxLevel')}
          </div>
          <div className="ah-filter__title" id="ah-filter-rarity">Rarity</div>
          <div className="ah-filter__checks" role="group" aria-labelledby="ah-filter-rarity">
            {RARITIES.map((rarity) => {
              const on = checked.includes(rarity.id)
              return (
                <label key={rarity.id} className={`ah-check ah-check--q${rarity.id}`}>
                  <input type="checkbox" checked={on}
                    onChange={() => {
                      const next = on ? checked.filter((id) => id !== rarity.id) : [...checked, rarity.id]
                      setChecked(next)
                      apply({ rarity: rarityValue(next) })
                    }} />
                  <span>{rarity.label}</span>
                </label>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

// AuctionHouseSearchBarTemplate: favorites, the search box, Filter, Search.
// Search (or Enter) searches the selected category with the text.
function SearchBar({ state, server, inputRef, onPick, home, picked, onFavorites, hasFavorites }) {
  const [value, setValue] = useState(state.q)
  const [levels, setLevels] = useState({ minLevel: state.minLevel, maxLevel: state.maxLevel })
  useEffect(() => { setValue(state.q) }, [state.q])
  useEffect(() => { setLevels({ minLevel: state.minLevel, maxLevel: state.maxLevel }) }, [state.minLevel, state.maxLevel])
  const search = (q = value) => goAuction({ ...state, ...levels, q: q.trim(), category: picked[0] || '', sub: picked[1] || '', slot: picked[2] || '', page: 1, sel: '' }, server)
  return (
    <form className="ah-search" role="search" aria-label="Search the auction house" onSubmit={(event) => { event.preventDefault(); search() }}>
      <button type="button" className={`ah-fav-button${home ? ' is-on' : ''}${hasFavorites ? '' : ' is-empty'}`} title="Favorites" aria-label="Show favorites" aria-pressed={home}
        onClick={() => { setValue(''); onFavorites(); goAuction({ market: state.market, tab: 'browse' }, server) }}>
        <img src="/auction-art/favorite.webp" alt="" width="40" height="36" />
      </button>
      <NameField value={value} onChange={setValue} inputRef={inputRef} marketKey={state.market} onSubmit={search}
        onPick={(entry) => { setValue(entry.name); onPick(entry) }} />
      <span className="ah-spacer" />
      <FilterMenu state={state} server={server} levels={levels} setLevels={setLevels} />
      <button type="submit" className="ah-button ah-button--search">Search</button>
    </form>
  )
}

// AuctionHouseCategoriesList, as in the game: one selected path, shown
// open; clicking a category selects it, clicking it again selects its
// parent. Choosing a category with no subcategories shows it at once;
// choosing one with subcategories only opens it, and Search shows all of
// it (opening a branch never replaces the results).
const CategoryList = memo(function CategoryList({ categories, picked, onPick }) {
  const render = (nodes, parent, depth) => nodes.map((node) => {
    const keys = [...parent, node.key]
    const path = keys.join('/')
    const children = node.subcategories || []
    const onPath = keys.length <= picked.length && keys.every((key, index) => picked[index] === key)
    const exact = onPath && keys.length === picked.length
    const expanded = onPath && children.length > 0
    return (
      <li key={path} role="treeitem" aria-selected={exact} aria-expanded={children.length ? expanded : undefined}>
        <button type="button" className={`ah-cat ah-cat--depth-${Math.min(depth, 2)}${onPath ? ' is-selected' : ''}`}
          aria-expanded={children.length ? expanded : undefined} onClick={() => onPick(keys, !children.length)}>
          <span className="ah-cat__label">{node.label}</span>
        </button>
        {expanded ? <ul role="group">{render(children, keys, depth + 1)}</ul> : null}
      </li>
    )
  })
  return (
    <nav className="ah-cats" aria-label="Categories">
      <ul role="tree" aria-label="Item categories">{render(categories, [], 0)}</ul>
    </nav>
  )
})

function Cell({ column, row }) {
  const listed = row.listing === 'listed'
  switch (column.id) {
    case 'price':
      if (listed) return <Coins value={row.minUnitBuyout} compact />
      if (row.listing === 'variants') return <span className="ah-listing ah-listing--none">{row.variants} versions</span>
      return <ListingState listing={row.listing} observedAt={row.observedAt} note={row.listingNote} ageSeconds={row.ageSeconds} />
    case 'name':
      return (
        <>
          <AuctionItem item={rowItem(row)} variantName={rowVariant(row)} size={28} />
        </>
      )
    case 'level': return row.item.requiredLevel || ''
    case 'quantity': return listed ? row.quantity.toLocaleString('en-US') : '—'
    default: return null
  }
}

// A search with nothing on this house: say so, and name the known items
// that matched but are not listed here, with why.
function NothingListed({ state, data, onInspect }) {
  const known = data?.unlisted?.items || []
  return (
    <div className="ah-empty">
      No auctions for “{state.q}” on this auction house.
      {known.length ? (
        <ul className="ah-known">{known.map((row) => (
          <li key={row.item.itemId}>
            <button type="button" className="ah-band-button" onClick={() => onInspect(row)}><AuctionItem item={row.item} size={22} /></button>
            <ListingState listing={row.listing} observedAt={row.observedAt} note={row.listingNote} ageSeconds={row.ageSeconds} />
          </li>
        ))}</ul>
      ) : <p>No item by that name or ID is known yet.</p>}
      {state.category || state.rarity || state.minLevel || state.maxLevel ? <p>A category or filter is on.</p> : null}
    </div>
  )
}

export default function AuctionBrowse({ state, server, active, inputRef, favorites, favoriteRows, favoritesStatus, onFavoritesChange, onInspect }) {
  const home = isHome(state)
  const url = searchUrl(state, home)
  // At home the request is small: its category counts fill the list.
  const search = useMarketResource(url)
  const data = search.data
  const rows = useMemo(() => (home ? favoriteRows.map(favoriteRow) : data?.results || []), [home, favoriteRows, data])
  const tableRef = useRef(null)
  const scrollRef = useRef(null)
  // The selection shows at once; the link follows (replaced, not a step).
  const [sel, setSel] = useState(state.sel)
  useEffect(() => { setSel(state.sel) }, [state.sel])
  const selected = rows.find((row) => rowId(row) === sel) || null
  const total = home ? rows.length : data?.total || 0
  const pageSize = data?.pageSize || 50
  const pages = home ? 1 : Math.max(1, Math.ceil(total / pageSize))
  const status = home ? favoritesStatus : search.status
  const detail = !home && data?.detailColumn === 'level'
  const columns = COLUMNS.filter((column) => !column.detail || detail)
  const select = (row) => {
    setSel(rowId(row))
    goAuction({ ...state, sel: rowId(row) }, server, { replace: true })
  }
  // The selected category (the game's): a link or Back sets it; clicks
  // move it without searching unless a category with no subcategories is
  // chosen.
  const urlPath = [state.category, state.sub, state.slot].filter(Boolean).join('/')
  const [picked, setPicked] = useState(() => (urlPath ? urlPath.split('/') : []))
  useEffect(() => { setPicked(urlPath ? urlPath.split('/') : []) }, [urlPath])
  const pick = useCallback((keys, leaf) => {
    const next = pickCategory(picked, keys)
    setPicked(next)
    if (leaf && next.length === keys.length) goAuction({ ...state, category: keys[0], sub: keys[1] || '', slot: keys[2] || '', page: 1, sel: '' }, server)
  }, [picked, state, server])
  const clearPicked = useCallback(() => setPicked([]), [])
  const inspect = (row) => onInspect({ itemId: row.item.itemId, itemKey: row.variant ? row.itemKey : '', name: rowVariant(row) || rowItem(row).name, qualityId: row.item.qualityId })

  // A new list starts at the top; selecting, item windows and tabs never
  // move it.
  const listKey = home ? 'home' : url
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0 }, [listKey])

  // Keys while Buy is shown: / search, ↑↓ select, Enter opens, F favorite, [ ] pages.
  useEffect(() => {
    if (!active) return undefined
    function onKey(event) {
      if ((event.key === '/' && !typing(event)) || (event.altKey && event.key.toLowerCase() === 'k')) { event.preventDefault(); inputRef.current?.focus(); return }
      if (typing(event) || event.metaKey || event.ctrlKey || event.altKey) return
      const index = rows.findIndex((row) => rowId(row) === sel)
      const move = (delta) => {
        const next = Math.max(0, Math.min(rows.length - 1, (index < 0 ? (delta > 0 ? -1 : rows.length) : index) + delta))
        if (!rows[next]) return
        select(rows[next])
        tableRef.current?.querySelectorAll('tbody tr')[next]?.scrollIntoView({ block: 'nearest' })
      }
      if (event.key === 'ArrowDown' || event.key === 'j') move(1)
      else if (event.key === 'ArrowUp' || event.key === 'k') move(-1)
      else if (event.key === 'Enter' && selected && !event.target.closest?.('button, a')) inspect(selected)
      else if (event.key === 'f' && selected) {
        const itemId = selected.item.itemId
        marketWrite(`/api/market/favorites/${itemId}`, { method: favorites.has(itemId) ? 'DELETE' : 'PUT' }).then(onFavoritesChange)
      } else if (event.key === '[' && !home && state.page > 1) goAuction({ ...state, page: state.page - 1, sel: '' }, server)
      else if (event.key === ']' && !home && state.page < pages) goAuction({ ...state, page: state.page + 1, sel: '' }, server)
      else return
      event.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const from = total ? (state.page - 1) * pageSize + 1 : 0
  const to = home ? total : Math.min(total, state.page * pageSize)
  const where = data?.filters?.category?.labels?.join(' › ')
  return (
    <div className="ah-buy" hidden={!active}>
      <SearchBar state={state} server={server} inputRef={inputRef} home={home} picked={picked} onFavorites={clearPicked} hasFavorites={favoriteRows.length > 0} onPick={(entry) => {
        goAuction({ ...state, q: entry.name, page: 1, sel: '' }, server)
        onInspect({ itemId: entry.itemId, itemKey: '', name: entry.name, qualityId: entry.qualityId })
      }} />
      <CategoryList categories={data?.categories || []} picked={picked} onPick={pick} />
      <section className="ah-list" aria-label="Results" aria-busy={status === 'loading' || status === 'refreshing'}>
        <div className="ah-list__context">
          {home ? 'Favorites' : state.q ? <>Results for “{state.q}”{where ? <small>in {where}</small> : null}</> : where || 'Results'}
        </div>
        {status === 'loading' ? <div className="ah-loading" aria-label="Searching">Searching</div> : null}
        {status === 'error' ? <div className="ah-empty">The auction house could not be searched. <button type="button" className="ah-button" onClick={search.reload}>Retry</button></div> : null}
        {home && status !== 'loading' && !rows.length ? (
          <div className="ah-empty">No favorites yet.<p>Search for an item or pick a category, then click the star to keep an item here with its price on this auction house.</p></div>
        ) : null}
        {!home && data && !rows.length && status !== 'loading' ? (state.q ? <NothingListed state={state} data={data} onInspect={inspect} />
          : <div className="ah-empty">Nothing is listed here in this category.</div>) : null}
        {rows.length ? (
          <div className="ah-table-wrap" ref={scrollRef}>
            <table ref={tableRef} className="ah-table" aria-rowcount={total + 1} aria-label="Auction items">
              <thead>
                <tr>
                  {columns.map((column) => {
                    const sorted = !home && state.sort === column.id
                    return (
                      <th key={column.id} scope="col" className={`ah-col-${column.detail ? 'detail' : column.id}`} aria-sort={sorted ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        {home ? <span className={`ah-head${column.numeric ? ' ah-head--num' : ''}`}>{column.label}</span> : (
                          <button type="button" className={`ah-head${column.numeric ? ' ah-head--num' : ''}`} onClick={() => goAuction({ ...state, ...nextSort(state, column), page: 1, sel: '' }, server)}>
                            {column.label}{sorted ? <span className={`ah-head__arrow${state.dir === 'desc' ? ' ah-head__arrow--desc' : ''}`} aria-hidden="true" /> : null}
                          </button>
                        )}
                      </th>
                    )
                  })}
                  <th scope="col" className="ah-col-fav"><span className="ah-head"><span className="gw-sr">Favorite</span></span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const id = rowId(row)
                  const isSelected = id === sel
                  return (
                    <tr key={id} data-row={id} aria-rowindex={from + index + 1} aria-selected={isSelected}
                      className={`${isSelected ? 'is-selected' : ''}${row.listing !== 'listed' ? ' is-unlisted' : ''}`}
                      onClick={() => { if (!isSelected) select(row) }} onDoubleClick={() => inspect(row)}>
                      {columns.map((column) => <td key={column.id} className={`ah-col-${column.detail ? 'detail' : column.id}`}><Cell column={column} row={row} /></td>)}
                      <td className="ah-col-fav"><FavoriteStar itemId={row.item.itemId} favorite={favorites.has(row.item.itemId)} onChange={onFavoritesChange} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {!home && total ? (
          <footer className="ah-list__foot">
            <span aria-live="polite">{from}–{to} of {total.toLocaleString('en-US')}</span>
            <span className="ah-spacer" />
            <nav className="ah-pager" aria-label="Pages">
              <button type="button" className="ah-button" style={{ minWidth: 0 }} disabled={state.page <= 1} onClick={() => goAuction({ ...state, page: state.page - 1, sel: '' }, server)} aria-label="Previous page">◀</button>
              <span>{state.page} / {pages}</span>
              <button type="button" className="ah-button" style={{ minWidth: 0 }} disabled={state.page >= pages} onClick={() => goAuction({ ...state, page: state.page + 1, sel: '' }, server)} aria-label="Next page">▶</button>
            </nav>
          </footer>
        ) : null}
        <div className="ah-selection" aria-label="Selected item">
          {selected ? (
            <>
              <AuctionItem item={rowItem(selected)} variantName={rowVariant(selected)} size={22} />
              {selected.listing === 'listed' ? (
                <>
                  <span>Buyout <Coins value={selected.minUnitBuyout} /> each</span>
                  <span><strong>{selected.quantity.toLocaleString('en-US')}</strong> available</span>
                  <Freshness price={selected} />
                </>
              ) : <ListingState listing={selected.listing} observedAt={selected.observedAt} note={selected.listingNote} ageSeconds={selected.ageSeconds} />}
              <span className="ah-spacer" />
              <button type="button" className="ah-button" onClick={() => inspect(selected)} title="Open (Enter or double-click)">Open</button>
            </>
          ) : <span>Click an item to select it, double-click to open it. Buying happens in the game.</span>}
        </div>
      </section>
    </div>
  )
}
