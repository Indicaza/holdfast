import { useEffect, useLayoutEffect, useMemo, useState } from 'react'

import WowIcon, { ItemIcon } from '../WowAssets/WowIcon.jsx'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import { GameTooltipHover, Money } from './GameTooltip.jsx'
import { SIDE_COLUMNS, SLOT, windowsLayout } from './inventoryLayout.js'
import { itemSearchText, leadingGap, matchesSearch, searchTerms } from './inventoryModel.js'
import './InventoryPane.css'

// The game's bag windows (public/inventory-art): the Combined Backpack with
// its search box, every bag's slots in one grid and the money along the
// bottom, plus the reagent bag (and a classic keyring with keys) in windows
// of their own beside it. Searching dims every item that does not match.

const SEARCH_DELAY_MS = 150

function usePaneSize() {
  const [element, setElement] = useState(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    if (!element) return undefined
    setSize({ width: element.clientWidth, height: element.clientHeight })
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return [setElement, size]
}

function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

function SearchBox({ value, onChange }) {
  return (
    <div className="bag-search">
      <img className="bag-search__icon" src="/inventory-art/search-icon.webp" alt="" />
      <input
        type="search"
        value={value}
        placeholder="Search"
        aria-label="Search bags"
        spellCheck="false"
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.stopPropagation()
            onChange('')
          }
        }}
      />
      {value ? (
        <button type="button" className="bag-search__clear" aria-label="Clear search" onClick={() => onChange('')}>
          <img src="/inventory-art/search-clear.webp" alt="" />
        </button>
      ) : null}
    </div>
  )
}

function Slot({ entry, dimmed }) {
  const { item } = entry
  if (!item) return <span className={`bag-slot${dimmed ? ' is-dimmed' : ''}`} aria-hidden="true" />
  const quality = Number(item.qualityId) || 0
  const name = item.name || `Item ${item.itemId || ''}`.trim()
  return (
    <GameTooltipHover item={item}>
      <span
        className={`bag-slot bag-slot--filled bag-slot--quality-${quality}${dimmed ? ' is-dimmed' : ''}`}
        tabIndex={0}
        role="img"
        aria-label={`${name}${item.count > 1 ? `, ${item.count}` : ''}`}
      >
        <ItemIcon item={item} size={SLOT} />
        {item.count > 1 ? <span className="bag-slot__count">{item.count}</span> : null}
      </span>
    </GameTooltipHover>
  )
}

function BagWindow({ window, columns, search, money, terms, searchIndex }) {
  const gap = leadingGap(window.slots.length, columns)
  const searching = terms.length > 0
  return (
    <section className={`bag-window bag-window--${window.kind}`} aria-label={window.title} style={{ '--bag-columns': columns }}>
      <span className="bag-window__background" aria-hidden="true" />
      <span className="bag-window__portrait" aria-hidden="true">
        {window.iconFileId ? <WowIcon iconFileId={window.iconFileId} label={window.title} size={34} /> : null}
      </span>
      <span className="bag-window__frame" aria-hidden="true">
        <span className="bag-window__piece bag-window__piece--top-left" />
        <span className="bag-window__piece bag-window__piece--top" />
        <span className="bag-window__piece bag-window__piece--top-right" />
        <span className="bag-window__piece bag-window__piece--left" />
        <span className="bag-window__piece bag-window__piece--right" />
        <span className="bag-window__piece bag-window__piece--bottom-left" />
        <span className="bag-window__piece bag-window__piece--bottom" />
        <span className="bag-window__piece bag-window__piece--bottom-right" />
      </span>
      <h3 className="bag-window__title">{window.title}</h3>
      {search}
      <div className="bag-window__grid">
        {Array.from({ length: gap }, (_, index) => <span key={`gap-${index}`} className="bag-slot bag-slot--gap" aria-hidden="true" />)}
        {window.slots.map((entry) => (
          <Slot
            key={entry.id}
            entry={entry}
            dimmed={searching && (!entry.item || !matchesSearch(searchIndex.get(entry.id) || '', terms))}
          />
        ))}
      </div>
      {money ? <div className="bag-window__money"><Money money={money} /></div> : null}
    </section>
  )
}

export default function InventoryPane({ inventory }) {
  const [paneRef, pane] = usePaneSize()
  const [query, setQuery] = useState('')
  const terms = searchTerms(useDebounced(query, SEARCH_DELAY_MS))

  const searchIndex = useMemo(() => {
    const index = new Map()
    for (const window of inventory?.windows || []) {
      for (const entry of window.slots) {
        if (entry.item) index.set(entry.id, itemSearchText(entry.item))
      }
    }
    return index
  }, [inventory])

  if (!inventory) {
    return (
      <div className="inventory-pane inventory-pane--empty">
        <EmptyTelemetry title="No inventory synced yet.">
          Guildweaver records bag contents and money as they change. Loot or move an item (or type /gw inventory), then /reload to sync.
        </EmptyTelemetry>
      </div>
    )
  }

  const layout = windowsLayout(inventory.windows, pane)
  const bagWindow = (window) => (
    <BagWindow
      key={window.id}
      window={window}
      columns={window.kind === 'combined' ? layout.columns : SIDE_COLUMNS}
      search={window.kind === 'combined' ? <SearchBox value={query} onChange={setQuery} /> : null}
      money={window.kind === 'combined' ? inventory.money : null}
      terms={terms}
      searchIndex={searchIndex}
    />
  )
  const sides = inventory.windows.filter((window) => window.kind !== 'combined')
  const combined = inventory.windows.find((window) => window.kind === 'combined')

  return (
    <div className="inventory-pane" ref={paneRef}>
      <div
        className={`inventory-pane__windows${layout.stacked ? ' inventory-pane__windows--stacked' : ''}`}
        style={layout.scale > 1 ? { zoom: layout.scale } : undefined}
      >
        {sides.length ? <div className="inventory-pane__side">{sides.map(bagWindow)}</div> : null}
        {combined ? bagWindow(combined) : null}
      </div>
    </div>
  )
}
