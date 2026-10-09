import { useId, useState } from 'react'

import { FloatingTooltip } from '../WowAssets/WowIcon.jsx'
import { EQUIP_SLOT_NAMES, coins } from './inventoryModel.js'
import './GameTooltip.css'

// GameTooltip as the client draws it for an item in the bags: every line the
// addon captured from the bag slot, in order and in the client's colors (left
// and right columns), then the stack's sell price in coins. Items captured
// before their tooltip loaded fall back to the same lines built from the
// item's metadata.

const COINS = [
  ['gold', 'gold'],
  ['silver', 'silver'],
  ['copperRemainder', 'copper'],
]

// MoneyFrame: gold and silver once there are any, copper always.
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
  const channel = (part) => Math.round(Math.max(0, Math.min(1, Number(part) || 0)) * 255)
  return { color: `rgb(${channel(value.r)}, ${channel(value.g)}, ${channel(value.b)})` }
}

const SELL_PRICE_LINE = /^sell price:?\s*$/i
const WHITE = { r: 1, g: 1, b: 1 }
const GREEN = { r: 0, g: 1, b: 0 }

function capturedLines(item) {
  return (Array.isArray(item?.tooltip?.lines) ? item.tooltip.lines : [])
    .filter((line) => (line?.left || line?.right) && !SELL_PRICE_LINE.test(String(line.left || '').trim()))
}

function statName(key) {
  return String(key).replace(/^ITEM_MOD_/, '').replace(/_SHORT$/, '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
}

// The lines the client would show, from metadata alone.
function metadataLines(item) {
  const lines = []
  if (item.isBound) lines.push({ left: 'Soulbound', leftColor: WHITE })
  else if (Number(item.bindType) === 1) lines.push({ left: 'Binds when picked up', leftColor: WHITE })
  else if (Number(item.bindType) === 2) lines.push({ left: 'Binds when equipped', leftColor: WHITE })
  const slot = EQUIP_SLOT_NAMES[item.equipLocation]
  const subclass = item.itemSubclass?.name
  if (slot) lines.push({ left: slot, right: subclass, leftColor: WHITE, rightColor: WHITE })
  for (const [key, value] of Object.entries(item.stats || {})) {
    if (Number.isFinite(Number(value))) lines.push({ left: `${Number(value) > 0 ? '+' : ''}${value} ${statName(key)}`, leftColor: WHITE })
  }
  if (Number(item.requiredLevel) > 1) lines.push({ left: `Requires Level ${item.requiredLevel}`, leftColor: WHITE })
  if (item.spell?.name) lines.push({ left: `Use: ${item.spell.name}`, leftColor: GREEN })
  if (item.isCraftingReagent) lines.push({ left: 'Crafting Reagent', leftColor: { r: 0.4, g: 0.73, b: 1 } })
  return lines
}

export function GameTooltipBody({ item }) {
  const captured = capturedLines(item)
  const quality = Number(item.qualityId ?? item.quality) || 0
  // The first captured line is the item's name.
  const [title, ...rest] = captured.length ? captured : [{ left: item.name || `Item ${item.itemId || ''}`.trim() }, ...metadataLines(item)]
  const price = Number(item.sellPrice) > 0 ? coins(item.sellPrice) : null

  return (
    <>
      <div className={`game-tooltip__line game-tooltip__title item-quality-${quality}`}>
        <span style={captured.length ? color(title.leftColor) : undefined}>{title.left || item.name}</span>
        {title.right ? <span style={color(title.rightColor)}>{title.right}</span> : null}
      </div>
      {rest.map((line, index) => (
        <div key={`${index}:${line.left}`} className="game-tooltip__line">
          <span style={color(line.leftColor) || color(WHITE)}>{line.left}</span>
          {line.right ? <span className="game-tooltip__right" style={color(line.rightColor) || color(WHITE)}>{line.right}</span> : null}
        </div>
      ))}
      {price ? (
        <div className="game-tooltip__line game-tooltip__price">
          <span>Sell Price: <Money money={price} /></span>
        </div>
      ) : null}
    </>
  )
}

export function GameTooltipHover({ item, children, side = 'right' }) {
  const tooltipId = useId()
  const [anchor, setAnchor] = useState(null)
  if (!item) return children
  // The wrapper is display: contents (no box), so measure the trigger inside it.
  const show = (event) => setAnchor((event.currentTarget.firstElementChild || event.currentTarget).getBoundingClientRect())
  const hide = () => setAnchor(null)
  return (
    <span
      className="game-tooltip-hover"
      aria-describedby={anchor ? tooltipId : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {anchor && typeof document !== 'undefined' ? (
        <FloatingTooltip anchor={anchor} side={side} id={tooltipId} className="game-tooltip">
          <GameTooltipBody item={item} />
        </FloatingTooltip>
      ) : null}
    </span>
  )
}
