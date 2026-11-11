import { useCallback, useEffect, useMemo, useRef } from 'react'

import { useSession } from '../Auth/sessionContext.js'
import { navigate } from '../Navigation/navigation.js'
import AuctionBrowse from './AuctionBrowse.jsx'
import { InspectorLayer } from './ItemInspector.jsx'
import MarketDiagnostics from './MarketDiagnostics.jsx'
import { marketChoices } from './marketBrowse.js'
import { auctionHref, formatAge, isBlankState, readAuctionState, storeAuctionQuery, storedAuctionQuery } from './marketFormat.js'
import { useInspectors } from './useInspectors.js'
import { useMarketResource, useMarkets } from './useMarket.js'

function go(state, server, options = { preserveScroll: true }) {
  navigate(auctionHref(state, server), options)
}

// The auction houses of the chosen server (its Alliance, Horde and
// Blackwater houses), then Blizzard's houses not yet matched to a server.
function MarketPicker({ choices, market, onChange }) {
  return (
    <label className="gw-ahf__market">
      <span className="gw-sr">Auction house</span>
      <select value={market?.marketKey || ''} onChange={(event) => onChange(event.target.value)} aria-label="Auction house">
        {choices.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.markets.map((entry) => <option key={entry.marketKey} value={entry.marketKey}>{entry.label}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

// How current the house's data is, quietly. A broken source is never hidden.
function MarketStatus({ market }) {
  if (!market) return null
  const failing = market.provider?.failing
  const text = !market.lastCheckedAt ? 'No data yet' : `Updated ${formatAge(market.ageSeconds)}`
  return (
    <span className={`gw-ahf__status gw-ahf__status--${failing || market.stale ? 'warn' : 'ok'}`}
      title={failing ? `Refresh failing: ${market.provider.lastError}. Showing the last good data.` : undefined}>
      <i aria-hidden="true" />{text}{failing ? ' · refresh failing' : market.stale ? ' · out of date' : ''}
    </span>
  )
}

// The open inspectors: put them back in a stack, or close them.
function WindowsMenu({ inspectors }) {
  if (!inspectors.windows.length) return null
  return (
    <span className="gw-ahf__windows" role="group" aria-label="Inspector windows">
      <button type="button" className="gw-ahf__linkbtn" onClick={inspectors.actions.reset} title="Put every open item window back in a neat stack">Reset positions</button>
      <button type="button" className="gw-ahf__linkbtn" onClick={inspectors.actions.closeAll} title="Close every item window that is not pinned">Close all</button>
    </span>
  )
}

// The Auction House: one screen like the game's. Search any item on the
// chosen house, browse its categories, see favorites when nothing is
// searched, and open items in floating windows.
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
      for (const key of ['item', 'key', 'tab']) params.delete(key)
      if (server) params.set('server', server)
      navigate(`/dashboard/auctions?${params}`, { replace: true, preserveScroll: true })
    }
  }, [queryString, server])
  // Remembered as it is now, home included (after the restore above read it).
  useEffect(() => { storeAuctionQuery(queryString) }, [queryString])

  const requested = useMemo(() => readAuctionState(queryString), [queryString])
  const { status, markets, marketKey, market } = useMarkets(requested.market, server)
  const choices = useMemo(() => marketChoices(markets, server), [markets, server])
  const state = useMemo(() => ({ ...requested, market: marketKey }), [requested, marketKey])
  const favoriteData = useMarketResource(`/api/market/favorites?market=${encodeURIComponent(marketKey || '')}`)
  const favoriteRows = useMemo(() => favoriteData.data?.favorites || [], [favoriteData.data])
  const favoriteSet = useMemo(() => new Set(favoriteRows.map((entry) => entry.item.itemId)), [favoriteRows])
  const reloadFavorites = favoriteData.reload
  const inputRef = useRef(null)
  const inspectors = useInspectors()
  const openInspector = inspectors.actions.open
  const diagnostics = state.tab === 'diagnostics' && isAdmin

  // A link to an item (Dungeon Companion loot, the item catalog) opens its
  // window; a link to its history opens it on History. The search stays.
  useEffect(() => {
    if (!state.item || !marketKey || diagnostics) return
    openInspector({ itemId: state.item, itemKey: state.key || '', tab: state.tab === 'history' ? 'history' : 'overview' })
    go({ ...state, tab: 'browse', item: null, key: '' }, server, { replace: true, preserveScroll: true })
  }, [state, marketKey, server, openInspector, diagnostics])

  const onInspect = useCallback((item) => openInspector(item), [openInspector])

  if (status === 'loading') return <div className="gw-ahf gw-ahf--loading" aria-busy="true"><div className="gw-skeleton"><div className="gw-skeleton__row" /><div className="gw-skeleton__row" /><div className="gw-skeleton__row" /></div></div>
  if (status === 'error') return <div className="gw-ahf"><p className="gw-ahf__empty">The Auction House could not be loaded. Try again in a moment.</p></div>
  // The house the link asked for is gone: say which one is shown instead.
  const swapped = requested.market && marketKey && requested.market !== marketKey
  return (
    <div className="gw-ahf" data-tab={diagnostics ? 'diagnostics' : 'browse'}>
      <header className="gw-ahf__title">
        <h2>Auction House</h2>
        {markets.length ? <MarketPicker choices={choices.groups} market={market} onChange={(next) => go({ ...state, market: next, page: 1 }, server)} /> : null}
        <MarketStatus market={market} />
        {choices.otherServers ? <span className="gw-ahf__status gw-ahf__status--warn" role="status">No auction data from this server yet.</span> : null}
        {swapped ? <span className="gw-ahf__status gw-ahf__status--warn" role="status">That auction house is not available; showing {market?.name}.</span> : null}
        <span className="gw-ahf__spacer" />
        <WindowsMenu inspectors={inspectors} />
        {isAdmin ? <a className={`gw-ahf__admin${diagnostics ? ' is-active' : ''}`} href={auctionHref({ ...state, tab: diagnostics ? 'browse' : 'diagnostics' }, server)}>{diagnostics ? 'Back to the Auction House' : 'Diagnostics'}</a> : null}
      </header>
      <div className="gw-ahf__body">
        {!markets.length && !diagnostics ? (
          <div className="gw-ahf__empty gw-ahf__empty--wide">
            <strong>No auction data yet.</strong>
            <p>Auction houses appear once Blizzard's auction data is connected on the server, or once a player with Guildweaver opens the auction house in the game and syncs.</p>
          </div>
        ) : null}
        {markets.length ? <AuctionBrowse state={state} server={server} active={!diagnostics} inputRef={inputRef} favorites={favoriteSet} favoriteRows={favoriteRows}
          favoritesStatus={favoriteData.status} onFavoritesChange={reloadFavorites} onInspect={onInspect} /> : null}
        {diagnostics ? <MarketDiagnostics /> : null}
      </div>
      <InspectorLayer inspectors={inspectors} marketKey={marketKey} marketName={market?.name || ''} favorites={favoriteSet} onFavoritesChange={reloadFavorites} />
    </div>
  )
}
