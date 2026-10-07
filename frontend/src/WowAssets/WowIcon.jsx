import { useEffect, useId, useState } from 'react'

import { wowAssetDescriptor } from './assetResolver.js'
import './WowIcon.css'

const qualityNames = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact', 'Heirloom']

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

function textureSlug(value) {
  const source = String(value || '').trim()
  if (!source) return ''
  const leaf = source.replaceAll('\\', '/').split('/').pop()?.replace(/\.(blp|tga|png|jpg)$/i, '') || ''
  const normalized = leaf.toLowerCase().replace(/[^a-z0-9_-]/g, '')
  return normalized.length >= 2 ? normalized : ''
}

function textureImageSource(value) {
  const slug = textureSlug(value)
  if (!slug) return ''
  return `https://render.worldofwarcraft.com/us/icons/56/${encodeURIComponent(slug)}.jpg`
}

function cleanWowText(value) {
  return String(value || '')
    .replace(/\|c[0-9a-f]{8}/gi, '')
    .replace(/\|r/gi, '')
    .replace(/\|T[^|]*\|t/gi, '')
    .replace(/\|H[^|]*\|h/gi, '')
    .replace(/\|h/gi, '')
    .trim()
}

function itemTypeLabel(item) {
  return cleanWowText(item?.itemSubclassName || item?.subclass || item?.itemClassName || item?.class || item?.slot || 'Equipment')
}

function enchantLabel(enchant) {
  if (!enchant) return ''
  if (typeof enchant === 'string' || typeof enchant === 'number') return String(enchant)
  if (Array.isArray(enchant)) return enchant.map(enchantLabel).filter(Boolean).join(' · ')
  return String(enchant.name || enchant.text || enchant.description || enchant.id || '')
}

function tooltipLines(item) {
  const name = cleanWowText(item?.name).toLowerCase()
  return (Array.isArray(item?.tooltipLines) ? item.tooltipLines : [])
    .map((line) => ({
      left: cleanWowText(typeof line === 'string' ? line : line?.left ?? line?.leftText ?? line?.text),
      right: cleanWowText(typeof line === 'object' ? line?.right ?? line?.rightText : ''),
    }))
    .filter((line) => (line.left || line.right) && line.left.toLowerCase() !== name)
    .slice(0, 24)
}

export function WowIcon({
  src = '',
  iconFileId,
  iconTexture = '',
  itemId,
  spellId,
  recipeId,
  label = '',
  size = 48,
  quality = null,
  className = '',
}) {
  const descriptor = wowAssetDescriptor({ iconFileId, itemId, spellId, recipeId, size })
  const imageSource = safeImageSource(src) || descriptor.src || textureImageSource(iconTexture)
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
      data-icon-texture={iconTexture || undefined}
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
      iconFileId={item?.iconFileId ?? item?.iconFileID}
      iconTexture={item?.iconTexture}
      itemId={item?.itemId ?? item?.itemID}
      label={item?.name || item?.slot}
      quality={item?.quality}
      size={size}
      className={className}
    />
  )
}

export function ItemTooltip({ item, id }) {
  if (!item) return null
  const quality = Number(item.quality) || 0
  const lines = tooltipLines(item)

  return (
    <div className="wow-item-tooltip" id={id} role="tooltip">
      <strong className={`wow-item-tooltip__name item-quality-${quality}`}>
        {cleanWowText(item.name) || `Item ${item.itemId || ''}`.trim() || 'Unknown item'}
      </strong>
      <div className="wow-item-tooltip__meta">
        {item.itemLevel ? <span>Item Level {item.itemLevel}</span> : null}
        <span>{itemTypeLabel(item)}</span>
      </div>
      {lines.length ? (
        <div className="wow-item-tooltip__lines">
          {lines.map((line, index) => (
            <div key={`${line.left}-${line.right}-${index}`}>
              <span>{line.left}</span>
              {line.right ? <span>{line.right}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {item.requiredLevel ? <div className="wow-item-tooltip__requirement">Requires level {item.requiredLevel}</div> : null}
      <small>Item {item.itemId || 'unknown'} · {qualityNames[quality] || 'Unknown quality'}</small>
    </div>
  )
}

export function ItemHoverTarget({ item, children, className = '' }) {
  const generatedId = useId()
  const tooltipId = `item-tooltip-${generatedId.replaceAll(':', '')}`
  return (
    <span className={`item-hover-target${className ? ` ${className}` : ''}`}>
      {typeof children === 'function' ? children(tooltipId) : children}
      <ItemTooltip item={item} id={tooltipId} />
    </span>
  )
}

export function ItemDetailCard({ item, compact = false }) {
  if (!item) return null
  const lines = tooltipLines(item)
  const quality = Number(item.quality) || 0
  const enchant = enchantLabel(item.enchant)

  return (
    <article className={`item-detail item-detail--quality-${quality}${compact ? ' item-detail--compact' : ''}`}>
      <div className="item-detail__topline">
        <ItemIcon item={item} size={compact ? 40 : 64} />
        <div>
          <small className="item-detail__eyebrow">Equipped item</small>
          <strong className={`item-detail__name item-quality-${quality}`}>
            {cleanWowText(item.name) || `Item ${item.itemId || ''}`.trim() || 'Unknown item'}
          </strong>
          <span>{itemTypeLabel(item)}</span>
        </div>
      </div>
      <dl>
        {item.itemLevel ? <><dt>Item level</dt><dd>{item.itemLevel}</dd></> : null}
        {item.requiredLevel ? <><dt>Requires level</dt><dd>{item.requiredLevel}</dd></> : null}
        {item.equipLocation ? <><dt>Equip slot</dt><dd>{cleanWowText(item.equipLocation).replace(/^INVTYPE_/, '').replaceAll('_', ' ')}</dd></> : null}
        {enchant ? <><dt>Enchant</dt><dd>{cleanWowText(enchant)}</dd></> : null}
        {item.itemId ? <><dt>Item ID</dt><dd>{item.itemId}</dd></> : null}
      </dl>
      {lines.length ? (
        <div className="item-detail__tooltip-lines">
          {lines.map((line, index) => (
            <div key={`${line.left}-${line.right}-${index}`}>
              <span>{line.left}</span>
              {line.right ? <span>{line.right}</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="item-detail__hint">More item stats will appear here as the in-game tooltip cache fills.</p>
      )}
    </article>
  )
}

export default WowIcon
