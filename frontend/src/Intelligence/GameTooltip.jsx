import { useId, useState } from 'react'

import { FloatingTooltip } from '../WowAssets/WowIcon.jsx'
import { coins } from './inventoryModel.js'
import { capturedLines, gameTooltipItem, isItem, itemTooltipPending } from './gameTooltipModel.js'
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

function color(value) {
  if (!value || typeof value !== 'object') return undefined
  const channels = ['r', 'g', 'b'].map((part) => Number(value[part]))
  if (!channels.every(Number.isFinite)) return undefined
  const [r, g, b] = channels.map((part) => Math.round(Math.max(0, Math.min(1, part)) * 255))
  const alpha = Number(value.a)
  if (Number.isFinite(alpha)) return { color: `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})` }
  return { color: `rgb(${r}, ${g}, ${b})` }
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

  // For real items, never manufacture a tooltip from metadata. An item with
  // no captured lines waits for Guildweaver (see itemTooltipPending).
  if (itemTooltipPending(item)) {
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
