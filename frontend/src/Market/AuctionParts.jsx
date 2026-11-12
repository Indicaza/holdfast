import { useState } from 'react'

import { GameTooltipHover } from '../Intelligence/GameTooltip.jsx'
import { WowIcon } from '../WowAssets/WowIcon.jsx'
import { tooltipItem } from './marketBrowse.js'
import { marketWrite } from './useMarket.js'

// An item as the auction house lists it: the icon in its quality border and
// the name in its quality color, one hover area for both (no flicker between
// them), with the game's tooltip. Keyboard focus shows the same tooltip.
export function AuctionItem({ item, size = 28, variantName = '', showName = true, className = '', tooltip = true }) {
  if (!item) return null
  const quality = Number.isFinite(Number(item.qualityId)) ? Number(item.qualityId) : 1
  const name = variantName || item.name || `Item ${item.itemId}`
  const label = (
    <span className={`ah-item ah-item--q${quality}${className ? ` ${className}` : ''}`} tabIndex={tooltip ? 0 : -1} style={{ '--ah-icon': `${size}px` }}>
      <span className="ah-item__icon" aria-hidden="true">
        <WowIcon src={item.mediaUrl} iconFileId={item.iconFileDataId} itemId={item.itemId} label={name} quality={quality} size={size} />
      </span>
      {showName ? <span className="ah-item__name">{name}</span> : null}
    </span>
  )
  return tooltip ? <GameTooltipHover item={tooltipItem(item, { variantName })}>{label}</GameTooltipHover> : label
}

// The favorite star of a row or an item window (auctionhouse-icon-favorite).
export function FavoriteStar({ itemId, favorite, onChange }) {
  const [busy, setBusy] = useState(false)
  return (
    <button type="button" className={`ah-star${favorite ? ' is-on' : ''}`} disabled={busy} aria-pressed={favorite}
      aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'} title={favorite ? 'Favorite (F)' : 'Add to favorites (F)'}
      onClick={async (event) => {
        event.stopPropagation()
        setBusy(true)
        try { await marketWrite(`/api/market/favorites/${itemId}`, { method: favorite ? 'DELETE' : 'PUT' }); onChange?.() } finally { setBusy(false) }
      }} />
  )
}
