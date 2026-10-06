import { useState } from 'react'

import { wowAssetDescriptor } from './assetResolver.js'
import './WowIcon.css'

function fallbackText(label, descriptor) {
  const source = String(label || '').trim()
  if (source) return source.slice(0, 2).toUpperCase()
  const id = descriptor.iconFileId || descriptor.itemId || descriptor.spellId || descriptor.recipeId
  return id ? String(id).slice(-2) : '✦'
}

export function WowIcon({
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
  const [failed, setFailed] = useState(false)
  const qualityClass = Number.isFinite(Number(quality)) ? ` wow-icon--quality-${Number(quality)}` : ''

  return (
    <span
      className={`wow-icon${qualityClass}${className ? ` ${className}` : ''}`}
      style={{ '--wow-icon-size': `${size}px` }}
      aria-hidden="true"
      data-icon-file-id={descriptor.iconFileId || undefined}
    >
      {descriptor.src && !failed ? (
        <img src={descriptor.src} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="wow-icon__fallback">{fallbackText(label, descriptor)}</span>
      )}
    </span>
  )
}

export function ItemIcon({ item, size = 48, className = '' }) {
  return (
    <WowIcon
      iconFileId={item?.iconFileId ?? item?.iconFileID}
      itemId={item?.itemId ?? item?.itemID}
      label={item?.name || item?.slot}
      quality={item?.quality}
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

export function ItemDetailCard({ item, compact = false }) {
  if (!item) return null

  return (
    <article className={`item-detail${compact ? ' item-detail--compact' : ''}`}>
      <div className="item-detail__topline">
        <ItemIcon item={item} size={compact ? 40 : 56} />
        <div>
          <strong className={`item-detail__name item-quality-${Number(item.quality) || 0}`}>
            {item.name || `Item ${item.itemId || ''}`.trim() || 'Unknown item'}
          </strong>
          <span>{item.slot || 'Equipment'}</span>
        </div>
      </div>
      <dl>
        {item.itemLevel ? <><dt>Item level</dt><dd>{item.itemLevel}</dd></> : null}
        {item.itemId ? <><dt>Item ID</dt><dd>{item.itemId}</dd></> : null}
        {enchantLabel(item.enchant) ? <><dt>Enchant</dt><dd>{enchantLabel(item.enchant)}</dd></> : null}
      </dl>
      {item.itemLink ? <code>{item.itemLink}</code> : null}
    </article>
  )
}

export default WowIcon
