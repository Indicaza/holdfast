import { useEffect, useId, useState } from 'react'

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

const QUALITY_NAMES = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact', 'Heirloom']
// Shown under an item the website knows only by name: never a tooltip made
// up from metadata, but a word on why the real one is missing.
export const PENDING_NOTE = 'Full tooltip arrives once a Guildweaver player sees this item in game.'

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
  return lines.some((line) => /^sell\s+price\s*:/i.test(String(line.left || '').trim()))
}

function CapturedRows({ lines, quality, price }) {
  return lines.map((line, index) => {
    if (line.sellPrice && price) {
      return <div key={`price-${index}`} className="game-tooltip__line game-tooltip__price">
        <span>Sell Price: <Money money={price} /></span>
      </div>
    }
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

// Facts a page already holds about an item the game has not described to
// Guildweaver yet (`reference`: { lines: [{ left, right?, tone? }], label }).
// Drawn in the tooltip's frame but marked as reference, never as the game's
// own text.
function ReferenceRows({ reference }) {
  return (
    <>
      {reference.lines.map((line, index) => (
        <div key={`${index}:${line.left}`} className={`game-tooltip__line game-tooltip__reference${line.tone ? ` game-tooltip__reference--${line.tone}` : ''}`}>
          <span>{line.left}</span>
          {line.right ? <span className="game-tooltip__right">{line.right}</span> : null}
        </div>
      ))}
      <div className="game-tooltip__line game-tooltip__pending game-tooltip__reference-label"><span>{reference.label || 'Reference data'}</span></div>
    </>
  )
}

export function GameTooltipBody({ item: value, reference = null }) {
  const item = gameTooltipItem(value) || {}
  const lines = capturedLines(item)
  const quality = item.qualityId ?? item.quality ?? null
  const actualItem = isItem(item)

  // For real items, never manufacture a tooltip from metadata. An item with
  // no captured lines shows only what is known for certain: its name and
  // quality (see itemTooltipPending).
  if (itemTooltipPending(item)) {
    const facts = reference && Array.isArray(reference.lines) && reference.lines.length ? reference : null
    return (
      <>
        <div className={`game-tooltip__line game-tooltip__title item-quality-${quality}`}>
          <span>{item.name || `Item ${item.itemId || ''}`.trim()}</span>
        </div>
        {!facts && QUALITY_NAMES[quality] ? <div className="game-tooltip__line game-tooltip__quality"><span>{QUALITY_NAMES[quality]}</span></div> : null}
        {facts ? <ReferenceRows reference={facts} /> : <div className="game-tooltip__line game-tooltip__pending"><span>{PENDING_NOTE}</span></div>}
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
  const hasPriceMarker = lines.some((line) => line.sellPrice)

  return (
    <>
      <CapturedRows lines={lines} quality={quality} price={price} />
      {price && !hasPriceMarker ? (
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

// Hover (or keyboard focus) on the children shows the game's tooltip for
// `item`, beside the first child, or beside the children's parent with
// anchor="parent" (a whole row or card). The wrapper has no box of its own.
// disabled: keeps the wrapper (and so the children's identity) but shows
// nothing, for a control whose own popover is open.
// touch={false}: a tap does not open it (the tapped control shows the item
// its own way, as the dungeon loot slots do); mouse, pen and keyboard still do.
//
// reference: facts to show, marked as such, when the game's lines are not
// captured yet.
export function GameTooltipHover({ item, children, side = 'right', className = '', anchor: anchorTo = 'child', touch = true, reference = null, disabled = false }) {
  const tooltipId = useId()
  // { rect, element, by: 'pointer' | 'focus' } while shown.
  const [shownAt, setShownAt] = useState(null)
  const anchor = shownAt?.rect || null
  const shown = Boolean(shownAt)
  // A pointer tooltip is placed once, against where its item was: a scroll
  // hides it (the next move over the item brings it back). A keyboard one
  // follows its focused item through the scroll that focusing often causes,
  // drawn only while the item is in the window. A press means the reader is
  // acting on the item, and Escape asks it to go, as in the app's other
  // tooltips.
  useEffect(() => {
    if (!shown) return undefined
    const hide = () => setShownAt(null)
    let frame = 0
    const onScroll = () => {
      if (shownAt.by !== 'focus' || !shownAt.element?.isConnected) { hide(); return }
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = shownAt.element.getBoundingClientRect()
        const away = rect.bottom < 0 || rect.top > window.innerHeight
        setShownAt((current) => (current ? { ...current, rect, away } : current))
      })
    }
    const onKey = (event) => { if (event.key === 'Escape') hide() }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', hide)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', hide)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [shown, shownAt?.by, shownAt?.element])
  const normalized = gameTooltipItem(item)
  if (!normalized) return children
  const at = (event, by) => {
    const wrapper = event.currentTarget
    const element = (anchorTo === 'parent' ? wrapper.parentElement : wrapper.firstElementChild) || wrapper
    return { rect: element.getBoundingClientRect(), element, by }
  }
  // Only a change of state renders: moving within the item, or entering it
  // again while shown, does nothing.
  const show = (event) => { if (!shown && !disabled) setShownAt(at(event, 'pointer')) }
  const showOnFocus = (event) => {
    if (!disabled && focusVisible(event)) setShownAt(at(event, 'focus'))
  }
  const hide = () => setShownAt(null)
  return (
    <span
      className="game-tooltip-hover"
      aria-describedby={anchor && !shownAt.away ? tooltipId : undefined}
      {...(touch ? { onMouseEnter: show, onMouseLeave: hide } : {
        onPointerEnter: (event) => { if (event.pointerType !== 'touch') show(event) },
        // After a scroll hid it, the next move over the item brings it back.
        onPointerMove: (event) => { if (event.pointerType !== 'touch') show(event) },
        onPointerLeave: hide,
      })}
      onFocus={showOnFocus}
      onBlur={hide}
    >
      {children}
      {anchor && !shownAt.away && !disabled && typeof document !== 'undefined' ? (
        <FloatingTooltip anchor={anchor} side={side} id={tooltipId} className={`game-tooltip${className ? ` ${className}` : ''}`}>
          <GameTooltipBody item={normalized} reference={reference} />
        </FloatingTooltip>
      ) : null}
    </span>
  )
}

// The game's tooltip as a card in the page (the item catalog's description),
// the same frame and lines as on hover, nothing floating.
export function GameTooltipCard({ item, className = '', reference = null }) {
  const normalized = gameTooltipItem(item)
  if (!normalized) return null
  return (
    <div className={`game-tooltip game-tooltip--card${className ? ` ${className}` : ''}`}>
      <GameTooltipBody item={normalized} reference={reference} />
    </div>
  )
}
