import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ItemHeader, ItemPrices } from './AuctionItemDetail.jsx'
import { AuctionItem } from './AuctionParts.jsx'
import { MarketCharts } from './MarketCharts.jsx'
import { Freshness, MetricsTable, SignalChips } from './MarketComponents.jsx'
import { clampWindow, itemFacts, stackOrder } from './marketBrowse.js'
import { viewport } from './useInspectors.js'
import { useItemHistory, useItemMarket } from './useMarket.js'

// "overview" is the Prices tab (the stored name older windows keep).
const TABS = [['overview', 'Prices'], ['history', 'History']]

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
        <AuctionItem item={{ itemId: win.itemId, name: title, qualityId: win.qualityId }} size={18} />
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

// What one item window shows: the item's header (icon, name, tooltip,
// favorite, add to a list), then Prices (the figures and every price level
// on this house) or History. The same item endpoints as the Sell tab.
const InspectorContent = memo(function InspectorContent({ itemId, itemKey, marketKey, marketName, tab, onTab, favorite, onFavoritesChange, onIdentity, onOpenVariant }) {
  const market = useItemMarket({ itemId, itemKey, marketKey })
  const { detail, analysis, focusKey, here } = market
  const [range, setRange] = useState('7d')
  const history = useItemHistory({ itemId, itemKey: focusKey, marketKey, range, enabled: tab === 'history' })
  const data = detail.data
  useEffect(() => {
    if (data?.item?.name) onIdentity({ name: here?.variantName || data.item.name, qualityId: data.item.qualityId })
  }, [data, here, onIdentity])
  if (detail.status === 'loading') return <div className="ah-loading" aria-label="Loading">Loading</div>
  if (detail.status === 'error' || detail.status === 'missing') return <div className="ah-empty">This item could not be loaded. <button type="button" className="ah-button" onClick={detail.reload}>Retry</button></div>
  if (!data) return null
  const item = data.item
  return (
    <div className="ah-insp">
      <ItemHeader item={item} variantName={here?.variantName || ''} favorite={favorite} onFavoritesChange={onFavoritesChange} />
      <p className="ah-facts">{itemFacts(item)}</p>
      <p className="ah-insp__house"><span title={marketKey}>{marketName}</span>{here && here.quantity > 0 ? <> · <Freshness price={here} /></> : null}</p>
      <nav className="ah-insp__tabs" role="tablist" aria-label="Item window sections">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => onTab(id)}>{label}</button>)}
      </nav>
      {tab === 'overview' ? (
        <div className="ah-insp__panel" role="tabpanel" aria-label="Prices">
          <ItemPrices market={market} marketName={marketName} onOpenVariant={onOpenVariant} />
          <SignalChips signals={analysis.data?.signals} />
        </div>
      ) : (
        <div className="ah-insp__panel" role="tabpanel" aria-label="History">
          <MarketCharts history={history.data} range={range} onRange={setRange} compact status={history.status} />
          <MetricsTable metrics={analysis.data?.metrics} />
          <p className="ah-prices__note">{analysis.data?.disclaimer || 'Observed asking prices and listed supply, not sales.'}</p>
        </div>
      )}
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
