import { useId, useState } from 'react'

import { FloatingTooltip } from '../WowAssets/WowIcon.jsx'
import { coins } from './inventoryModel.js'
import './GameTooltip.css'

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
// Armory and inventory items are already flat. Normalize identity only; the
// tooltip itself remains untouched client data.
function gameTooltipItem(value) {
  if (!value || typeof value !== 'object') return null
  const outer = object(value)
  const described = object(outer.item)
  const catalog = object(outer.catalog)
  const metadata = object(catalog.metadata)
  const merged = { ...metadata, ...outer, ...described }

  return {
    ...merged,
    itemId: described.itemId ?? outer.itemId ?? metadata.itemId ?? null,
    itemLink: described.itemLink || outer.itemLink || metadata.itemLink || '',
    name: described.name || outer.name || metadata.name || '',
    qualityId: described.qualityId ?? described.quality ?? outer.qualityId ?? outer.quality ?? metadata.qualityId ?? metadata.quality ?? null,
    sellPrice: described.sellPrice ?? outer.sellPrice ?? metadata.sellPrice ?? null,
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
  const channels = ['r', 'g', 'b'].map((part) => Number(value[part]))
  if (!channels.every(Number.isFinite)) return undefined
  const [r, g, b] = channels.map((part) => Math.round(Math.max(0, Math.min(1, part)) * 255))
  const alpha = Number(value.a)
  if (Number.isFinite(alpha)) return { color: `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})` }
  return { color: `rgb(${r}, ${g}, ${b})` }
}

function capturedLines(item) {
  const source = Array.isArray(item?.tooltip?.lines)
    ? item.tooltip.lines
    : Array.isArray(item?.tooltipLines)
      ? item.tooltipLines
      : []

  return source.map((line) => {
    const entry = object(line)
    return {
      ...entry,
      left: entry.left ?? entry.leftText ?? entry.text ?? '',
      right: entry.right ?? entry.rightText ?? '',
      leftColor: entry.leftColor ?? entry.color,
    }
  }).filter((line) => line.blank || line.sellPrice || line.left || line.right)
}

function isItem(item) {
  return Number(item?.itemId) > 0 || /(?:^|\|H)item:\d+/i.test(String(item?.itemLink || ''))
}

function fullBlizzardTooltip(item) {
  const tooltip = object(item?.tooltip)
  const lines = capturedLines(item)
  if (!lines.length || tooltip.source !== 'GameTooltip') return false
  // Backward compatibility for rendered scans captured before Guildweaver
  // started writing explicit completeness markers.
  if (tooltip.complete === undefined && tooltip.rendered === undefined) return true
  return tooltip.complete === true && tooltip.rendered === true
}

function sellPriceAlreadyCaptured(lines) {
  return lines.some((line) => line.sellPrice || /^sell\s+price\s*:/i.test(String(line.left || '').trim()))
}

function CapturedRows({ lines, quality }) {
  return lines.map((line, index) => {
    if (line.blank || line.sellPrice) {
      return <div key={`blank-${index}`} className="game-tooltip__blank" aria-hidden="true" />
    }
    const title = index === 0
    const style = line.offset ? { paddingLeft: `${line.offset}px` } : undefined
    return (
      <div key={`${index}:${line.left}:${line.right || ''}`} className={`game-tooltip__line${title ? ` game-tooltip__title item-quality-${quality}` : ''}`} style={style}>
        <span style={color(line.leftColor)}>{line.left}</span>
        {line.right ? <span className="game-tooltip__right" style={color(line.rightColor)}>{line.right}</span> : null}
      </div>
    )
  })
}

export function GameTooltipBody({ item: value }) {
  const item = gameTooltipItem(value) || {}
  const lines = capturedLines(item)
  const quality = Number(item.qualityId ?? item.quality) || 0
  const actualItem = isItem(item)
  const full = fullBlizzardTooltip(item)

  // For real items, never manufacture a tooltip from metadata. If the client
  // has not sent its rendered GameTooltip yet, say so and wait for Guildweaver
  // to self-heal the definition.
  if (actualItem && !full) {
    return (
      <>
        <div className={`game-tooltip__line game-tooltip__title item-quality-${quality}`}>
          <span>{item.name || 'Item tooltip'}</span>
        </div>
        <div className="game-tooltip__pending">Full Blizzard tooltip is still syncing…</div>
      </>
    )
  }

  // Non-item controls (profession buttons, recipe spells) may legitimately
  // provide captured spell lines or a small textual description.
  if (!lines.length) {
    return (
      <>
        <div className={`game-tooltip__line game-tooltip__title item-quality-${quality}`}>
          <span>{item.name || 'Tooltip'}</span>
        </div>
        {item.description ? <div className="game-tooltip__line"><span>{String(item.description)}</span></div> : null}
      </>
    )
  }

  const price = actualItem && Number(item.sellPrice) > 0 && !sellPriceAlreadyCaptured(lines)
    ? coins(item.sellPrice)
    : null

  return (
    <>
      <CapturedRows lines={lines} quality={quality} />
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
