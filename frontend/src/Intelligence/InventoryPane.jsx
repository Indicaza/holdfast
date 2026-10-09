import { useEffect, useLayoutEffect, useMemo, useState } from 'react'

import WowIcon, { ItemIcon } from '../WowAssets/WowIcon.jsx'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import { GameTooltipHover, Money } from './GameTooltip.jsx'
import { itemSearchText, leadingGap, matchesSearch, searchTerms } from './inventoryModel.js'
import './InventoryPane.css'

// The game's bag windows (public/inventory-art): the Combined Backpack with
// its search box, every bag's slots in one grid and the money along the
// bottom, plus the reagent bag (and a classic keyring with keys) in windows
// of their own beside it. Searching dims every item that does not match.

const SLOT = 37
const SLOT_GAP = 5
const WINDOW_PADDING = 9
// The frame art reaches past the window box: 13px left, 4px right, 16px up
// and 3px down.
const FRAME_OVERHANG = 17
const FRAME_OVERHANG_VERTICAL = 19
const PANE_PADDING = 8
const MAX_SCALE = 1.5
const WINDOW_GAP = 18
const SIDE_COLUMNS = 4
const MAX_COLUMNS = 10
const MIN_COLUMNS = 4
const SEARCH_DELAY_MS = 150

function windowWidth(columns) {
  return columns * SLOT + (columns - 1) * SLOT_GAP + WINDOW_PADDING * 2 + FRAME_OVERHANG
}

// As many columns as the pane allows, up to the game's ten: beside the side
// windows when everything fits on one row, otherwise on a row of its own.
function combinedColumns(paneWidth, sideWindows) {
  if (!paneWidth) return MAX_COLUMNS
  const sides = sideWindows * (windowWidth(SIDE_COLUMNS) + WINDOW_GAP)
  if (windowWidth(MAX_COLUMNS) + sides <= paneWidth) return MAX_COLUMNS
  const fit = Math.floor((paneWidth - WINDOW_PADDING * 2 - FRAME_OVERHANG + SLOT_GAP) / (SLOT + SLOT_GAP))
  return Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, fit))
}

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

function gridHeight(slots, columns) {
  const rows = Math.max(1, Math.ceil(slots / columns))
  return rows * SLOT + (rows - 1) * SLOT_GAP
}

// The window's outer size at 1x, frame art included: the combined window
// adds the search row and money line under its title band.
function windowSize(window, columns) {
  const chrome = window.kind === 'combined' ? 30 + 29 + 31 + 10 : 40 + 10
  return { width: windowWidth(columns), height: chrome + gridHeight(window.slots.length, columns) + FRAME_OVERHANG_VERTICAL }
}

// Scales the windows up to fill the pane when they all fit on one row,
// capped so the game art stays crisp.
function windowsScale(windows, columnsFor, pane) {
  if (!pane.width || !pane.height) return 1
  const sizes = windows.map((window) => windowSize(window, columnsFor(window)))
  const width = sizes.reduce((sum, size) => sum + size.width, 0) + WINDOW_GAP * (sizes.length - 1) + PANE_PADDING * 2
  const height = Math.max(...sizes.map((size) => size.height)) + PANE_PADDING * 2
  if (width > pane.width) return 1
  return Math.max(1, Math.min(MAX_SCALE, pane.width / width, pane.height / height))
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

  const sideWindows = inventory.windows.filter((window) => window.kind !== 'combined').length
  const columns = combinedColumns(pane.width, sideWindows)
  const columnsFor = (window) => (window.kind === 'combined' ? columns : SIDE_COLUMNS)
  const scale = windowsScale(inventory.windows, columnsFor, pane)

  return (
    <div className="inventory-pane" ref={paneRef}>
      <div className="inventory-pane__windows" style={scale > 1 ? { zoom: scale } : undefined}>
        {inventory.windows.map((window) => (
          <BagWindow
            key={window.id}
            window={window}
            columns={columnsFor(window)}
            search={window.kind === 'combined' ? <SearchBox value={query} onChange={setQuery} /> : null}
            money={window.kind === 'combined' ? inventory.money : null}
            terms={terms}
            searchIndex={searchIndex}
          />
        ))}
      </div>
    </div>
  )
}
