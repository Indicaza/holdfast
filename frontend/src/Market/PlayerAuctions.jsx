import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useSession } from '../Auth/sessionContext.js'
import { navigate } from '../Navigation/navigation.js'
import { ItemLabel } from '../Player/ui.jsx'
import AuctionBrowse from './AuctionBrowse.jsx'
import { InspectorLayer } from './ItemInspector.jsx'
import { useInspectors } from './useInspectors.js'
import MarketDiagnostics from './MarketDiagnostics.jsx'
import { MarketCharts } from './MarketCharts.jsx'
import {
  Change,
  Coins,
  ConfidenceBadge,
  CraftingCosts,
  Evidence,
  FavoriteButton,
  Freshness,
  MarketSummary,
  MetricsTable,
  PriceLadder,
  SignalChips,
  WhyThisPrice,
} from './MarketComponents.jsx'
import {
  ADMIN_TAB,
  AUCTION_TABS,
  auctionHref,
  bindLabel,
  formatAge,
  formatChange,
  formatDateTime,
  isBlankState,
  postingSuggestion,
  readAuctionState,
  storeAuctionQuery,
  storedAuctionQuery,
  unitAsk,
} from './marketFormat.js'
import { marketWrite, useItemMarket, useMarketResource, useMarkets, useSuggestions } from './useMarket.js'

function go(state, server, options = { preserveScroll: true }) {
  navigate(auctionHref(state, server), options)
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
            {list.map((entry) => <option key={entry.marketKey} value={entry.marketKey}>{entry.name} · {entry.items.toLocaleString('en-US')} listed</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

// How current the selected market is, quietly. A broken or old source is
// never hidden.
function MarketStatus({ market }) {
  if (!market) return null
  const failing = market.provider?.failing
  const tone = failing || market.stale ? 'warn' : 'ok'
  const text = !market.lastCheckedAt ? 'No data yet'
    : `Checked ${formatAge(market.ageSeconds)}${market.changedAgeSeconds !== null && market.lastChangedAt !== market.lastCheckedAt ? ` · changed ${formatAge(market.changedAgeSeconds)}` : ''}`
  return (
    <span className={`gw-ahf__status gw-ahf__status--${tone}`} title={failing ? `Refresh failing: ${market.provider.lastError}. Showing the last good data.` : market.lastFullAt ? `Last complete view ${formatDateTime(market.lastFullAt)}` : 'Seen through individual searches only'}>
      <i aria-hidden="true" />{text}{failing ? ' · refresh failing, showing last data' : market.stale ? ' · stale' : ''}
      {market.linkedMarketKey ? <span className="gw-muted"> · linked to API house</span> : null}
    </span>
  )
}

// The open inspectors at a glance: reset their positions or close them.
function WindowsMenu({ inspectors }) {
  const count = inspectors.windows.length
  if (!count) return null
  return (
    <span className="gw-ahf__windows" role="group" aria-label="Inspector windows">
      <span className="gw-muted">{count} open</span>
      <button type="button" className="gw-ahf__linkbtn" onClick={inspectors.actions.reset} title="Put every inspector back in a neat stack at its default size">Reset positions</button>
      <button type="button" className="gw-ahf__linkbtn" onClick={inspectors.actions.closeAll} title="Close every inspector that is not pinned">Close all</button>
    </span>
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
  return useItemMarket({ itemId: state.item, itemKey: state.key, marketKey: state.market })
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


// The Auction House: one frame laid out like the game's (top bar,
// categories, results, the selected item, tabs along the bottom) for the
// selected market, with the search in the URL. Browse stays mounted while
// other tabs are shown; item inspectors float above every tab.
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
      params.delete('item')
      params.delete('key')
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
  const reloadFavorites = favoriteData.reload
  const inputRef = useRef(null)
  const inspectors = useInspectors()
  const openInspector = inspectors.actions.open
  const tab = state.tab === 'diagnostics' && !isAdmin ? 'browse' : state.tab

  // A link to an item (Dungeon Companion loot, shopping lists, favorites)
  // opens its inspector over Browse; the link's search stays.
  useEffect(() => {
    if (tab !== 'browse' || !state.item || !marketKey) return
    openInspector({ itemId: state.item, itemKey: state.key || '' })
    go({ ...state, item: null, key: '' }, server, { replace: true, preserveScroll: true })
  }, [tab, state, marketKey, server, openInspector])

  // Alt+1…5 switch tabs.
  useEffect(() => {
    function onKey(event) {
      if (!event.altKey || event.metaKey || event.ctrlKey) return
      const entry = AUCTION_TABS.find((candidate) => candidate.key === event.key)
      if (!entry) return
      event.preventDefault()
      go({ ...state, tab: entry.id, page: entry.id === 'browse' ? state.page : 1 }, server)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [state, server])

  const onInspect = useCallback((item) => openInspector(item), [openInspector])

  if (status === 'loading') return <div className="gw-ahf gw-ahf--loading" aria-busy="true"><div className="gw-skeleton"><div className="gw-skeleton__row" /><div className="gw-skeleton__row" /><div className="gw-skeleton__row" /></div></div>
  if (status === 'error') return <div className="gw-ahf"><p className="gw-ahf__empty">The Auction House could not be loaded. Try again in a moment.</p></div>
  const heading = tab === 'browse' ? 'Browse Auctions' : tab === 'diagnostics' ? ADMIN_TAB.label : AUCTION_TABS.find((entry) => entry.id === tab)?.label
  // The market the link asked for is gone: say which one is shown instead.
  const swapped = requested.market && marketKey && requested.market !== marketKey
  return (
    <div className="gw-ahf" data-tab={tab}>
      <header className="gw-ahf__title">
        <h2>{heading}</h2>
        {markets.length ? <MarketPicker markets={markets} market={market} onChange={(next) => go({ ...state, market: next, page: 1 }, server)} /> : null}
        <MarketStatus market={market} />
        {swapped ? <span className="gw-ahf__status gw-ahf__status--warn" role="status">The linked market is not available; showing {market?.name}.</span> : null}
        <span className="gw-ahf__spacer" />
        <WindowsMenu inspectors={inspectors} />
        {isAdmin ? <a className={`gw-ahf__admin${tab === 'diagnostics' ? ' is-active' : ''}`} href={auctionHref({ ...state, tab: 'diagnostics' }, server)} title="Market data health (administrators)">Diagnostics</a> : null}
        <span className="gw-ahf__keys" title="/ search · ↑↓ select · Enter inspect · F favorite · [ ] pages · Alt+1–5 tabs · Esc closes an inspector">Keys</span>
      </header>
      <div className="gw-ahf__body">
        {!markets.length && tab !== 'shopping' && tab !== 'favorites' && tab !== 'diagnostics' ? (
          <div className="gw-ahf__empty gw-ahf__empty--wide">
            <strong>No market data yet.</strong>
            <p>Markets appear once Blizzard's auction API is connected on the server, or once a player with Guildweaver opens the auction house in the game and syncs. Nothing here is estimated or made up.</p>
          </div>
        ) : null}
        {markets.length ? <AuctionBrowse state={state} server={server} active={tab === 'browse'} inputRef={inputRef} favorites={favoriteSet}
          onFavoritesChange={reloadFavorites} onInspect={onInspect} /> : null}
        {markets.length && tab === 'appraiser' ? <AppraiserTab state={state} server={server} favorites={favoriteRows} /> : null}
        {tab === 'shopping' ? <ShoppingTab state={state} server={server} /> : null}
        {tab === 'favorites' ? <FavoritesTab state={state} server={server} favorites={favoriteRows} status={favoriteData.status} onChange={reloadFavorites} /> : null}
        {markets.length && tab === 'history' ? <HistoryTab state={state} server={server} favorites={favoriteRows} /> : null}
        {tab === 'diagnostics' ? <MarketDiagnostics /> : null}
      </div>
      <nav className="gw-ahf__tabs" aria-label="Auction House">
        {AUCTION_TABS.map((entry) => (
          <a key={entry.id} href={auctionHref({ ...state, tab: entry.id, item: entry.id === 'browse' ? null : state.item, key: entry.id === 'browse' ? '' : state.key }, server)}
            className={tab === entry.id ? 'is-active' : ''} aria-current={tab === entry.id ? 'page' : undefined} title={`${entry.hint} (Alt+${entry.key})`}>{entry.label}</a>
        ))}
      </nav>
      <InspectorLayer inspectors={inspectors} marketKey={marketKey} marketName={market?.name || ''} favorites={favoriteSet} onFavoritesChange={reloadFavorites} />
    </div>
  )
}
