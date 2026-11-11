import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useSession } from '../Auth/sessionContext.js'
import { navigate } from '../Navigation/navigation.js'
import { ItemLabel } from '../Player/ui.jsx'
import MarketDiagnostics from './MarketDiagnostics.jsx'
import { MarketCharts } from './MarketCharts.jsx'
import {
  AddToList,
  Change,
  Coins,
  ConfidenceBadge,
  CraftingCosts,
  Evidence,
  FavoriteButton,
  Freshness,
  ItemMarketPanel,
  MarketSummary,
  Pct,
  PriceLadder,
  SignalChips,
  WhyThisPrice,
} from './MarketComponents.jsx'
import {
  ADMIN_TAB,
  AUCTION_TABS,
  QUALITIES,
  auctionHref,
  bindLabel,
  formatAge,
  formatChange,
  formatDateTime,
  isBlankState,
  postingSuggestion,
  readAuctionState,
  readRecentSearches,
  rememberSearch,
  storeAuctionQuery,
  storedAuctionQuery,
  unitAsk,
} from './marketFormat.js'
import { marketWrite, useMarketResource, useMarkets, useSuggestions } from './useMarket.js'

function go(state, server, options = { preserveScroll: true }) {
  navigate(auctionHref(state, server), options)
}

function typing(event) {
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable
}

function MarketPicker({ markets, market, onChange }) {
  const groups = useMemo(() => {
    const api = markets.filter((entry) => entry.kind === 'api_house')
    const game = markets.filter((entry) => entry.kind === 'client_house')
    return [['Blizzard API houses', api], ['In-game markets', game]].filter(([, list]) => list.length)
  }, [markets])
  return (
    <label className="gw-ahf__market">
      <span className="gw-sr">Market</span>
      <select value={market?.marketKey || ''} onChange={(event) => onChange(event.target.value)} aria-label="Market">
        {groups.map(([label, list]) => (
          <optgroup key={label} label={label}>
            {list.map((entry) => <option key={entry.marketKey} value={entry.marketKey}>{entry.name} · {entry.items.toLocaleString('en-US')} items</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

// How current the selected market is, in words. A broken or old source is
// never shown silently.
function MarketStatus({ market }) {
  if (!market) return null
  const failing = market.provider?.failing
  const tone = failing || market.stale ? 'warn' : 'ok'
  const text = !market.lastCheckedAt ? 'No data yet'
    : `Checked ${formatAge(market.ageSeconds)}${market.changedAgeSeconds !== null && market.lastChangedAt !== market.lastCheckedAt ? ` · changed ${formatAge(market.changedAgeSeconds)}` : ''}`
  return (
    <span className={`gw-ahf__status gw-ahf__status--${tone}`} title={failing ? `Refresh failing: ${market.provider.lastError}. Showing the last good data.` : undefined}>
      <i aria-hidden="true" />{text}{failing ? ' · refresh failing, showing last data' : market.stale ? ' · stale' : ''}
      {market.linkedMarketKey ? <span className="gw-muted"> · linked to API house</span> : null}
    </span>
  )
}

// The name box: suggestions as you type, recent searches, Enter searches.
function NameField({ state, inputRef, onSearch }) {
  const [value, setValue] = useState(state.q)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const suggestions = useSuggestions(open ? value : '', state.market)
  const [recent, setRecent] = useState(() => readRecentSearches())
  useEffect(() => { setValue(state.q) }, [state.q])
  const showRecent = open && !value.trim() && recent.length > 0
  const options = showRecent ? recent.map((entry) => ({ recent: true, name: entry })) : suggestions
  function submit(q, item = null) {
    setRecent(rememberSearch(q))
    setOpen(false)
    onSearch(q, item)
  }
  return (
    <div className="gw-ahf__name">
      <label htmlFor="gw-ah-name">Name</label>
      <input id="gw-ah-name" ref={inputRef} type="search" value={value} placeholder="Item name or ID" autoComplete="off" maxLength={100}
        aria-autocomplete="list" aria-expanded={open && options.length > 0} aria-controls="gw-ah-suggest" role="combobox"
        aria-activedescendant={active >= 0 ? `gw-ah-opt-${active}` : undefined}
        onChange={(event) => { setValue(event.target.value); setOpen(true); setActive(-1) }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((index) => Math.min(options.length - 1, index + 1)) }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(-1, index - 1)) }
          else if (event.key === 'Enter') {
            event.preventDefault()
            const chosen = options[active]
            if (chosen?.recent) submit(chosen.name)
            else if (chosen) submit(chosen.name, chosen.itemId)
            else submit(value.trim())
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
              className={index === active ? 'is-active' : ''}
              onMouseDown={(event) => { event.preventDefault(); entry.recent ? submit(entry.name) : submit(entry.name, entry.itemId) }}>
              {entry.recent ? <span className="gw-muted">↺ {entry.name}</span> : (
                <>
                  <ItemLabel item={entry} size={18} tooltip={false} />
                  <span className="gw-ahf__suggest-meta">{entry.priced ? <><Coins value={entry.minUnitBuyout} compact /> · {entry.quantity?.toLocaleString('en-US')}</> : 'none listed'}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function SearchStrip({ state, server, inputRef }) {
  const [minLevel, setMinLevel] = useState(state.minLevel)
  const [maxLevel, setMaxLevel] = useState(state.maxLevel)
  useEffect(() => { setMinLevel(state.minLevel); setMaxLevel(state.maxLevel) }, [state.minLevel, state.maxLevel])
  const search = (q = state.q, item = null) => go({ ...state, q, minLevel, maxLevel, page: 1, item: item ?? state.item, key: item ? '' : state.key }, server)
  return (
    <form className="gw-ahf__strip" role="search" aria-label="Search the auction house" onSubmit={(event) => { event.preventDefault(); search() }}>
      <NameField state={state} inputRef={inputRef} onSearch={search} />
      <div className="gw-ahf__levels">
        <span id="gw-ah-levels">Level Range</span>
        <input aria-labelledby="gw-ah-levels" aria-label="Minimum level" inputMode="numeric" value={minLevel} maxLength={3} onChange={(event) => setMinLevel(event.target.value.replace(/\D/g, ''))} />
        <span aria-hidden="true">-</span>
        <input aria-label="Maximum level" inputMode="numeric" value={maxLevel} maxLength={3} onChange={(event) => setMaxLevel(event.target.value.replace(/\D/g, ''))} />
      </div>
      <label className="gw-ahf__rarity">
        <span>Rarity</span>
        <select value={state.quality} onChange={(event) => go({ ...state, quality: event.target.value, page: 1 }, server)}>
          {QUALITIES.map((quality) => <option key={quality.id} value={quality.id}>{quality.label}</option>)}
        </select>
      </label>
      <label className="gw-ahf__check" title="Lowest ask at least 15% under its 14-day median (needs five days of history)">
        <input type="checkbox" checked={state.below} onChange={(event) => go({ ...state, below: event.target.checked, page: 1 }, server)} />
        Below market
      </label>
      <button type="submit" className="gw-ahf__search">Search</button>
    </form>
  )
}

function CategoryList({ state, server, categories, saved, onSavedChange }) {
  const [open, setOpen] = useState(() => new Set(state.category ? [state.category] : []))
  async function saveCurrent() {
    const name = window.prompt('Name this search', state.q || state.sub || state.category || 'Search')
    if (!name) return
    await marketWrite('/api/market/searches', { method: 'POST', body: { name, query: { q: state.q, category: state.category, sort: state.sort, direction: state.dir, market: state.market } } })
    onSavedChange()
  }
  return (
    <nav className="gw-ahf__cats" aria-label="Categories">
      <button type="button" className="gw-ahf__reset" onClick={() => go({ tab: 'browse', market: state.market }, server)}>Reset</button>
      <ul>
        <li><button type="button" className={!state.category ? 'is-active' : ''} aria-current={!state.category ? 'true' : undefined}
          onClick={() => go({ ...state, category: '', sub: '', page: 1 }, server)}>All categories</button></li>
        {categories.map((category) => (
          <li key={category.name}>
            <button type="button" className={state.category === category.name && !state.sub ? 'is-active' : ''} aria-expanded={open.has(category.name)}
              onClick={() => {
                setOpen((current) => new Set(current.has(category.name) && state.category === category.name ? [...current].filter((name) => name !== category.name) : [...current, category.name]))
                go({ ...state, category: category.name, sub: '', page: 1 }, server)
              }}>
              {category.name}<small>{category.items.toLocaleString('en-US')}</small>
            </button>
            {open.has(category.name) && category.subcategories.length ? (
              <ul>{category.subcategories.map((sub) => (
                <li key={sub.name}><button type="button" className={state.category === category.name && state.sub === sub.name ? 'is-active' : ''}
                  onClick={() => go({ ...state, category: category.name, sub: sub.name, page: 1 }, server)}>{sub.name}<small>{sub.items}</small></button></li>
              ))}</ul>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="gw-ahf__saved">
        <div className="gw-ahf__saved-head"><span>Saved searches</span>
          <button type="button" className="gw-btn gw-btn--xs" onClick={saveCurrent} disabled={!state.q && !state.category} title="Save this search">Save</button></div>
        {(saved || []).length ? (
          <ul>{saved.slice(0, 12).map((entry) => (
            <li key={entry.id} className="gw-ahf__savedrow">
              <a href={auctionHref({ ...state, q: entry.query.q || '', category: entry.query.category || '', sub: '', sort: entry.query.sort || 'name', dir: entry.query.direction || 'asc', page: 1, item: null }, server)}>{entry.name}</a>
              <button type="button" aria-label={`Delete saved search ${entry.name}`} onClick={() => marketWrite(`/api/market/searches/${entry.id}`, { method: 'DELETE' }).then(onSavedChange)}>×</button>
            </li>
          ))}</ul>
        ) : <p className="gw-muted gw-small">Save a search to come back to it.</p>}
      </div>
    </nav>
  )
}

// A variant whose base item has no known name is shown by its own name.
function rowItem(row) {
  return row.item.nameKnown || !row.variantName ? row.item : { ...row.item, name: row.variantName }
}

const COLUMNS = [
  { id: 'quantity', label: '#', title: 'Quantity listed', numeric: true },
  { id: 'name', label: 'Auction Item' },
  { id: 'level', label: 'Lvl', title: 'Required level', numeric: true },
  { id: 'ilvl', label: 'iLvl', title: 'Item level', numeric: true },
  { id: 'age', label: 'Seen', title: 'When the price was last seen' },
  { id: 'listings', label: 'Auctions', title: 'Number of auctions', numeric: true },
  { id: 'price', label: 'Price', title: 'Lowest ask; typical ask below', numeric: true },
  { id: 'pct', label: 'Pct', title: 'Lowest ask as a share of its 14-day median', numeric: true },
]

function SortHeader({ column, state, server }) {
  const active = state.sort === column.id
  const dir = active && state.dir === 'asc' ? 'desc' : column.numeric && !active ? (column.id === 'price' || column.id === 'pct' ? 'asc' : 'desc') : 'asc'
  return (
    <th scope="col" className={`${column.numeric ? 'gw-col-num' : ''} gw-ahf__col-${column.id}`} aria-sort={active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'} title={column.title}>
      <button type="button" className="gw-sort" onClick={() => go({ ...state, sort: column.id, dir, page: 1 }, server)}>
        {column.label}<span aria-hidden="true">{active ? (state.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
      </button>
    </th>
  )
}

function useDrawerWidth() {
  const [width, setWidth] = useState(() => {
    try { return Math.min(760, Math.max(320, Number(localStorage.getItem('guildweaver:auctions:drawer')) || 420)) } catch { return 420 }
  })
  const start = useCallback((event) => {
    event.preventDefault()
    const origin = event.clientX
    const initial = width
    const move = (moveEvent) => setWidth(Math.min(760, Math.max(320, initial + origin - moveEvent.clientX)))
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      setWidth((value) => { try { localStorage.setItem('guildweaver:auctions:drawer', String(value)) } catch { /* convenience */ } return value })
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }, [width])
  const nudge = useCallback((delta) => setWidth((value) => Math.min(760, Math.max(320, value + delta))), [])
  return { width, start, nudge }
}

function BrowseTab({ state, server, inputRef, favorites, onFavoritesChange, setActionBar }) {
  const params = new URLSearchParams({ market: state.market, q: state.q, category: state.category, sub: state.sub, quality: state.quality,
    minLevel: state.minLevel, maxLevel: state.maxLevel, sort: state.sort, dir: state.dir, page: String(state.page), pageSize: '50', ...(state.below ? { below: '1' } : {}) })
  const url = state.market ? `/api/market/search?${params}` : ''
  const search = useMarketResource(url)
  const saved = useMarketResource('/api/market/searches')
  const rows = useMemo(() => search.data?.results || [], [search.data])
  const [selected, setSelected] = useState(-1)
  const drawer = useDrawerWidth()
  const tableRef = useRef(null)
  // The open item is the selected row; closing it keeps the selection.
  useEffect(() => {
    const index = rows.findIndex((row) => row.item.itemId === state.item && (!state.key || row.itemKey === state.key))
    setSelected((current) => (state.item ? index : Math.min(current, rows.length - 1)))
  }, [rows, state.item, state.key])
  const current = selected >= 0 ? rows[selected] : null
  const total = search.data?.total || 0
  const pageSize = search.data?.pageSize || 50
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const open = (row) => go({ ...state, item: row.item.itemId, key: row.variant ? row.itemKey : '' }, server, { preserveScroll: true, replace: true })

  useEffect(() => {
    setActionBar(current ? { row: current, stack: state.stack } : null)
  }, [current, state.stack, setActionBar])

  // Keys: / or Alt+K search, ↑↓ or j/k move, Enter opens, Esc closes,
  // F favorite, A add to list, H history, [ ] pages.
  useEffect(() => {
    function onKey(event) {
      if ((event.key === '/' && !typing(event)) || (event.altKey && event.key.toLowerCase() === 'k')) { event.preventDefault(); inputRef.current?.focus(); return }
      if (typing(event) || event.metaKey || event.ctrlKey || event.altKey) return
      const move = (delta) => {
        const next = Math.max(0, Math.min(rows.length - 1, (selected < 0 ? (delta > 0 ? -1 : rows.length) : selected) + delta))
        setSelected(next)
        tableRef.current?.querySelectorAll('tbody tr')[next]?.scrollIntoView({ block: 'nearest' })
      }
      if (event.key === 'ArrowDown' || event.key === 'j') move(1)
      else if (event.key === 'ArrowUp' || event.key === 'k') move(-1)
      else if (event.key === 'Enter' && current) open(current)
      else if (event.key === 'Escape' && state.item) go({ ...state, item: null, key: '' }, server)
      else if (event.key === 'f' && current) {
        const itemId = current.item.itemId
        marketWrite(`/api/market/favorites/${itemId}`, { method: favorites.has(itemId) ? 'DELETE' : 'PUT' }).then(onFavoritesChange)
      } else if (event.key === 'h' && current) go({ ...state, tab: 'history', item: current.item.itemId, key: current.variant ? current.itemKey : '' }, server)
      else if (event.key === '[' && state.page > 1) go({ ...state, page: state.page - 1 }, server)
      else if (event.key === ']' && state.page < pages) go({ ...state, page: state.page + 1 }, server)
      else return
      event.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const from = total ? (state.page - 1) * pageSize + 1 : 0
  const to = Math.min(total, state.page * pageSize)
  return (
    <div className={`gw-ahf__browse${state.item ? ' has-drawer' : ''}`} style={state.item ? { '--gw-drawer': `${drawer.width}px` } : undefined}>
      <SearchStrip state={state} server={server} inputRef={inputRef} />
      <CategoryList state={state} server={server} categories={search.data?.categories || []} saved={saved.data?.searches} onSavedChange={saved.reload} />
      <section className="gw-ahf__results" aria-label="Results">
        {search.status === 'loading' ? <div className="gw-skeleton gw-ahf__skeleton" aria-busy="true">{Array.from({ length: 14 }, (_, index) => <div key={index} className="gw-skeleton__row" />)}</div> : null}
        {search.status === 'error' ? <p className="gw-ahf__empty">Search failed. <button type="button" className="gw-btn gw-btn--sm" onClick={search.reload}>Retry</button></p> : null}
        {search.data && !rows.length ? (
          <div className="gw-ahf__empty">
            <strong>{state.q || state.category || state.quality || state.below || state.minLevel || state.maxLevel ? 'No items match.' : 'This market has no listings yet.'}</strong>
            <p>{state.below ? 'Below market needs five days of history per item. ' : ''}Prices come from Blizzard's auction API and from players' in-game auction house searches. Nothing is estimated.</p>
          </div>
        ) : null}
        {rows.length ? (
          <div className="gw-ahf__tablewrap">
            <table ref={tableRef} className={`gw-ahf__table${search.status === 'refreshing' ? ' is-refreshing' : ''}`} aria-rowcount={total} aria-label="Auction items">
              <thead>
                <tr>{COLUMNS.map((column) => <SortHeader key={column.id} column={column} state={state} server={server} />)}<th scope="col" aria-label="Favorite" /></tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const stack = state.stack && row.item.stackCount > 1 ? row.item.stackCount : 1
                  const isOpen = state.item === row.item.itemId && (!state.key || state.key === row.itemKey)
                  return (
                    <tr key={row.itemKey} aria-rowindex={from + index} aria-selected={index === selected}
                      className={`${index === selected ? 'is-selected' : ''}${isOpen ? ' is-open' : ''}${row.stale ? ' is-stale' : ''}`}
                      onClick={() => { setSelected(index); open(row) }}>
                      <td className="gw-col-num gw-ahf__qty">{row.quantity.toLocaleString('en-US')}</td>
                      <td className="gw-ahf__item">
                        <ItemLabel item={rowItem(row)} size={20} />
                        {row.variantName && row.item.nameKnown ? <span className="gw-ahf__variant">{row.variantName}</span> : null}
                      </td>
                      <td className="gw-col-num">{row.item.requiredLevel || ''}</td>
                      <td className="gw-col-num">{row.item.itemLevel || ''}</td>
                      <td><Freshness price={row} showSource={false} short /></td>
                      <td className="gw-col-num">{row.listings ?? '—'}</td>
                      <td className="gw-col-num gw-ahf__price">
                        <Coins value={row.minUnitBuyout === null ? null : row.minUnitBuyout * stack} compact />
                        {row.typicalUnitBuyout !== null && row.typicalUnitBuyout !== row.minUnitBuyout ? <Coins value={row.typicalUnitBuyout * stack} muted compact /> : null}
                      </td>
                      <td className="gw-col-num"><Pct value={row.pct} days={row.referenceDays} /></td>
                      <td><FavoriteButton itemId={row.item.itemId} favorite={favorites.has(row.item.itemId)} onChange={onFavoritesChange} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <footer className="gw-ahf__foot">
          <label className="gw-ahf__check">
            <input type="checkbox" checked={!state.stack} onChange={(event) => go({ ...state, stack: !event.target.checked }, server)} />
            Show stacks as price per unit
          </label>
          <span className="gw-ahf__count" aria-live="polite">{total ? `Items ${from} - ${to} (${total.toLocaleString('en-US')} total)` : search.data ? 'No items' : ''}</span>
          <nav className="gw-ahf__pager" aria-label="Pages">
            <button type="button" disabled={state.page <= 1} onClick={() => go({ ...state, page: state.page - 1 }, server)} aria-label="Previous page">◀ Prev</button>
            <span>{state.page}/{pages}</span>
            <button type="button" disabled={state.page >= pages} onClick={() => go({ ...state, page: state.page + 1 }, server)} aria-label="Next page">Next ▶</button>
          </nav>
        </footer>
      </section>
      {state.item ? (
        <aside className="gw-ahf__drawer" aria-label="Item market">
          <div className="gw-ahf__grip" role="separator" aria-orientation="vertical" aria-label="Resize item panel" tabIndex={0} onPointerDown={drawer.start}
            onKeyDown={(event) => { if (event.key === 'ArrowLeft') drawer.nudge(24); if (event.key === 'ArrowRight') drawer.nudge(-24) }} />
          <button type="button" className="gw-ahf__close" onClick={() => go({ ...state, item: null, key: '' }, server)} aria-label="Close item (Esc)">×</button>
          <ItemMarketPanel itemId={state.item} itemKey={state.key} marketKey={state.market} range={state.range} onRange={(range) => go({ ...state, range }, server)}
            onVariant={(key) => go({ ...state, key }, server)} onFavoriteChange={onFavoritesChange} stackPrices={state.stack}
            historyHref={auctionHref({ ...state, tab: 'history' }, server)} />
        </aside>
      ) : null}
    </div>
  )
}

// The bar under the table, where the game has Bid and Buyout: what the
// selected item costs and what can be done with it here. Nothing buys.
function ActionBar({ state, server, selection, favorites, onFavoritesChange }) {
  const row = selection?.row
  const stack = selection?.stack && row?.item.stackCount > 1 ? row.item.stackCount : 1
  return (
    <div className="gw-ahf__actions" aria-label="Selected item">
      {row ? (
        <>
          <span className="gw-ahf__selected"><ItemLabel item={rowItem(row)} size={18} tooltip={false} />{row.variantName && row.item.nameKnown ? <span className="gw-ahf__variant">{row.variantName}</span> : null}</span>
          <span className="gw-ahf__buyout">Lowest <Coins value={row.minUnitBuyout === null ? null : row.minUnitBuyout * stack} />{stack > 1 ? <small> / stack of {stack}</small> : <small> each</small>}</span>
          <span className="gw-ahf__spacer" />
          <FavoriteButton itemId={row.item.itemId} favorite={favorites.has(row.item.itemId)} onChange={onFavoritesChange} />
          <AddToList itemId={row.item.itemId} className="gw-ahf__btn" />
          <button type="button" className="gw-ahf__btn" onClick={() => go({ ...state, tab: 'appraiser', item: row.item.itemId, key: row.variant ? row.itemKey : '' }, server)}>Appraise</button>
          <button type="button" className="gw-ahf__btn" onClick={() => go({ ...state, tab: 'history', item: row.item.itemId, key: row.variant ? row.itemKey : '' }, server)}>History</button>
        </>
      ) : <span className="gw-muted">Select an item. Guildweaver shows prices; buying and posting happen in the game.</span>}
      {state.item ? <button type="button" className="gw-ahf__btn gw-ahf__btn--close" onClick={() => go({ ...state, item: null, key: '' }, server)}>Close</button> : null}
    </div>
  )
}

// Item picker for tabs that work on one item (Appraiser, History).
function ItemPicker({ state, server, label = 'Item' }) {
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const suggestions = useSuggestions(open ? value : '', state.market)
  return (
    <div className="gw-ahf__picker">
      <label htmlFor="gw-ah-pick">{label}</label>
      <input id="gw-ah-pick" type="search" placeholder="Find an item…" value={value} autoComplete="off" onChange={(event) => { setValue(event.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => { if (event.key === 'Enter' && suggestions[0]) { event.preventDefault(); setOpen(false); go({ ...state, item: suggestions[0].itemId, key: '' }, server) } }} />
      {open && suggestions.length ? (
        <ul className="gw-ahf__suggest" role="listbox">{suggestions.map((entry) => (
          <li key={entry.itemId} role="option" aria-selected="false" onMouseDown={(event) => { event.preventDefault(); setOpen(false); setValue(''); go({ ...state, item: entry.itemId, key: '' }, server) }}>
            <ItemLabel item={entry} size={18} tooltip={false} />
          </li>
        ))}</ul>
      ) : null}
    </div>
  )
}

// Sidebar of items to pick from: favorites, then items from shopping lists.
function WatchList({ state, server, favorites }) {
  return (
    <nav className="gw-ahf__watch" aria-label="Your items">
      <h3>Favorites</h3>
      {favorites.length ? (
        <ul>{favorites.map((entry) => (
          <li key={entry.item.itemId}>
            <a href={auctionHref({ ...state, item: entry.item.itemId, key: '' }, server)} className={state.item === entry.item.itemId ? 'is-active' : ''}>
              <ItemLabel item={entry.item} size={18} tooltip={false} />
              <Coins value={unitAsk(entry.price)} compact />
            </a>
          </li>
        ))}</ul>
      ) : <p className="gw-muted gw-small">Star items to keep them here.</p>}
    </nav>
  )
}

function useItemData(state) {
  const query = `market=${encodeURIComponent(state.market || '')}${state.key ? `&key=${encodeURIComponent(state.key)}` : ''}`
  const detail = useMarketResource(state.item ? `/api/market/items/${state.item}?${query}` : '')
  const analysis = useMarketResource(state.item && state.market ? `/api/market/items/${state.item}/analysis?${query}` : '')
  return { detail, analysis, here: detail.data?.variants?.find((entry) => entry.itemKey === detail.data.itemKey) || null }
}

// Appraiser: what an item is worth here before posting it in the game.
function AppraiserTab({ state, server, favorites }) {
  const { detail, analysis, here } = useItemData(state)
  const item = detail.data?.item
  const metrics = analysis.data?.metrics
  const suggestion = here ? postingSuggestion({ ...here, sellPrice: item?.sellPrice }) : null
  const stack = item?.stackCount || 1
  return (
    <div className="gw-ahf__split">
      <aside className="gw-ahf__side">
        <ItemPicker state={state} server={server} />
        <WatchList state={state} server={server} favorites={favorites} />
      </aside>
      <section className="gw-ahf__pane" aria-label="Valuation">
        {!state.item ? <div className="gw-ahf__empty"><strong>Pick an item to appraise.</strong><p>See current asks, the typical price, recent medians, competition, vendor value and a starting price, then post it in the game.</p></div> : null}
        {detail.status === 'loading' ? <div className="gw-skeleton"><div className="gw-skeleton__row" /><div className="gw-skeleton__row" /></div> : null}
        {item ? (
          <>
            <header className="gw-ahf__panehead">
              <ItemLabel item={item} size={36} />
              <span className="gw-muted gw-small">{[item.itemClass, item.itemSubclass, item.stackCount > 1 ? `stacks to ${item.stackCount}` : null, bindLabel(item.bindType)].filter(Boolean).join(' · ')}</span>
            </header>
            {here ? <MarketSummary summary={here} metrics={metrics} /> : <p className="gw-muted">No listings seen for this item in this market. There is no market price to start from.</p>}
            <SignalChips signals={analysis.data?.signals} />
            <div className="gw-ahf__grid2">
              <section className="gw-msec">
                <h3>Posting</h3>
                <dl className="gw-mfacts">
                  <div><dt>Starting point (each)</dt><dd>{suggestion ? <Coins value={suggestion.unitPrice} /> : <span className="gw-muted">no market price</span>}</dd></div>
                  {stack > 1 ? <div><dt>Per stack of {stack}</dt><dd>{suggestion ? <Coins value={suggestion.unitPrice * stack} /> : '—'}</dd></div> : null}
                  <div><dt>Vendor value</dt><dd>{item.sellPrice === null ? <span className="gw-muted">unknown</span> : <Coins value={item.sellPrice} />}</dd></div>
                  <div><dt>After the auction cut</dt><dd>{suggestion ? <Coins value={Math.floor(suggestion.unitPrice * 0.95)} /> : '—'}<small> 5% (15% at Blackwater)</small></dd></div>
                  <div><dt>30-day median</dt><dd>{metrics?.median30d?.value ? <Coins value={metrics.median30d.value} /> : <span className="gw-muted" title={metrics?.median30d?.reason}>not enough data</span>}</dd></div>
                  <div><dt>30-day range</dt><dd>{metrics?.range30d ? <><Coins value={metrics.range30d.low} compact /> – <Coins value={metrics.range30d.high} compact /></> : '—'}</dd></div>
                </dl>
                <p className="gw-small gw-muted">{suggestion?.belowVendor ? 'The market is below vendor value: a vendor pays more. ' : ''}One copper under the lowest ask, never under vendor value. A deposit is lost if the auction expires. Post from the game: this website cannot post, buy or cancel auctions.</p>
              </section>
              <section className="gw-msec">
                <h3>Competition</h3>
                {here ? (
                  <>
                    <p className="gw-small">{here.listings ?? '?'} auctions, {here.quantity.toLocaleString('en-US')} listed{metrics?.supply?.median7d ? ` (7-day median ${metrics.supply.median7d.toLocaleString('en-US')})` : ''}.</p>
                    <PriceLadder points={here.pricePoints} />
                  </>
                ) : <p className="gw-muted gw-small">No competition seen.</p>}
              </section>
            </div>
            <WhyThisPrice summary={here} />
            <CraftingCosts itemId={item.itemId} marketKey={state.market} />
            <Evidence evidence={detail.data.evidence} basis={detail.data.basis} />
          </>
        ) : null}
      </section>
    </div>
  )
}

function ShoppingTab({ state, server }) {
  const lists = useMarketResource(state.market ? `/api/market/lists?market=${encodeURIComponent(state.market)}` : '/api/market/lists')
  const all = lists.data?.lists || []
  const current = all.find((list) => list.id === state.list) || all[0] || null
  const [newName, setNewName] = useState('')
  async function create(event) {
    event.preventDefault()
    const name = newName.trim()
    if (!name) return
    const created = await marketWrite('/api/market/lists', { method: 'POST', body: { name, purpose: 'personal' } })
    setNewName('')
    lists.reload()
    go({ ...state, list: created.list.id }, server)
  }
  async function update(itemId, body) {
    await marketWrite(`/api/market/lists/${current.id}/items/${itemId}`, { body })
    lists.reload()
  }
  return (
    <div className="gw-ahf__split">
      <aside className="gw-ahf__side">
        <nav className="gw-ahf__lists" aria-label="Shopping lists">
          <h3>Lists</h3>
          <ul>{all.map((list) => (
            <li key={list.id}><a href={auctionHref({ ...state, list: list.id }, server)} className={current?.id === list.id ? 'is-active' : ''} aria-current={current?.id === list.id ? 'page' : undefined}>
              {list.name}<small>{list.items.length}</small></a></li>
          ))}</ul>
          <form onSubmit={create} className="gw-ahf__newlist">
            <input aria-label="New list name" placeholder="New list" value={newName} maxLength={60} onChange={(event) => setNewName(event.target.value)} />
            <button type="submit" className="gw-btn gw-btn--xs">Add</button>
          </form>
        </nav>
      </aside>
      <section className="gw-ahf__pane" aria-label="Shopping list">
        {lists.status === 'loading' ? <div className="gw-skeleton"><div className="gw-skeleton__row" /></div> : null}
        {!current && lists.data ? <div className="gw-ahf__empty"><strong>No shopping lists yet.</strong><p>Create one for a crafting project, raid night or a goal, then add items from Browse with “+ List” (or press A).</p></div> : null}
        {current ? (
          <>
            <header className="gw-ahf__listhead">
              <input className="gw-ahf__listname" aria-label="List name" defaultValue={current.name} key={current.id} maxLength={60}
                onBlur={(event) => { if (event.target.value.trim() && event.target.value !== current.name) marketWrite(`/api/market/lists/${current.id}`, { method: 'PATCH', body: { name: event.target.value } }).then(lists.reload) }} />
              <select aria-label="List purpose" value={current.purpose} onChange={(event) => marketWrite(`/api/market/lists/${current.id}`, { method: 'PATCH', body: { purpose: event.target.value } }).then(lists.reload)}>
                <option value="personal">Personal goal</option><option value="crafting">Crafting project</option><option value="dungeon">Dungeon prep</option>
              </select>
              <button type="button" className="gw-btn gw-btn--sm" onClick={() => { if (window.confirm(`Delete “${current.name}”?`)) marketWrite(`/api/market/lists/${current.id}`, { method: 'DELETE' }).then(() => { lists.reload(); go({ ...state, list: null }, server) }) }}>Delete list</button>
            </header>
            {current.items.length ? (
              <div className="gw-ahf__tablewrap">
                <table className="gw-ahf__table gw-ahf__table--plain">
                  <thead><tr><th scope="col">Item</th><th scope="col" className="gw-col-num">Want</th><th scope="col" className="gw-col-num">Bought</th>
                    <th scope="col" className="gw-col-num">Unit ask</th><th scope="col" className="gw-col-num">Still to buy</th><th scope="col">Seen</th><th scope="col" aria-label="Actions" /></tr></thead>
                  <tbody>{current.items.map((entry) => (
                    <tr key={entry.item.itemId} className={entry.purchased >= entry.quantity ? 'is-done' : ''}>
                      <td><a href={auctionHref({ ...state, tab: 'browse', item: entry.item.itemId, q: entry.item.name, page: 1 }, server)}><ItemLabel item={entry.item} size={20} /></a></td>
                      <td className="gw-col-num"><input type="number" min="1" max="100000" aria-label={`Quantity of ${entry.item.name}`} defaultValue={entry.quantity}
                        onBlur={(event) => Number(event.target.value) !== entry.quantity && update(entry.item.itemId, { quantity: Number(event.target.value) })} /></td>
                      <td className="gw-col-num"><input type="number" min="0" max={entry.quantity} aria-label={`Bought of ${entry.item.name}`} defaultValue={entry.purchased}
                        onBlur={(event) => Number(event.target.value) !== entry.purchased && update(entry.item.itemId, { purchased: Number(event.target.value) })} /></td>
                      <td className="gw-col-num">{entry.price?.variantsOnly ? <span className="gw-muted" title={entry.price.selectionReason}>{entry.price.variants.length} versions</span> : <Coins value={unitAsk(entry.price)} compact />}</td>
                      <td className="gw-col-num"><Coins value={entry.estimatedCost} compact /></td>
                      <td><Freshness price={entry.price} showSource={false} short /></td>
                      <td className="gw-ahf__rowact">
                        <button type="button" className="gw-btn gw-btn--xs" onClick={() => update(entry.item.itemId, { purchased: entry.quantity })} disabled={entry.purchased >= entry.quantity}>Bought all</button>
                        <button type="button" className="gw-btn gw-btn--xs" aria-label={`Remove ${entry.item.name}`}
                          onClick={() => marketWrite(`/api/market/lists/${current.id}/items/${entry.item.itemId}`, { method: 'DELETE' }).then(lists.reload)}>×</button>
                      </td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr><th scope="row" colSpan={4}>Estimated total</th><td className="gw-col-num"><Coins value={current.estimate.copper} /></td>
                    <td colSpan={2} className="gw-small gw-muted">{current.estimate.missingPrices ? `${current.estimate.missingPrices} without a price` : ''}</td></tr></tfoot>
                </table>
              </div>
            ) : <div className="gw-ahf__empty"><p>Empty list. Add items from Browse with “+ List”.</p></div>}
            <p className="gw-small gw-muted">{current.estimate.basis}. Mark items bought as you go; the website does not buy anything.</p>
          </>
        ) : null}
      </section>
    </div>
  )
}

function AlertInput({ entry, onSaved }) {
  const [value, setValue] = useState(entry.alert?.below ? String(Math.round(entry.alert.below / 100) / 100) : '')
  return (
    <input className="gw-ahf__target" inputMode="decimal" placeholder="—" aria-label={`Target price in gold for ${entry.item.name}`} value={value}
      title="Target price in gold. Highlighted when the lowest ask is at or under it. No notifications are sent."
      onChange={(event) => setValue(event.target.value.replace(/[^\d.]/g, ''))}
      onBlur={() => {
        const below = value ? Math.round(Number(value) * 10000) : null
        if (below === (entry.alert?.below ?? null)) return
        marketWrite(`/api/market/favorites/${entry.item.itemId}`, { method: 'PATCH', body: { alertBelow: below } }).then(onSaved)
      }} />
  )
}

function FavoritesTab({ state, server, favorites, status, onChange }) {
  if (status === 'loading') return <div className="gw-skeleton"><div className="gw-skeleton__row" /><div className="gw-skeleton__row" /></div>
  if (!favorites.length) return <div className="gw-ahf__pane"><div className="gw-ahf__empty"><strong>No favorites yet.</strong><p>Star items in Browse (or press F) to watch their prices, recent movement and supply here. Houses holding favorites refresh first; Blizzard's API updates whole houses, so single items cannot be refreshed sooner.</p></div></div>
  return (
    <section className="gw-ahf__pane" aria-label="Favorites">
      <div className="gw-ahf__tablewrap">
        <table className="gw-ahf__table gw-ahf__table--plain">
          <thead><tr><th scope="col" aria-label="Favorite" /><th scope="col">Item</th><th scope="col" className="gw-col-num">Lowest</th><th scope="col" className="gw-col-num">24 h</th>
            <th scope="col" className="gw-col-num">7 d median</th><th scope="col" className="gw-col-num">vs median</th><th scope="col" className="gw-col-num">Listed</th>
            <th scope="col">Observations</th><th scope="col">Coverage</th><th scope="col" className="gw-col-num">Target (g)</th><th scope="col" aria-label="History" /></tr></thead>
          <tbody>{favorites.map((entry) => {
            const metrics = entry.metrics
            const supply = metrics?.supply?.changePct
            return (
              <tr key={entry.item.itemId} className={entry.alertState === 'below' ? 'is-target' : ''}>
                <td><FavoriteButton itemId={entry.item.itemId} favorite onChange={onChange} /></td>
                <td><a href={auctionHref({ ...state, tab: 'browse', item: entry.item.itemId, q: entry.item.name, page: 1 }, server)}><ItemLabel item={entry.item} size={20} /></a></td>
                <td className="gw-col-num">{entry.price?.variantsOnly ? <span className="gw-muted">{entry.price.variants.length} versions</span> : <Coins value={entry.price?.minUnitBuyout} compact />}</td>
                <td className="gw-col-num"><Change pct={metrics?.change24h?.pct ?? entry.price?.change24hPct} /></td>
                <td className="gw-col-num">{metrics?.median7d?.value ? <Coins value={metrics.median7d.value} compact /> : <span className="gw-muted" title={metrics?.median7d?.reason}>—</span>}</td>
                <td className="gw-col-num"><Change pct={metrics?.vsTypical?.pct} /></td>
                <td className="gw-col-num">{entry.price ? entry.price.quantity.toLocaleString('en-US') : '—'}{supply !== null && supply !== undefined ? <small className="gw-muted"> {formatChange(supply).text}</small> : null}</td>
                <td><SignalChips signals={entry.signals} limit={2} /></td>
                <td><Freshness price={entry.price} showSource={false} short />{metrics?.coverage ? <small className="gw-muted"> · {metrics.coverage.hours7d}/168 h</small> : null}</td>
                <td className="gw-col-num"><AlertInput entry={entry} onSaved={onChange} /></td>
                <td><a className="gw-btn gw-btn--xs" href={auctionHref({ ...state, tab: 'history', item: entry.item.itemId, key: '' }, server)}>History</a></td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
      <p className="gw-small gw-muted">Movement and medians use asking prices that were observed; listings that disappear are not counted as sales. Targets are kept for alerts later; nothing is sent today.</p>
    </section>
  )
}

function MetricsTable({ metrics }) {
  if (!metrics) return null
  const row = (label, value, note) => <tr><th scope="row">{label}</th><td className="gw-col-num">{value}</td><td className="gw-small gw-muted">{note}</td></tr>
  return (
    <table className="gw-table gw-table--dense gw-ahf__metrics">
      <tbody>
        {row('Change, 24 h', <Change pct={metrics.change24h.pct} />, metrics.change24h.reason || `vs ${formatDateTime(metrics.change24h.at)}`)}
        {row('Median, 7 days', metrics.median7d.value ? <Coins value={metrics.median7d.value} /> : '—', metrics.median7d.reason || `${metrics.median7d.basis}, ${metrics.median7d.samples} hours`)}
        {row('Median, 30 days', metrics.median30d.value ? <Coins value={metrics.median30d.value} /> : '—', metrics.median30d.reason || `${metrics.median30d.basis}, ${metrics.median30d.samples} days`)}
        {row('Range, 7 days', metrics.range7d ? <><Coins value={metrics.range7d.low} compact /> – <Coins value={metrics.range7d.high} compact /></> : '—', metrics.range7d ? 'lowest ask seen to highest typical ask' : 'no observations')}
        {row('Range, 30 days', metrics.range30d ? <><Coins value={metrics.range30d.low} compact /> – <Coins value={metrics.range30d.high} compact /></> : '—', metrics.range30d ? `${metrics.range30d.samples} days` : 'no observations')}
        {row('Now vs typical', <Change pct={metrics.vsTypical.pct} />, metrics.vsTypical.basis ? `typical ask vs ${metrics.vsTypical.basis}` : 'not enough history')}
        {row('Volatility', metrics.volatility30d.value === null ? '—' : `${Math.round(metrics.volatility30d.value * 100)}% / day`, metrics.volatility30d.reason || `${metrics.volatility30d.level}; ${metrics.volatility30d.basis}`)}
        {row('Supply vs 7 days', <Change pct={metrics.supply.changePct} />, metrics.supply.median7d !== null ? `${metrics.supply.quantity?.toLocaleString('en-US')} now, median ${metrics.supply.median7d.toLocaleString('en-US')}` : 'not enough history')}
        {row('Auctions vs 7 days', <Change pct={metrics.supply.listingsChangePct} />, metrics.supply.listingsMedian7d !== null ? `${metrics.supply.listings} now, median ${metrics.supply.listingsMedian7d}` : '—')}
        {row('Coverage', `${metrics.coverage.hours7d}/168 h · ${metrics.coverage.days30d}/30 d`, 'hours and days with at least one complete observation')}
      </tbody>
    </table>
  )
}

function HistoryTab({ state, server, favorites }) {
  const { detail, analysis, here } = useItemData(state)
  const focusKey = detail.data?.itemKey || state.key
  const history = useMarketResource(state.item && state.market ? `/api/market/items/${state.item}/history?market=${encodeURIComponent(state.market)}&range=${state.range}${focusKey ? `&key=${encodeURIComponent(focusKey)}` : ''}` : '')
  const item = detail.data?.item
  const metrics = analysis.data?.metrics
  return (
    <div className="gw-ahf__split">
      <aside className="gw-ahf__side">
        <ItemPicker state={state} server={server} />
        <WatchList state={state} server={server} favorites={favorites} />
      </aside>
      <section className="gw-ahf__pane" aria-label="Price history">
        {!state.item ? <div className="gw-ahf__empty"><strong>Pick an item to see its history.</strong><p>Asking prices and supply by the hour (24 h, 7 d), by the day (30 d to 1 y) and by the week (All).</p></div> : null}
        {item ? (
          <>
            <header className="gw-ahf__panehead">
              <ItemLabel item={item} size={36} />
              {detail.data.variants.length > 1 ? (
                <select aria-label="Item version" value={focusKey} onChange={(event) => go({ ...state, key: event.target.value }, server)}>
                  {detail.data.variants.map((entry) => <option key={entry.itemKey} value={entry.itemKey}>{entry.label}</option>)}
                </select>
              ) : null}
              <a className="gw-btn gw-btn--sm" href={auctionHref({ ...state, tab: 'browse', q: item.name, page: 1 }, server)}>Show in Browse</a>
            </header>
            {here ? <MarketSummary summary={here} metrics={metrics} /> : null}
            {analysis.data?.note ? <p className="gw-callout-inline">{analysis.data.note}</p> : null}
            <MarketCharts history={history.data} range={state.range} onRange={(range) => go({ ...state, range }, server)} status={history.status} />
            <div className="gw-ahf__grid2">
              <section className="gw-msec">
                <h3>Metrics</h3>
                <MetricsTable metrics={metrics} />
              </section>
              <section className="gw-msec">
                <h3>Observations</h3>
                {analysis.data?.signals?.length ? (
                  <ul className="gw-ahf__signals">{analysis.data.signals.map((signal) => (
                    <li key={signal.type}>
                      <SignalChips signals={[signal]} />
                      <p>{signal.explanation}</p>
                      <small className="gw-muted">{signal.samples} observation{signal.samples === 1 ? '' : 's'}{signal.window?.from ? ` · ${formatDateTime(signal.window.from)} – ${formatDateTime(signal.window.to)}` : ''} · {signal.confidence} confidence</small>
                    </li>
                  ))}</ul>
                ) : <p className="gw-muted gw-small">Nothing unusual in the observed history{metrics && !metrics.median7d.value && !metrics.median30d.value ? ', and too little of it to judge' : ''}.</p>}
                {metrics?.spikes?.length ? (
                  <>
                    <h4>Spikes and dips, 7 days</h4>
                    <ul className="gw-plain gw-small">{metrics.spikes.map((spike) => <li key={spike.at}>{formatDateTime(spike.at)}: <Coins value={spike.price} compact /> ({formatChange(spike.pct).text} vs median)</li>)}</ul>
                  </>
                ) : null}
                <p className="gw-small gw-muted">{analysis.data?.disclaimer}</p>
              </section>
            </div>
            <WhyThisPrice summary={here} />
            {here ? <p className="gw-small"><ConfidenceBadge confidence={here.confidence} /> <Freshness price={here} /></p> : null}
          </>
        ) : null}
      </section>
    </div>
  )
}

// The Auction House: one frame laid out like the game's (search strip,
// categories, results, action bar, tabs along the bottom), for the selected
// market, with all state in the URL.
export default function PlayerAuctions({ server = '', queryString = '' }) {
  const session = useSession()
  const isAdmin = session.hasPermission?.('site.admin') === true
  // Opening the Auction House from the menu returns to the last search.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const last = storedAuctionQuery()
    if (isBlankState(queryString) && last && !isBlankState(last)) {
      const params = new URLSearchParams(last)
      if (server) params.set('server', server)
      navigate(`/dashboard/auctions?${params}`, { replace: true, preserveScroll: true })
    }
  }, [queryString, server])
  useEffect(() => { if (!isBlankState(queryString)) storeAuctionQuery(queryString) }, [queryString])

  const requested = useMemo(() => readAuctionState(queryString), [queryString])
  const { status, markets, marketKey, market } = useMarkets(requested.market)
  const state = useMemo(() => ({ ...requested, market: marketKey }), [requested, marketKey])
  const favoriteData = useMarketResource(`/api/market/favorites?market=${encodeURIComponent(marketKey || '')}`)
  const favoriteRows = useMemo(() => favoriteData.data?.favorites || [], [favoriteData.data])
  const favoriteSet = useMemo(() => new Set(favoriteRows.map((entry) => entry.item.itemId)), [favoriteRows])
  const inputRef = useRef(null)
  const [selection, setSelection] = useState(null)
  const tabs = useMemo(() => (isAdmin ? [...AUCTION_TABS, ADMIN_TAB] : AUCTION_TABS), [isAdmin])

  // Alt+1…6 switch tabs.
  useEffect(() => {
    function onKey(event) {
      if (!event.altKey || event.metaKey || event.ctrlKey) return
      const tab = tabs.find((entry) => entry.key === event.key)
      if (!tab) return
      event.preventDefault()
      go({ ...state, tab: tab.id, page: 1 }, server)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tabs, state, server])

  if (status === 'loading') return <div className="gw-ahf gw-ahf--loading" aria-busy="true"><div className="gw-skeleton"><div className="gw-skeleton__row" /><div className="gw-skeleton__row" /><div className="gw-skeleton__row" /></div></div>
  if (status === 'error') return <div className="gw-ahf"><p className="gw-ahf__empty">The Auction House could not be loaded. Try again in a moment.</p></div>
  const tab = state.tab === 'diagnostics' && !isAdmin ? 'browse' : state.tab
  return (
    <div className="gw-ahf" data-tab={tab}>
      <header className="gw-ahf__title">
        <h2>{tabs.find((entry) => entry.id === tab)?.id === 'browse' ? 'Browse Auctions' : tabs.find((entry) => entry.id === tab)?.label}</h2>
        {markets.length ? <MarketPicker markets={markets} market={market} onChange={(next) => go({ ...state, market: next, page: 1 }, server)} /> : null}
        <MarketStatus market={market} />
        <span className="gw-ahf__keys" title="/ search · ↑↓ move · Enter open · Esc close · F favorite · H history · [ ] pages · Alt+1–6 tabs">Keyboard</span>
      </header>
      <div className="gw-ahf__body">
        {!markets.length && tab !== 'shopping' && tab !== 'favorites' && tab !== 'diagnostics' ? (
          <div className="gw-ahf__empty gw-ahf__empty--wide">
            <strong>No market data yet.</strong>
            <p>Markets appear once Blizzard's auction API is connected on the server, or once a player with Guildweaver opens the auction house in the game and syncs. Nothing here is estimated or made up.</p>
          </div>
        ) : null}
        {markets.length && tab === 'browse' ? <BrowseTab state={state} server={server} inputRef={inputRef} favorites={favoriteSet} onFavoritesChange={favoriteData.reload} setActionBar={setSelection} /> : null}
        {markets.length && tab === 'appraiser' ? <AppraiserTab state={state} server={server} favorites={favoriteRows} /> : null}
        {tab === 'shopping' ? <ShoppingTab state={state} server={server} /> : null}
        {tab === 'favorites' ? <FavoritesTab state={state} server={server} favorites={favoriteRows} status={favoriteData.status} onChange={favoriteData.reload} /> : null}
        {markets.length && tab === 'history' ? <HistoryTab state={state} server={server} favorites={favoriteRows} /> : null}
        {tab === 'diagnostics' ? <MarketDiagnostics /> : null}
      </div>
      {tab === 'browse' && markets.length ? <ActionBar state={state} server={server} selection={selection} favorites={favoriteSet} onFavoritesChange={favoriteData.reload} /> : null}
      <nav className="gw-ahf__tabs" aria-label="Auction House">
        {tabs.map((entry) => (
          <a key={entry.id} href={auctionHref({ ...state, tab: entry.id, page: 1 }, server)} className={tab === entry.id ? 'is-active' : ''}
            aria-current={tab === entry.id ? 'page' : undefined} title={`${entry.hint} (Alt+${entry.key})`}>{entry.label}</a>
        ))}
      </nav>
    </div>
  )
}

