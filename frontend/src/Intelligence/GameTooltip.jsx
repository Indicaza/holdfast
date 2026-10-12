import { useId, useState } from 'react'

import { FloatingTooltip } from '../WowAssets/WowIcon.jsx'
import { EQUIP_SLOT_NAMES, coins } from './inventoryModel.js'
import './GameTooltip.css'

// GameTooltip as the client draws it. Captured client lines are authoritative;
// structured item metadata only fills gaps when a tooltip was not fully cached
// yet. This keeps Forever-specific item text exact without leaving sparse
// one-line tooltips across the app.

const COINS = [
  ['gold', 'gold'],
  ['silver', 'silver'],
  ['copperRemainder', 'copper'],
]

export function Money({ money, className = '' }) {
  const shown = COINS.filter((_, index) => index === COINS.length - 1 || COINS.slice(0, index + 1).some(([earlier]) => money[earlier] > 0))
  return (
    <span className={`wow-money${className ? ` ${className}` : ''}`} aria-label={`${money.gold} gold, ${money.silver} silver, ${money.copperRemainder} copper`}>
      {shown.map(([key, coin]) => (
        <span key={coin} className="wow-money__part">
          {money[key].toLocaleString()}
          <img src={`/inventory-art/coin-${coin}.webp`} alt="" width="13" height="13" />
        </span>
      ))}
    </span>
  )
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

// Farming results carry the canonical client description under `item`, while
// Armory/inventory items are already flat. Catalog metadata is an older
// fallback. Normalize all three into the one shape GameTooltip renders.
function gameTooltipItem(value) {
  if (!value || typeof value !== 'object') return null
  const outer = object(value)
  const described = object(outer.item)
  const catalog = object(outer.catalog)
  const metadata = object(catalog.metadata)
  const merged = { ...outer, ...metadata, ...described }

  return {
    ...merged,
    itemId: described.itemId ?? outer.itemId ?? metadata.itemId ?? null,
    itemLink: described.itemLink || outer.itemLink || metadata.itemLink || '',
    name: described.name || outer.name || metadata.name || '',
    qualityId: described.qualityId ?? described.quality ?? outer.qualityId ?? outer.quality ?? metadata.qualityId ?? metadata.quality ?? null,
    iconFileDataId: described.iconFileDataId ?? described.iconFileId ?? outer.iconFileDataId ?? outer.iconFileId ?? metadata.iconFileDataId ?? metadata.iconFileId ?? null,
    tooltip: Object.keys(object(described.tooltip)).length
      ? described.tooltip
      : Object.keys(object(outer.tooltip)).length
        ? outer.tooltip
        : object(metadata.tooltip),
    tooltipLines: Array.isArray(described.tooltipLines)
      ? described.tooltipLines
      : Array.isArray(outer.tooltipLines)
        ? outer.tooltipLines
        : Array.isArray(metadata.tooltipLines)
          ? metadata.tooltipLines
          : [],
  }
}

function color(value) {
  if (!value || typeof value !== 'object') return undefined
  const channel = (part) => Math.round(Math.max(0, Math.min(1, Number(part) || 0)) * 255)
  return { color: `rgb(${channel(value.r)}, ${channel(value.g)}, ${channel(value.b)})` }
}

const SELL_PRICE_LINE = /^sell price:?\s*$/i
const WHITE = { r: 1, g: 1, b: 1 }
const NORMAL = { r: 1, g: 0.82, b: 0 }
const GREEN = { r: 0, g: 1, b: 0 }

function capturedLines(item) {
  const source = Array.isArray(item?.tooltip?.lines)
    ? item.tooltip.lines
    : Array.isArray(item?.tooltipLines)
      ? item.tooltipLines
      : []
  return source
    .map((line) => {
      const entry = object(line)
      return {
        ...entry,
        left: entry.left ?? entry.leftText ?? entry.text ?? '',
        right: entry.right ?? entry.rightText ?? '',
        leftColor: entry.leftColor ?? entry.color,
      }
    })
    .filter((line) => line && (line.blank || line.left || line.right) && !SELL_PRICE_LINE.test(String(line.left || '').trim()))
}

function statName(key) {
  return String(key).replace(/^ITEM_MOD_/, '').replace(/_SHORT$/, '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function metadataLines(item) {
  const lines = []
  if (Number(item.itemLevel) > 0) lines.push({ left: `Item Level ${item.itemLevel}`, leftColor: NORMAL })
  if (item.isBound) lines.push({ left: 'Soulbound', leftColor: WHITE })
  else if (Number(item.bindType) === 1) lines.push({ left: 'Binds when picked up', leftColor: WHITE })
  else if (Number(item.bindType) === 2) lines.push({ left: 'Binds when equipped', leftColor: WHITE })
  const slot = EQUIP_SLOT_NAMES[item.equipLocation]
  const subclass = item.itemSubclass?.name || item.itemSubclassName || item.subclass
  if (slot) lines.push({ left: slot, right: subclass, leftColor: WHITE, rightColor: WHITE })
  for (const [key, value] of Object.entries(item.stats || {})) {
    if (Number.isFinite(Number(value))) lines.push({ left: `${Number(value) > 0 ? '+' : ''}${value} ${statName(key)}`, leftColor: WHITE })
  }
  if (Number(item.requiredLevel) > 1) lines.push({ left: `Requires Level ${item.requiredLevel}`, leftColor: WHITE })
  if (item.spell?.name) lines.push({ left: `Use: ${item.spell.name}`, leftColor: GREEN })
  if (item.isCraftingReagent) lines.push({ left: 'Crafting Reagent', leftColor: { r: 0.4, g: 0.73, b: 1 } })
  if (item.description) lines.push({ left: String(item.description), leftColor: NORMAL })
  return lines
}

function sameText(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase()
}

function lineKey(line) {
  return `${String(line?.left || '').trim().toLowerCase()}|${String(line?.right || '').trim().toLowerCase()}`
}

function fallbackWithoutDuplicates(existing, fallback) {
  const seen = new Set(existing.filter((line) => !line.blank).map(lineKey))
  return fallback.filter((line) => {
    const key = lineKey(line)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function GameTooltipBody({ item: value }) {
  const item = gameTooltipItem(value) || {}
  const captured = capturedLines(item)
  const quality = Number(item.qualityId ?? item.quality) || 0
  const first = captured[0]
  const capturedHasTitle = Boolean(first?.left && item.name && sameText(first.left, item.name))
  const title = capturedHasTitle ? first : { left: item.name || `Item ${item.itemId || ''}`.trim() || 'Unknown item' }
  const exactBody = capturedHasTitle ? captured.slice(1) : captured
  const exactDetails = exactBody.filter((line) => !line.blank && (line.left || line.right))
  const fallback = exactDetails.length < 2 ? fallbackWithoutDuplicates(exactBody, metadataLines(item)) : []
  const body = [...exactBody, ...fallback]
  const price = Number(item.sellPrice) > 0 ? coins(item.sellPrice) : null

  return (
    <>
      <div className={`game-tooltip__line game-tooltip__title item-quality-${quality}`}>
        <span style={capturedHasTitle ? color(title.leftColor) : undefined}>{title.left || item.name}</span>
        {title.right ? <span style={color(title.rightColor)}>{title.right}</span> : null}
      </div>
      {body.map((line, index) => (line.blank ? <div key={`blank-${index}`} className="game-tooltip__blank" aria-hidden="true" /> : (
        <div key={`${index}:${line.left}:${line.right || ''}`} className="game-tooltip__line" style={line.offset ? { paddingLeft: `${line.offset}px` } : undefined}>
          <span style={color(line.leftColor) || color(NORMAL)}>{line.left}</span>
          {line.right ? <span className="game-tooltip__right" style={color(line.rightColor) || color(NORMAL)}>{line.right}</span> : null}
        </div>
      )))}
      {price ? (
        <div className="game-tooltip__line game-tooltip__price">
          <span>Sell Price: <Money money={price} /></span>
        </div>
      ) : null}
    </>
  )
}

function focusVisible(event) {
  try {
    return event.target.matches(':focus-visible')
  } catch {
    return true
  }
}

export function GameTooltipHover({ item, children, side = 'right', className = '' }) {
  const tooltipId = useId()
  const [anchor, setAnchor] = useState(null)
  const normalized = gameTooltipItem(item)
  if (!normalized) return children
  const measure = (event) => (event.currentTarget.firstElementChild || event.currentTarget).getBoundingClientRect()
  const show = (event) => setAnchor(measure(event))
  const showOnFocus = (event) => {
    if (focusVisible(event)) setAnchor(measure(event))
  }
  const hide = () => setAnchor(null)
  return (
    <span
      className="game-tooltip-hover"
      aria-describedby={anchor ? tooltipId : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={showOnFocus}
      onBlur={hide}
    >
      {children}
      {anchor && typeof document !== 'undefined' ? (
        <FloatingTooltip anchor={anchor} side={side} id={tooltipId} className={`game-tooltip${className ? ` ${className}` : ''}`}>
          <GameTooltipBody item={normalized} />
        </FloatingTooltip>
      ) : null}
    </span>
  )
}
