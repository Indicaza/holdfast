import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { GameTooltipBody } from '../Intelligence/GameTooltip.jsx'
import { ItemLabel } from '../Player/ui.jsx'
import { MarketCharts } from './MarketCharts.jsx'
import {
  FavoriteButton,
  Freshness,
  ListingState,
  MarketSummary,
  MetricsTable,
  PriceLadder,
  SignalChips,
} from './MarketComponents.jsx'
import { clampWindow, stackOrder } from './marketBrowse.js'
import { viewport } from './useInspectors.js'
import { bindLabel, formatDateTime } from './marketFormat.js'
import { useItemHistory, useItemMarket } from './useMarket.js'

const QUALITY_NAMES = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact', 'Heirloom']
const TABS = [['overview', 'Overview'], ['history', 'History']]

// Moves or resizes a window by pointer. The window follows the pointer
// through its style; the position is stored once, when the pointer lets go,
// so the content does not render on every move.
function usePointerGesture(ref, win, onCommit) {
  return useCallback((event, mode) => {
    if (event.button !== 0) return
    event.preventDefault()
    const element = ref.current
    if (!element) return
    const start = { x: event.clientX, y: event.clientY, left: win.x, top: win.y, width: win.width, height: win.height }
    let next = { x: win.x, y: win.y, width: win.width, height: win.height }
    const target = event.currentTarget
    target.setPointerCapture?.(event.pointerId)
    element.classList.add(mode === 'move' ? 'is-moving' : 'is-resizing')
    const move = (moveEvent) => {
      const dx = moveEvent.clientX - start.x
      const dy = moveEvent.clientY - start.y
      next = clampWindow(mode === 'move' ? { ...win, x: start.left + dx, y: start.top + dy } : { ...win, width: start.width + dx, height: start.height + dy }, viewport())
      element.style.left = `${next.x}px`
      element.style.top = `${next.y}px`
      if (mode === 'resize') {
        element.style.width = `${next.width}px`
        element.style.height = `${next.height}px`
      }
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      element.classList.remove('is-moving', 'is-resizing')
      onCommit(mode === 'move' ? { x: next.x, y: next.y } : { width: next.width, height: next.height, x: next.x, y: next.y })
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }, [ref, win, onCommit])
}

const InspectorWindow = memo(function InspectorWindow({ win, order, focusAt, marketKey, marketName, favorite, onFavoritesChange, actions }) {
  const ref = useRef(null)
  const { raise, update, close, open } = actions
  const commit = useCallback((patch) => update(win.id, patch), [update, win.id])
  const onTab = useCallback((tab) => update(win.id, { tab }), [update, win.id])
  const onIdentity = useCallback((item) => {
    if (item.name !== win.name || item.qualityId !== win.qualityId) update(win.id, { name: item.name, qualityId: item.qualityId })
  }, [update, win.id, win.name, win.qualityId])
  const gesture = usePointerGesture(ref, win, commit)
  const [flash, setFlash] = useState(false)
  // Asked to open again: come forward, take focus, and say so with a flash.
  useEffect(() => {
    if (!focusAt) return undefined
    ref.current?.focus({ preventScroll: true })
    setFlash(true)
    const timer = setTimeout(() => setFlash(false), 600)
    return () => clearTimeout(timer)
  }, [focusAt])
  const title = win.name || `Item ${win.itemId}`
  function onTitleKey(event) {
    // Arrows move the window; Shift+arrows resize it.
    const step = event.altKey ? 4 : 24
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
    if (!delta) return
    event.preventDefault()
    if (event.shiftKey) update(win.id, { width: win.width + delta[0], height: win.height + delta[1] })
    else update(win.id, { x: win.x + delta[0], y: win.y + delta[1] })
  }
  return (
    <section ref={ref} className={`gw-insp${win.collapsed ? ' is-collapsed' : ''}${win.pinned ? ' is-pinned' : ''}${flash ? ' is-flash' : ''}`}
      role="dialog" aria-modal="false" aria-label={`${title} inspector`} tabIndex={-1} data-inspector={win.id}
      style={{ left: win.x, top: win.y, width: win.width, height: win.collapsed ? undefined : win.height, zIndex: 90 + order }}
      onPointerDownCapture={() => raise(win.id)}
      onKeyDown={(event) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); close(win.id) } }}>
      <header className="gw-insp__bar" onPointerDown={(event) => { if (!event.target.closest('button')) gesture(event, 'move') }}
        onDoubleClick={(event) => { if (!event.target.closest('button')) update(win.id, { collapsed: !win.collapsed }) }}
        tabIndex={0} onKeyDown={onTitleKey} title="Drag to move · arrows move · Shift+arrows resize · double-click to collapse">
        <ItemLabel item={{ itemId: win.itemId, name: title, qualityId: win.qualityId }} size={18} tooltip={false} />
        <span className="gw-insp__spacer" />
        <button type="button" className={`gw-insp__icon${win.pinned ? ' is-on' : ''}`} aria-pressed={win.pinned} aria-label={win.pinned ? 'Unpin' : 'Pin on top'}
          title={win.pinned ? 'Pinned: stays on top and through "Close all"' : 'Pin: keep on top and through "Close all"'} onClick={() => update(win.id, { pinned: !win.pinned })}>⌖</button>
        <button type="button" className="gw-insp__icon" aria-label={win.collapsed ? 'Expand' : 'Collapse'} aria-expanded={!win.collapsed}
          onClick={() => update(win.id, { collapsed: !win.collapsed })}>{win.collapsed ? '▢' : '–'}</button>
        <button type="button" className="gw-insp__icon" aria-label="Close" title="Close (Esc)" onClick={() => close(win.id)}>×</button>
      </header>
      {win.collapsed ? null : (
        <>
          <div className="gw-insp__body">
            <InspectorContent itemId={win.itemId} itemKey={win.itemKey} marketKey={marketKey} marketName={marketName} tab={win.tab === 'history' ? 'history' : 'overview'}
              onTab={onTab} favorite={favorite} onFavoritesChange={onFavoritesChange} onIdentity={onIdentity} onOpenVariant={open} />
          </div>
          <span className="gw-insp__resize" role="presentation" onPointerDown={(event) => gesture(event, 'resize')} />
        </>
      )}
    </section>
  )
})

// What one item inspector shows: the tooltip, the facts, this market's
// price and supply, and (on their tabs) history, crafting and sources.
// The same item endpoints and components as the item panel.
const InspectorContent = memo(function InspectorContent({ itemId, itemKey, marketKey, marketName, tab, onTab, favorite, onFavoritesChange, onIdentity, onOpenVariant }) {
  const { detail, analysis, focusKey, here } = useItemMarket({ itemId, itemKey, marketKey })
  const [range, setRange] = useState('7d')
  const history = useItemHistory({ itemId, itemKey: focusKey, marketKey, range, enabled: tab === 'history' })
  const data = detail.data
  useEffect(() => {
    if (data?.item?.name) onIdentity({ name: here?.variantName || data.item.name, qualityId: data.item.qualityId })
  }, [data, here, onIdentity])
  if (detail.status === 'loading') return <div className="gw-skeleton" aria-busy="true"><div className="gw-skeleton__row" /><div className="gw-skeleton__row" /><div className="gw-skeleton__row" /></div>
  if (detail.status === 'error' || detail.status === 'missing') return <p className="gw-muted">This item could not be loaded. <button type="button" className="gw-btn gw-btn--xs" onClick={detail.reload}>Retry</button></p>
  if (!data) return null
  const item = data.item
  const metrics = analysis.data?.metrics
  const facts = [QUALITY_NAMES[item.qualityId], item.itemLevel ? `Item level ${item.itemLevel}` : null, item.requiredLevel ? `Requires level ${item.requiredLevel}` : null,
    item.bindType !== null && item.bindType !== undefined ? bindLabel(item.bindType) : null, [item.itemClass, item.itemSubclass].filter(Boolean).join(' · ') || null].filter(Boolean)
  return (
    <div className="gw-insp__content">
      <div className="gw-insp__head">
        <ItemLabel item={here?.variantName ? { ...item, name: here.variantName } : item} size={36} tooltip={false} />
        <span className="gw-insp__actions">
          <FavoriteButton itemId={item.itemId} favorite={favorite} size="md" onChange={onFavoritesChange} />
        </span>
      </div>
      <p className="gw-insp__facts">{facts.join(' · ')}</p>
      <div className="gw-insp__price">
        <span className="gw-insp__market" title={marketKey}>{marketName}</span>
        {here && here.quantity > 0 ? <Freshness price={here} /> : <ListingState listing={data.listing} observedAt={data.listingObservedAt} note={data.coverage?.note}
          ageSeconds={data.listingAgeSeconds} />}
      </div>
      <nav className="gw-insp__tabs" role="tablist" aria-label="Inspector sections">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => onTab(id)}>{label}</button>)}
      </nav>
      {tab === 'overview' ? (
        <div className="gw-insp__panel" role="tabpanel" aria-label="Overview">
          {here ? <MarketSummary summary={here} metrics={metrics} /> : (
            <p className="gw-muted gw-small">{data.listing === 'none_listed' ? `No listings in ${marketName} at the last complete check${data.listingObservedAt ? ` (${formatDateTime(data.listingObservedAt)})` : ''}.`
              : `Not seen in ${marketName} yet. ${data.coverage?.note || ''} Nothing is estimated.`}</p>
          )}
          <SignalChips signals={analysis.data?.signals} />
          {data.variants.length > 1 ? (
            <div className="gw-insp__variants">
              <span className="gw-small gw-muted">Versions here</span>
              <ul>{data.variants.map((entry) => (
                <li key={entry.itemKey}>
                  <button type="button" className={entry.itemKey === focusKey ? 'is-active' : ''} onClick={() => onOpenVariant({ itemId: item.itemId, itemKey: entry.itemKey === `i:${item.itemId}` ? '' : entry.itemKey, name: entry.variantName || item.name, qualityId: item.qualityId })}>
                    {entry.label}<small>{entry.quantity} listed</small>
                  </button>
                </li>
              ))}</ul>
            </div>
          ) : null}
          <div className="gw-insp__tooltip game-tooltip" aria-label="Item tooltip">
            {item.tooltipLines?.length ? <GameTooltipBody item={{ ...item, tooltipLines: item.tooltipLines }} />
              : <><GameTooltipBody item={{ itemId: item.itemId, name: item.name, qualityId: item.qualityId }} /><p className="gw-small gw-muted">No player's game has described this item yet.</p></>}
          </div>
          {here?.pricePoints?.length ? <section className="gw-msec"><h3>Cheapest listings</h3><PriceLadder points={here.pricePoints} /></section> : null}
        </div>
      ) : null}
      {tab === 'history' ? (
        <div className="gw-insp__panel" role="tabpanel" aria-label="History">
          <MarketCharts history={history.data} range={range} onRange={setRange} compact status={history.status} />
          <MetricsTable metrics={metrics} />
          <p className="gw-small gw-muted">{analysis.data?.disclaimer || 'Observed asking prices and listed supply, not sales.'}</p>
        </div>
      ) : null}
    </div>
  )
})

// Every open inspector, over the page. Rendered at the document's top level
// so the Auction House frame never clips or re-lays them out.
export function InspectorLayer({ inspectors, marketKey, marketName, favorites, onFavoritesChange }) {
  const { windows, focus, actions } = inspectors
  const order = stackOrder(windows)
  if (!windows.length || typeof document === 'undefined') return null
  return createPortal(
    <div className="gw-insp-layer" aria-label="Item inspectors">
      {windows.map((win) => (
        <InspectorWindow key={win.id} win={win} order={order.indexOf(win.id)} focusAt={focus?.id === win.id ? focus.at : 0} marketKey={marketKey} marketName={marketName}
          favorite={favorites.has(win.itemId)} onFavoritesChange={onFavoritesChange} actions={actions} />
      ))}
    </div>,
    document.body,
  )
}
