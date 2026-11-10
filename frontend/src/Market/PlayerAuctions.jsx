import { useEffect, useMemo, useRef, useState } from 'react'

import { navigate } from '../Navigation/navigation.js'
import { ItemLabel } from '../Player/ui.jsx'
import { AddToList, Change, Coins, FavoriteButton, Freshness, ItemMarketPanel, PriceHistoryChart } from './MarketComponents.jsx'
import {
  AUCTION_TABS,
  auctionHref,
  formatAge,
  readAuctionState,
  readRecentSearches,
  rememberSearch,
  unitAsk,
} from './marketFormat.js'
import { marketWrite, useMarketResource, useMarkets, useSuggestions } from './useMarket.js'

function go(state, server, options = { preserveScroll: true }) {
  navigate(auctionHref(state, server), options)
}

function MarketPicker({ markets, marketKey, onChange }) {
  const groups = useMemo(() => {
    const api = markets.filter((market) => market.kind === 'api_house')
    const game = markets.filter((market) => market.kind === 'client_house')
    return [['Blizzard API', api], ['In-game scans', game]].filter(([, list]) => list.length)
  }, [markets])
  const current = markets.find((market) => market.marketKey === marketKey)
  return (
    <label className="gw-filter gw-ah-market">
      <span>Market</span>
      <select value={marketKey} onChange={(event) => onChange(event.target.value)} aria-label="Market">
        {groups.map(([label, list]) => (
          <optgroup key={label} label={label}>
            {list.map((market) => <option key={market.marketKey} value={market.marketKey}>{market.name} · {market.items.toLocaleString('en-US')} items</option>)}
          </optgroup>
        ))}
      </select>
      {current ? <small className={current.stale ? 'gw-fresh--stale' : 'gw-muted'}>{current.lastSnapshotAt ? `updated ${formatAge(current.ageSeconds)}` : 'no data yet'}{current.provider?.failing ? ' · refresh failing, showing last data' : ''}</small> : null}
    </label>
  )
}

// The search box: suggestions as you type, recent searches, Enter to search.
function SearchBox({ state, server, inputRef }) {
  const [value, setValue] = useState(state.q)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const suggestions = useSuggestions(open ? value : '', state.market)
  const [recent, setRecent] = useState(() => readRecentSearches())
  useEffect(() => { setValue(state.q) }, [state.q])
  function submit(q, item = null) {
    setRecent(rememberSearch(q))
    setOpen(false)
    go({ ...state, q, page: 1, item: item ?? state.item, tab: state.tab === 'sell' || state.tab === 'history' ? state.tab : 'buy' }, server)
  }
  return (
    <form className="gw-ah-search" role="search" onSubmit={(event) => {
      event.preventDefault()
      const chosen = suggestions[active]
      if (chosen) submit(chosen.name, chosen.itemId)
      else submit(value.trim())
    }}>
      <input ref={inputRef} type="search" value={value} placeholder="Search items by name or ID   (Alt+K)" aria-label="Search items"
        aria-autocomplete="list" aria-expanded={open && suggestions.length > 0} aria-controls="gw-ah-suggest" maxLength={100}
        onChange={(event) => { setValue(event.target.value); setOpen(true); setActive(-1) }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(suggestions.length - 1, index + 1)) }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(-1, index - 1)) }
          if (event.key === 'Escape') { setOpen(false); setValue('') }
        }} />
      <button type="submit" className="gw-btn gw-btn--primary gw-btn--sm">Search</button>
      {open && suggestions.length ? (
        <ul id="gw-ah-suggest" className="gw-ah-suggest" role="listbox">
          {suggestions.map((entry, index) => (
            <li key={entry.itemId} role="option" aria-selected={index === active} className={index === active ? 'is-active' : ''}
              onMouseDown={(event) => { event.preventDefault(); submit(entry.name, entry.itemId) }}>
              <ItemLabel item={entry} size={20} tooltip={false} />{entry.priced ? null : <span className="gw-muted gw-small"> no listings seen</span>}
            </li>
          ))}
        </ul>
      ) : null}
      {recent.length && !state.q ? (
        <div className="gw-ah-recent" aria-label="Recent searches">
          {recent.map((entry) => <button type="button" key={entry} className="gw-chip" onClick={() => submit(entry)}>{entry}</button>)}
        </div>
      ) : null}
    </form>
  )
}

function SortHeader({ label, column, state, server, numeric = false }) {
  const active = state.sort === column
  const dir = active && state.dir === 'asc' ? 'desc' : 'asc'
  return (
    <th scope="col" className={numeric ? 'gw-col-num' : ''} aria-sort={active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="gw-sort" onClick={() => go({ ...state, sort: column, dir, page: 1 }, server)}>
        {label}{active ? (state.dir === 'asc' ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  )
}

function BuyTab({ state, server, inputRef }) {
  const url = state.market ? `/api/market/search?${new URLSearchParams({ market: state.market, q: state.q, category: state.category, sort: state.sort, dir: state.dir, page: String(state.page) })}` : ''
  const search = useMarketResource(url)
  const saved = useMarketResource('/api/market/searches')
  const favorites = useMarketResource('/api/market/favorites')
  const favoriteSet = useMemo(() => new Set((favorites.data?.favorites || []).map((entry) => entry.item.itemId)), [favorites.data])
  const [selected, setSelected] = useState(0)
  const rows = useMemo(() => search.data?.results || [], [search.data])
  const tableRef = useRef(null)

  // j/k move, Enter opens, f favorites the row; Alt+K focuses search.
  useEffect(() => {
    function onKey(event) {
      const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)
      if (event.altKey && event.key.toLowerCase() === 'k') { event.preventDefault(); inputRef.current?.focus(); return }
      if (typing || event.metaKey || event.ctrlKey || event.altKey || !rows.length) return
      if (event.key === 'j') setSelected((index) => Math.min(rows.length - 1, index + 1))
      else if (event.key === 'k') setSelected((index) => Math.max(0, index - 1))
      else if (event.key === 'Enter') go({ ...state, item: rows[selected]?.item.itemId }, server)
      else if (event.key === 'f' && rows[selected]) {
        const itemId = rows[selected].item.itemId
        marketWrite(`/api/market/favorites/${itemId}`, { method: favoriteSet.has(itemId) ? 'DELETE' : 'PUT' }).then(favorites.reload)
      } else return
      event.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [rows, selected, state, server, favoriteSet, favorites.reload, inputRef])
  useEffect(() => { setSelected(0) }, [url])

  async function saveCurrent() {
    const name = window.prompt('Name this search', state.q || state.category || 'Search')
    if (!name) return
    await marketWrite('/api/market/searches', { method: 'POST', body: { name, query: { q: state.q, category: state.category, sort: state.sort, direction: state.dir, market: state.market } } })
    saved.reload()
  }

  const totalPages = search.data ? Math.max(1, Math.ceil(search.data.total / search.data.pageSize)) : 1
  return (
    <div className={`gw-ah-buy${state.item ? ' has-panel' : ''}`}>
      <div className="gw-ah-results">
        <div className="gw-filterbar" role="group" aria-label="Filter results">
          <label className={`gw-filter${state.category ? ' is-active' : ''}`}>
            <span>Category</span>
            <select value={state.category} onChange={(event) => go({ ...state, category: event.target.value, page: 1 }, server)}>
              <option value="">All</option>
              {(search.data?.categories || []).map((entry) => <option key={entry.name} value={entry.name}>{entry.name} ({entry.items})</option>)}
            </select>
          </label>
          <button type="button" className="gw-btn gw-btn--sm" onClick={saveCurrent} disabled={!state.q && !state.category}>Save search</button>
          {(saved.data?.searches || []).slice(0, 6).map((entry) => (
            <span key={entry.id} className="gw-chip">
              <a href={auctionHref({ ...state, q: entry.query.q || '', category: entry.query.category || '', sort: entry.query.sort || 'name', dir: entry.query.direction || 'asc', page: 1 }, server)}>{entry.name}</a>
              <button type="button" aria-label={`Delete saved search ${entry.name}`} onClick={() => marketWrite(`/api/market/searches/${entry.id}`, { method: 'DELETE' }).then(saved.reload)}>×</button>
            </span>
          ))}
          <span className="gw-muted gw-small gw-ah-count">{search.data ? `${search.data.total.toLocaleString('en-US')} items` : ''}</span>
        </div>
        {search.status === 'loading' ? <div className="gw-skeleton" aria-busy="true">{Array.from({ length: 10 }, (_, index) => <div key={index} className="gw-skeleton__row" />)}</div> : null}
        {search.status === 'error' ? <p className="gw-muted">Search failed. <button type="button" className="gw-btn gw-btn--sm" onClick={search.reload}>Retry</button></p> : null}
        {search.data && !rows.length ? (
          <p className="gw-ah-empty">{state.q ? `No listings for “${state.q}” in this market.` : 'This market has no listings yet.'} Prices come from Blizzard's API and from players' in-game auction house searches.</p>
        ) : null}
        {rows.length ? (
          <div className="gw-table-wrap">
            <table className={`gw-table gw-ah-table${search.status === 'refreshing' ? ' is-refreshing' : ''}`} ref={tableRef}>
              <thead>
                <tr>
                  <th scope="col" aria-label="Favorite" />
                  <SortHeader label="Item" column="name" state={state} server={server} />
                  <SortHeader label="Lowest ask (unit)" column="price" state={state} server={server} numeric />
                  <SortHeader label="Typical" column="typical" state={state} server={server} numeric />
                  <SortHeader label="Listed" column="quantity" state={state} server={server} numeric />
                  <SortHeader label="24 h" column="change" state={state} server={server} numeric />
                  <SortHeader label="Data" column="age" state={state} server={server} />
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.itemKey} className={`${index === selected ? 'is-selected' : ''}${state.item === row.item.itemId ? ' is-open' : ''}`}
                    onClick={() => { setSelected(index); go({ ...state, item: row.item.itemId }, server) }}>
                    <td><FavoriteButton itemId={row.item.itemId} favorite={favoriteSet.has(row.item.itemId)} onChange={favorites.reload} /></td>
                    <td><ItemLabel item={row.item} size={22} />{row.variant ? <code className="gw-small gw-muted"> {row.variant}</code> : null}</td>
                    <td className="gw-col-num"><Coins value={row.minUnitBuyout} /></td>
                    <td className="gw-col-num"><Coins value={row.typicalUnitBuyout} muted /></td>
                    <td className="gw-col-num">{row.quantity.toLocaleString('en-US')}{row.listings ? <small className="gw-muted"> /{row.listings}</small> : null}</td>
                    <td className="gw-col-num"><Change pct={row.change24hPct} /></td>
                    <td><Freshness price={row} /></td>
                    <td><AddToList itemId={row.item.itemId} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {totalPages > 1 ? (
          <nav className="gw-pager" aria-label="Pages">
            <button type="button" className="gw-btn gw-btn--sm" disabled={state.page <= 1} onClick={() => go({ ...state, page: state.page - 1 }, server)}>Previous</button>
            <span>Page {state.page} of {totalPages}</span>
            <button type="button" className="gw-btn gw-btn--sm" disabled={state.page >= totalPages} onClick={() => go({ ...state, page: state.page + 1 }, server)}>Next</button>
          </nav>
        ) : null}
        <p className="gw-small gw-muted">Keys: Alt+K search · j/k move · Enter open · f favorite. Prices are asking prices per unit, not sales.</p>
      </div>
      {state.item ? (
        <aside className="gw-ah-panel" aria-label="Item market">
          <button type="button" className="gw-btn gw-btn--sm gw-ah-close" onClick={() => go({ ...state, item: null }, server)} aria-label="Close item">×</button>
          <ItemMarketPanel itemId={state.item} marketKey={state.market} onFavoriteChange={favorites.reload} />
        </aside>
      ) : null}
    </div>
  )
}

function SellTab({ state }) {
  if (!state.item) {
    return <p className="gw-ah-empty">Search for an item to see what it is worth here: current asks, the typical price, vendor value and a starting point for posting.</p>
  }
  return <div className="gw-ah-single"><ItemMarketPanel itemId={state.item} marketKey={state.market} mode="sell" /></div>
}

function ListsTab({ state, server }) {
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
    <div className="gw-ah-lists">
      <nav className="gw-ah-listnav" aria-label="Shopping lists">
        {all.map((list) => (
          <a key={list.id} href={auctionHref({ ...state, list: list.id }, server)} className={current?.id === list.id ? 'is-active' : ''}>
            {list.name}<small className="gw-muted"> {list.items.length}</small>
          </a>
        ))}
        <form onSubmit={create} className="gw-ah-newlist">
          <input aria-label="New list name" placeholder="New list" value={newName} maxLength={60} onChange={(event) => setNewName(event.target.value)} />
          <button type="submit" className="gw-btn gw-btn--sm">Add</button>
        </form>
      </nav>
      <section className="gw-ah-listbody">
        {lists.status === 'loading' ? <div className="gw-skeleton"><div className="gw-skeleton__row" /></div> : null}
        {!current && lists.data ? <p className="gw-ah-empty">No shopping lists yet. Create one for a crafting project, raid night or a goal, then add items from search with “+ List”.</p> : null}
        {current ? (
          <>
            <header className="gw-ah-listhead">
              <input className="gw-ah-listname" aria-label="List name" defaultValue={current.name} key={current.id} maxLength={60}
                onBlur={(event) => { if (event.target.value.trim() && event.target.value !== current.name) marketWrite(`/api/market/lists/${current.id}`, { method: 'PATCH', body: { name: event.target.value } }).then(lists.reload) }} />
              <select aria-label="List purpose" value={current.purpose} onChange={(event) => marketWrite(`/api/market/lists/${current.id}`, { method: 'PATCH', body: { purpose: event.target.value } }).then(lists.reload)}>
                <option value="personal">Personal goal</option><option value="crafting">Crafting project</option><option value="dungeon">Dungeon prep</option>
              </select>
              <strong className="gw-ah-total">Est. <Coins value={current.estimate.copper} /></strong>
              {current.estimate.missingPrices ? <span className="gw-muted gw-small">{current.estimate.missingPrices} item(s) without a price</span> : null}
              <button type="button" className="gw-btn gw-btn--sm" onClick={() => { if (window.confirm(`Delete “${current.name}”?`)) marketWrite(`/api/market/lists/${current.id}`, { method: 'DELETE' }).then(() => { lists.reload(); go({ ...state, list: null }, server) }) }}>Delete list</button>
            </header>
            {current.items.length ? (
              <table className="gw-table gw-ah-table">
                <thead><tr><th scope="col">Item</th><th scope="col" className="gw-col-num">Want</th><th scope="col" className="gw-col-num">Bought</th>
                  <th scope="col" className="gw-col-num">Unit ask</th><th scope="col" className="gw-col-num">Still to buy</th><th scope="col">Data</th><th scope="col" aria-label="Remove" /></tr></thead>
                <tbody>{current.items.map((entry) => (
                  <tr key={entry.item.itemId} className={entry.purchased >= entry.quantity ? 'is-done' : ''}>
                    <td><a href={auctionHref({ ...state, tab: 'buy', item: entry.item.itemId, q: entry.item.name }, server)}><ItemLabel item={entry.item} size={20} /></a></td>
                    <td className="gw-col-num"><input type="number" min="1" max="100000" aria-label={`Quantity of ${entry.item.name}`} defaultValue={entry.quantity}
                      onBlur={(event) => Number(event.target.value) !== entry.quantity && update(entry.item.itemId, { quantity: Number(event.target.value) })} /></td>
                    <td className="gw-col-num"><input type="number" min="0" max={entry.quantity} aria-label={`Bought of ${entry.item.name}`} defaultValue={entry.purchased}
                      onBlur={(event) => Number(event.target.value) !== entry.purchased && update(entry.item.itemId, { purchased: Number(event.target.value) })} /></td>
                    <td className="gw-col-num"><Coins value={unitAsk(entry.price)} /></td>
                    <td className="gw-col-num"><Coins value={entry.estimatedCost} /></td>
                    <td><Freshness price={entry.price} showSource={false} /></td>
                    <td><button type="button" className="gw-btn gw-btn--sm" aria-label={`Remove ${entry.item.name}`}
                      onClick={() => marketWrite(`/api/market/lists/${current.id}/items/${entry.item.itemId}`, { method: 'DELETE' }).then(lists.reload)}>×</button></td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <p className="gw-ah-empty">Empty list. Add items from the Buy tab with “+ List”.</p>}
            <p className="gw-small gw-muted">{current.estimate.basis}. Mark items bought as you go; the website does not buy anything.</p>
          </>
        ) : null}
      </section>
    </div>
  )
}

function FavoritesTab({ state, server }) {
  const favorites = useMarketResource(`/api/market/favorites?market=${encodeURIComponent(state.market || '')}`)
  const rows = favorites.data?.favorites || []
  if (favorites.status === 'loading') return <div className="gw-skeleton"><div className="gw-skeleton__row" /><div className="gw-skeleton__row" /></div>
  if (!rows.length) return <p className="gw-ah-empty">No favorites yet. Star items in search (or press f) to watch their prices here. Favorites also make their markets refresh first.</p>
  return (
    <table className="gw-table gw-ah-table">
      <thead><tr><th scope="col" aria-label="Favorite" /><th scope="col">Item</th><th scope="col" className="gw-col-num">Lowest ask</th><th scope="col" className="gw-col-num">Typical</th>
        <th scope="col" className="gw-col-num">Listed</th><th scope="col" className="gw-col-num">24 h</th><th scope="col">Data</th></tr></thead>
      <tbody>{rows.map((entry) => (
        <tr key={entry.item.itemId} onClick={() => go({ ...state, tab: 'buy', item: entry.item.itemId, q: entry.item.name }, server)}>
          <td><FavoriteButton itemId={entry.item.itemId} favorite onChange={favorites.reload} /></td>
          <td><ItemLabel item={entry.item} size={22} /></td>
          <td className="gw-col-num"><Coins value={entry.price?.minUnitBuyout} /></td>
          <td className="gw-col-num"><Coins value={entry.price?.typicalUnitBuyout} muted /></td>
          <td className="gw-col-num">{entry.price ? entry.price.quantity.toLocaleString('en-US') : '—'}</td>
          <td className="gw-col-num"><Change pct={entry.price?.change24hPct} /></td>
          <td><Freshness price={entry.price} /></td>
        </tr>
      ))}</tbody>
    </table>
  )
}

const RANGES = [['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['1y', '1 year'], ['2y', '2 years']]

function HistoryTab({ state, server }) {
  const history = useMarketResource(state.item && state.market ? `/api/market/items/${state.item}/history?market=${encodeURIComponent(state.market)}&range=${state.range}` : '')
  const item = useMarketResource(state.item ? `/api/market/items/${state.item}?market=${encodeURIComponent(state.market || '')}` : '')
  if (!state.item) return <p className="gw-ah-empty">Search for an item to see its asking price and supply over time.</p>
  return (
    <div className="gw-ah-single">
      <header className="gw-ah-histhead">
        {item.data ? <ItemLabel item={item.data.item} size={32} /> : null}
        <div className="gw-seg" role="group" aria-label="Range">
          {RANGES.map(([value, label]) => (
            <button type="button" key={value} className={state.range === value ? 'is-active' : ''} aria-pressed={state.range === value}
              onClick={() => go({ ...state, range: value }, server)}>{label}</button>
          ))}
        </div>
      </header>
      <PriceHistoryChart points={history.data?.points || []} height={240} />
      <p className="gw-small gw-muted">{history.data?.basis}{history.data?.bucketDays > 1 ? ' Long ranges show one point per week.' : ''}</p>
    </div>
  )
}

// The Auction House workspace: Buy / Sell / Shopping lists / Favorites /
// History, all for the selected market, with state in the URL.
export default function PlayerAuctions({ server = '', queryString = '' }) {
  const requested = useMemo(() => readAuctionState(queryString), [queryString])
  const { status, markets, marketKey } = useMarkets(requested.market)
  const state = { ...requested, market: marketKey }
  const inputRef = useRef(null)

  if (status === 'loading') return <div className="gw-skeleton" aria-busy="true"><div className="gw-skeleton__row" /><div className="gw-skeleton__row" /></div>
  if (status === 'error') return <p className="gw-ah-empty">The Auction House could not be loaded. Try again in a moment.</p>
  return (
    <div className="gw-ah">
      <div className="gw-ah-top">
        {markets.length ? <MarketPicker markets={markets} marketKey={marketKey} onChange={(next) => go({ ...state, market: next, page: 1 }, server)} /> : null}
        <SearchBox state={state} server={server} inputRef={inputRef} />
      </div>
      <nav className="gw-seg gw-ah-tabs" aria-label="Auction House">
        {AUCTION_TABS.map((tab) => (
          <a key={tab.id} href={auctionHref({ ...state, tab: tab.id, page: 1 }, server)} className={state.tab === tab.id ? 'is-active' : ''}
            aria-current={state.tab === tab.id ? 'page' : undefined} title={tab.hint}>{tab.label}</a>
        ))}
      </nav>
      {!markets.length ? (
        <div className="gw-ah-empty">
          <strong>No market data yet.</strong>
          <p>Markets appear once Blizzard's auction API is connected on the server, or once a player with Guildweaver searches the auction house in game and syncs. Nothing here is estimated or made up.</p>
        </div>
      ) : null}
      {markets.length && state.tab === 'buy' ? <BuyTab state={state} server={server} inputRef={inputRef} /> : null}
      {markets.length && state.tab === 'sell' ? <SellTab state={state} /> : null}
      {state.tab === 'lists' ? <ListsTab state={state} server={server} /> : null}
      {state.tab === 'favorites' ? <FavoritesTab state={state} server={server} /> : null}
      {markets.length && state.tab === 'history' ? <HistoryTab state={state} server={server} /> : null}
    </div>
  )
}
