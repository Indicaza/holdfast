import './AuctionHouse.css'

import { useCallback, useEffect, useMemo, useRef } from 'react'

import { useSession } from '../Auth/sessionContext.js'
import { navigate } from '../Navigation/navigation.js'
import AuctionBrowse from './AuctionBrowse.jsx'
import { auctionBack, auctionForward, auctionHistory, goAuction, startAuctionHistory } from './auctionNavigation.js'
import { InspectorLayer } from './ItemInspector.jsx'
import MarketDiagnostics from './MarketDiagnostics.jsx'
import { factionForServer, marketChoices } from './marketBrowse.js'
import { auctionHref, formatAge, isBlankState, readAuctionState, storeAuctionQuery, storedAuctionQuery } from './marketFormat.js'
import { useInspectors } from './useInspectors.js'
import { useMarketResource, useMarkets } from './useMarket.js'

// The auction houses of the chosen server (its Alliance, Horde and
// Blackwater houses, the player's faction first), then Blizzard's houses.
function HousePicker({ choices, market, onChange }) {
  return (
    <label className="ah-house">
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

// How current the house's data is. A failing source is never hidden.
function HouseFreshness({ market }) {
  if (!market) return null
  const failing = market.provider?.failing
  const text = !market.lastCheckedAt ? 'No data yet' : `Updated ${formatAge(market.ageSeconds)}`
  return (
    <span className={`ah-fresh${failing || market.stale ? ' ah-fresh--warn' : ''}`}
      title={failing ? `Refresh failing: ${market.provider.lastError}. Showing the last good data.` : undefined}>
      {text}{failing ? ' · refresh failing' : market.stale ? ' · out of date' : ''}
    </span>
  )
}

// The Auction House: WoW Forever's Browse Auctions window, filling the
// page. One screen: search and categories over the results; items open in
// floating windows with their price levels and history.
export default function PlayerAuctions({ server = '', queryString = '', characters = [] }) {
  const session = useSession()
  const isAdmin = session.hasPermission?.('site.admin') === true
  // Opening the Auction House from the menu returns to the last search.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    startAuctionHistory()
    const last = storedAuctionQuery()
    if (isBlankState(queryString) && last && !isBlankState(last)) {
      const params = new URLSearchParams(last)
      for (const key of ['item', 'key', 'sel']) params.delete(key)
      if (['history', 'diagnostics'].includes(params.get('tab'))) params.delete('tab')
      if (server) params.set('server', server)
      navigate(`/dashboard/auctions?${params}`, { replace: true, preserveScroll: true })
    }
  }, [queryString, server])
  useEffect(() => { storeAuctionQuery(queryString) }, [queryString])

  const requested = useMemo(() => readAuctionState(queryString), [queryString])
  const faction = useMemo(() => factionForServer(characters, server), [characters, server])
  const { status, markets, marketKey, market } = useMarkets(requested.market, server, faction)
  const choices = useMemo(() => marketChoices(markets, server, faction), [markets, server, faction])
  const state = useMemo(() => ({ ...requested, market: marketKey }), [requested, marketKey])
  const favoriteData = useMarketResource(marketKey ? `/api/market/favorites?market=${encodeURIComponent(marketKey)}` : '')
  const favoriteRows = useMemo(() => favoriteData.data?.favorites || [], [favoriteData.data])
  const favoriteSet = useMemo(() => new Set(favoriteRows.map((entry) => entry.item.itemId)), [favoriteRows])
  const reloadFavorites = favoriteData.reload
  const inputRef = useRef(null)
  const inspectors = useInspectors()
  const { open: openInspector, close: closeInspector } = inspectors.actions
  const diagnostics = state.tab === 'diagnostics' && isAdmin

  // A link to an item (dungeon loot, the item catalog) opens its window, on
  // History for a history link.
  useEffect(() => {
    if (!state.item || !marketKey || diagnostics) return
    openInspector({ itemId: state.item, itemKey: state.key || '', tab: state.tab === 'history' ? 'history' : 'overview' })
    goAuction({ ...state, tab: 'browse', item: null, key: '' }, server, { replace: true })
  }, [state, marketKey, server, openInspector, diagnostics])

  // Escape closes the item window on top, as in the game, unless something
  // inside the page (a menu, a field) used it.
  const windows = inspectors.windows
  useEffect(() => {
    function onKey(event) {
      if (event.key !== 'Escape' || event.defaultPrevented || !windows.length) return
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return
      const top = [...windows].sort((a, b) => (b.z || 0) - (a.z || 0))[0]
      closeInspector(top.id)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [windows, closeInspector])

  const onInspect = useCallback((item) => openInspector(item), [openInspector])
  const steps = auctionHistory()

  if (status === 'loading') return <div className="ah ah--loading" aria-busy="true"><div className="ah-loading" aria-label="Loading">Loading</div></div>
  if (status === 'error') return <div className="ah"><p className="ah-empty">The Auction House could not be loaded. Try again in a moment.</p></div>
  const swapped = requested.market && marketKey && requested.market !== marketKey
  return (
    <div className="ah" data-tab={diagnostics ? 'diagnostics' : 'browse'}>
      <div className="ah__window">
        <div className="ah__background" aria-hidden="true" />
        <div className="ah__portrait" aria-hidden="true" />
        <div className="ah__frame" aria-hidden="true">
          {['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top', 'bottom', 'left', 'right'].map((piece) => <span key={piece} className={`ah__piece ah__piece--${piece}`} />)}
        </div>
        <div className="ah__band">
          <span className="ah-nav" role="group" aria-label="Auction House history">
            <button type="button" onClick={auctionBack} disabled={!steps.canBack} aria-label="Back" title="Back">◀</button>
            <button type="button" onClick={auctionForward} disabled={!steps.canForward} aria-label="Forward" title="Forward">▶</button>
          </span>
          <span className="ah__band-spacer" />
          <h2 className="ah__title">{diagnostics ? 'Auction House Diagnostics' : 'Browse Auctions'}</h2>
          <span className="ah__band-spacer" />
          {markets.length ? <HousePicker choices={choices.groups} market={market} onChange={(next) => goAuction({ ...state, market: next, page: 1, sel: '' }, server)} /> : null}
          <HouseFreshness market={market} />
          {choices.otherServers ? <span className="ah-fresh ah-fresh--warn" role="status">No auction data from this server yet</span> : null}
          {swapped ? <span className="ah-fresh ah-fresh--warn" role="status">That house is not available; showing {market?.name}</span> : null}
          {inspectors.windows.length ? (
            <>
              <button type="button" className="ah-band-button" onClick={inspectors.actions.reset} title="Put every item window back in a neat stack">Reset windows</button>
              <button type="button" className="ah-band-button" onClick={inspectors.actions.closeAll} title="Close every item window that is not pinned">Close all</button>
            </>
          ) : null}
          {isAdmin ? <a className="ah-band-link" href={auctionHref({ ...state, tab: diagnostics ? 'browse' : 'diagnostics' }, server)}>{diagnostics ? 'Back to the Auction House' : 'Diagnostics'}</a> : null}
        </div>
        {!markets.length && !diagnostics ? (
          <div className="ah-empty ah-empty--wide">
            <strong>No auction data yet.</strong>
            <p>Auction houses appear once Blizzard's auction data is connected on the server, or once a player with Guildweaver opens the auction house in the game and syncs.</p>
          </div>
        ) : null}
        {markets.length && !diagnostics ? (
          <>
            <AuctionBrowse state={state} server={server} active inputRef={inputRef} favorites={favoriteSet} favoriteRows={favoriteRows}
              favoritesStatus={favoriteData.status} onFavoritesChange={reloadFavorites} onInspect={onInspect} />
          </>
        ) : null}
        {diagnostics ? <div className="ah-pane ah-pane--single"><section className="ah-pane__right"><MarketDiagnostics /></section></div> : null}
      </div>
      <InspectorLayer inspectors={inspectors} marketKey={marketKey} marketName={market?.name || ''} favorites={favoriteSet} onFavoritesChange={reloadFavorites} />
    </div>
  )
}
