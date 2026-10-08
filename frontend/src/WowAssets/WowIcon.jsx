import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { wowAssetDescriptor } from './assetResolver.js'
import './WowIcon.css'

function fallbackText(label, descriptor) {
  const source = String(label || '').trim()
  if (source) return source.slice(0, 2).toUpperCase()
  const id = descriptor.iconFileId || descriptor.itemId || descriptor.spellId || descriptor.recipeId
  return id ? String(id).slice(-2) : '✦'
}

function safeImageSource(value) {
  const source = String(value || '').trim()
  if (!source) return ''
  try {
    const browserOrigin = globalThis.window?.location?.origin || 'https://holdfast.invalid'
    const parsed = new URL(source, browserOrigin)
    return parsed.protocol === 'https:' || parsed.origin === browserOrigin ? parsed.toString() : ''
  } catch {
    return ''
  }
}

export function WowIcon({
  src = '',
  iconFileId,
  itemId,
  spellId,
  recipeId,
  label = '',
  size = 48,
  quality = null,
  className = '',
}) {
  const descriptor = wowAssetDescriptor({ iconFileId, itemId, spellId, recipeId, size })
  const imageSource = safeImageSource(src) || descriptor.src
  const [failed, setFailed] = useState(false)
  const qualityClass = Number.isFinite(Number(quality)) ? ` wow-icon--quality-${Number(quality)}` : ''

  useEffect(() => {
    setFailed(false)
  }, [imageSource])

  return (
    <span
      className={`wow-icon${qualityClass}${className ? ` ${className}` : ''}`}
      style={{ '--wow-icon-size': `${size}px` }}
      aria-hidden="true"
      data-icon-file-id={descriptor.iconFileId || undefined}
    >
      {imageSource && !failed ? (
        <img src={imageSource} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="wow-icon__fallback">{fallbackText(label, descriptor)}</span>
      )}
    </span>
  )
}

export function ItemIcon({ item, size = 48, className = '' }) {
  return (
    <WowIcon
      src={item?.mediaUrl || item?.catalog?.metadata?.mediaUrl}
      iconFileId={item?.iconFileId ?? item?.iconFileDataId ?? item?.iconFileID}
      itemId={item?.itemId ?? item?.itemID}
      label={item?.name || item?.slot}
      quality={item?.quality ?? item?.qualityId}
      size={size}
      className={className}
    />
  )
}

function enchantLabel(enchant) {
  if (!enchant) return ''
  if (typeof enchant === 'string' || typeof enchant === 'number') return String(enchant)
  if (Array.isArray(enchant)) return enchant.map(enchantLabel).filter(Boolean).join(' · ')
  return String(enchant.name || enchant.text || enchant.description || enchant.id || '')
}

function itemType(item) {
  return [
    item?.itemSubclassName || item?.itemSubclass?.name || item?.subclass,
    item?.equipLocation,
  ].filter(Boolean).join(' · ')
}

function coinParts(copper) {
  const value = Number(copper)
  if (!Number.isFinite(value) || value <= 0) return []
  const total = Math.floor(value)
  const gold = Math.floor(total / 10000)
  const silver = Math.floor((total % 10000) / 100)
  const bronze = total % 100
  return [gold ? `${gold}g` : '', silver ? `${silver}s` : '', bronze || (!gold && !silver) ? `${bronze}c` : ''].filter(Boolean)
}

function clientTooltipLines(item) {
  const source = Array.isArray(item?.tooltipLines)
    ? item.tooltipLines
    : Array.isArray(item?.tooltip?.lines)
      ? item.tooltip.lines
      : []
  const name = String(item?.name || '').trim().toLowerCase()
  const itemLevel = Number(item?.itemLevel)

  return source.filter((line) => {
    const left = String(line?.left || line?.leftText || line?.text || '').trim()
    const right = String(line?.right || line?.rightText || '').trim()
    if (!left && !right) return false
    if (name && !right && left.toLowerCase() === name) return false
    if (itemLevel && !right && new RegExp(`^item level\\s+${itemLevel}$`, 'i').test(left)) return false
    return true
  })
}

function tooltipColorStyle(value) {
  if (!value || typeof value !== 'object') return undefined
  const channels = ['r', 'g', 'b'].map((key) => Number(value[key]))
  if (!channels.every(Number.isFinite)) return undefined
  const normalized = channels.map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255))
  const alpha = Number(value.a)
  const opacity = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1
  return { color: `rgba(${normalized[0]}, ${normalized[1]}, ${normalized[2]}, ${opacity})` }
}

function ClientTooltip({ item, limit = 40 }) {
  const lines = clientTooltipLines(item).slice(0, limit)
  if (!lines.length) return null

  return (
    <div className="item-tooltip__client-lines">
      {lines.map((line, index) => {
        const left = String(line?.left || line?.leftText || line?.text || '').trim()
        const right = String(line?.right || line?.rightText || '').trim()
        return (
          <div className="item-tooltip__client-line" key={`${left}:${right}:${index}`}>
            <span style={tooltipColorStyle(line?.leftColor || line?.color)}>{left}</span>
            {right ? <span style={tooltipColorStyle(line?.rightColor)}>{right}</span> : null}
          </div>
        )
      })}
    </div>
  )
}

function statLabel(value) {
  return String(value || '')
    .replace(/^ITEM_MOD_/, '')
    .replace(/_SHORT$/, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function structuredStats(item) {
  return Object.entries(item?.stats && typeof item.stats === 'object' ? item.stats : {})
    .filter(([, value]) => Number.isFinite(Number(value)))
    .slice(0, 24)
}

function StatLines({ item }) {
  const stats = structuredStats(item)
  if (!stats.length) return null
  return (
    <div className="item-tooltip__stats">
      {stats.map(([key, value]) => (
        <span key={key}>{Number(value) > 0 ? '+' : ''}{Number(value)} {statLabel(key)}</span>
      ))}
    </div>
  )
}

function DurabilityLine({ item }) {
  const current = Number(item?.durability?.current)
  const max = Number(item?.durability?.max)
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return null
  return <span>Durability {current} / {max}</span>
}

function TooltipBody({ item, compact = false }) {
  const enchant = enchantLabel(item?.enchant)
  const type = itemType(item)
  const price = coinParts(item?.sellPrice)
  const description = String(item?.description || '').trim()
  const richLines = clientTooltipLines(item)
  const hasClientTooltip = richLines.length > 0

  return (
    <>
      <strong className={`item-tooltip__name item-quality-${Number(item?.quality ?? item?.qualityId) || 0}`}>
        {item?.name || `Item ${item?.itemId || ''}`.trim() || 'Unknown item'}
      </strong>
      {item?.itemLevel ? <span className="item-tooltip__level">Item Level {item.itemLevel}</span> : null}
      {hasClientTooltip ? <ClientTooltip item={item} limit={compact ? 12 : 40} /> : (
        <>
          {type ? <span>{type}</span> : null}
          {item?.requiredLevel ? <span>Requires Level {item.requiredLevel}</span> : null}
          {enchant ? <span className="item-tooltip__enchant">Enhancement: {enchant}</span> : null}
          <StatLines item={item} />
          <DurabilityLine item={item} />
          {item?.spell?.name ? <span className="item-tooltip__effect">Effect: {item.spell.name}</span> : null}
          {description && !compact ? <p>{description}</p> : null}
        </>
      )}
      {price.length && !compact ? <span>Sell price: {price.join(' ')}</span> : null}
      {item?.itemId && !compact ? <small>Item #{item.itemId}</small> : null}
    </>
  )
}

export function ItemTooltip({ item, side = 'right', id, compact = false }) {
  if (!item) return null
  return (
    <div id={id} className={`item-tooltip item-tooltip--${side}`} role="tooltip">
      <TooltipBody item={item} compact={compact} />
    </div>
  )
}

const TOOLTIP_GAP = 10
const VIEWPORT_MARGIN = 12

// Places a tooltip beside its anchor on the preferred side, flips when that
// side has no room, and clamps it inside the viewport. Rendered into
// document.body so no scrolling or clipping ancestor can cut it off.
export function FloatingTooltip({ anchor, side = 'right', id, className = '', children }) {
  const ref = useRef(null)
  const [position, setPosition] = useState(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const { width, height } = element.getBoundingClientRect()
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN
    let left
    let top
    if (side === 'top') {
      left = anchor.left + anchor.width / 2 - width / 2
      top = anchor.top - height - TOOLTIP_GAP
      if (top < VIEWPORT_MARGIN) top = anchor.bottom + TOOLTIP_GAP
    } else {
      const right = anchor.right + TOOLTIP_GAP
      const leftSide = anchor.left - width - TOOLTIP_GAP
      const fitsRight = right + width <= window.innerWidth - VIEWPORT_MARGIN
      const fitsLeft = leftSide >= VIEWPORT_MARGIN
      left = side === 'left' ? (fitsLeft || !fitsRight ? leftSide : right) : (fitsRight || !fitsLeft ? right : leftSide)
      top = anchor.top
    }
    setPosition({
      left: Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft)),
      top: Math.max(VIEWPORT_MARGIN, Math.min(top, maxTop)),
    })
  }, [anchor, side])

  return createPortal(
    <div
      ref={ref}
      id={id}
      className={`item-tooltip item-tooltip--floating${className ? ` ${className}` : ''}`}
      role="tooltip"
      style={position ? { left: position.left, top: position.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  )
}

export function ItemHoverCard({ item, children, side = 'right', className = '' }) {
  const tooltipId = useId()
  const [anchor, setAnchor] = useState(null)
  if (!item) return children
  // The wrapper is display: contents (no box), so measure the trigger inside it.
  const show = (event) => setAnchor((event.currentTarget.firstElementChild || event.currentTarget).getBoundingClientRect())
  const hide = () => setAnchor(null)
  return (
    <span
      className={`item-hover-card${className ? ` ${className}` : ''}`}
      aria-describedby={anchor ? tooltipId : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {anchor && typeof document !== 'undefined' ? (
        <FloatingTooltip anchor={anchor} side={side} id={tooltipId}><TooltipBody item={item} /></FloatingTooltip>
      ) : null}
    </span>
  )
}

export function ItemDetailCard({ item, compact = false }) {
  if (!item) return null
  const type = itemType(item)
  const enchant = enchantLabel(item.enchant)
  const price = coinParts(item.sellPrice)
  const gemCount = Array.isArray(item.gemIds || item.gemItemIds) ? (item.gemIds || item.gemItemIds).filter(Boolean).length : 0
  const bonusCount = Array.isArray(item.bonusIds) ? item.bonusIds.filter(Boolean).length : 0
  const richLines = clientTooltipLines(item)
  const durabilityCurrent = Number(item?.durability?.current)
  const durabilityMax = Number(item?.durability?.max)
  const hasDurability = Number.isFinite(durabilityCurrent) && Number.isFinite(durabilityMax) && durabilityMax > 0

  return (
    <article className={`item-detail item-detail--quality-${Number(item.quality ?? item.qualityId) || 0}${compact ? ' item-detail--compact' : ''}`}>
      <div className="item-detail__eyebrow">Selected equipment</div>
      <div className="item-detail__topline">
        <ItemIcon item={item} size={compact ? 40 : 64} />
        <div>
          <strong className={`item-detail__name item-quality-${Number(item.quality ?? item.qualityId) || 0}`}>
            {item.name || `Item ${item.itemId || ''}`.trim() || 'Unknown item'}
          </strong>
          <span>{item.slot || 'Equipment'}</span>
          {item.itemLevel ? <b>Item Level {item.itemLevel}</b> : null}
        </div>
      </div>
      {richLines.length ? <ClientTooltip item={item} /> : (
        <>
          <StatLines item={item} />
          {item.description ? <p className="item-detail__description">{item.description}</p> : null}
        </>
      )}
      <dl>
        {item.requiredLevel ? <><dt>Requires</dt><dd>Level {item.requiredLevel}</dd></> : null}
        {type ? <><dt>Type</dt><dd>{type}</dd></> : null}
        {enchant ? <><dt>Enchant</dt><dd className="item-detail__positive">{enchant}</dd></> : null}
        {gemCount ? <><dt>Gems</dt><dd>{gemCount} socketed</dd></> : null}
        {bonusCount ? <><dt>Bonuses</dt><dd>{bonusCount} modifiers</dd></> : null}
        {hasDurability ? <><dt>Durability</dt><dd>{durabilityCurrent} / {durabilityMax}</dd></> : null}
        {item?.spell?.name ? <><dt>Effect</dt><dd className="item-detail__positive">{item.spell.name}</dd></> : null}
        {price.length ? <><dt>Sell</dt><dd>{price.join(' ')}</dd></> : null}
        {item.itemId ? <><dt>Item ID</dt><dd>{item.itemId}</dd></> : null}
      </dl>
    </article>
  )
}

export default WowIcon
