import { useState } from 'react'

import { GameTooltipHover } from '../Intelligence/GameTooltip.jsx'
import { WowIcon } from '../WowAssets/WowIcon.jsx'
import { Coins } from './MarketComponents.jsx'
import { tooltipItem } from './marketBrowse.js'
import { marketWrite, useSuggestions } from './useMarket.js'

// An item as the auction house lists it: the icon in its quality border and
// the name in its quality color, one hover area for both (no flicker between
// them), with the game's tooltip. Focus shows the same tooltip.
export function AuctionItem({ item, size = 28, variantName = '', showName = true, className = '' }) {
  if (!item) return null
  const quality = Number.isFinite(Number(item.qualityId)) ? Number(item.qualityId) : 1
  const name = variantName || item.name || `Item ${item.itemId}`
  return (
    <GameTooltipHover item={tooltipItem({ ...item, name })}>
      <span className={`ah-item ah-item--q${quality}${className ? ` ${className}` : ''}`} tabIndex={-1} style={{ '--ah-icon': `${size}px` }}>
        <span className="ah-item__icon" aria-hidden="true">
          <WowIcon src={item.mediaUrl} iconFileId={item.iconFileDataId} itemId={item.itemId} label={name} quality={quality} size={size} />
        </span>
        {showName ? <span className="ah-item__name">{name}</span> : null}
      </span>
    </GameTooltipHover>
  )
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

// Pick an item: suggestions from the catalog as you type.
export function ItemPicker({ id, label, marketKey, onPick, placeholder = 'Item name or ID' }) {
  const [value, setValue] = useState('')
  const [active, setActive] = useState(-1)
  const suggestions = useSuggestions(value, marketKey)
  const pick = (entry) => { setValue(''); setActive(-1); onPick(entry) }
  return (
    <div className="ah-picker">
      <label htmlFor={id}>{label}</label>
      <div className="ah-search__box">
        <input id={id} type="search" value={value} placeholder={placeholder} autoComplete="off" maxLength={100} role="combobox"
          aria-expanded={suggestions.length > 0} aria-controls={`${id}-suggest`} aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
          onChange={(event) => { setValue(event.target.value); setActive(-1) }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(suggestions.length - 1, index + 1)) }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(-1, index - 1)) }
            else if (event.key === 'Enter' && suggestions.length) { event.preventDefault(); pick(suggestions[Math.max(0, active)]) }
            else if (event.key === 'Escape') setValue('')
          }} />
        {value && suggestions.length ? (
          <ul id={`${id}-suggest`} className="ah-suggest" role="listbox" aria-label="Items">
            {suggestions.map((entry, index) => (
              <li key={entry.itemId} id={`${id}-opt-${index}`} role="option" aria-selected={index === active} className={index === active ? 'is-active' : ''}
                onMouseDown={(event) => { event.preventDefault(); pick(entry) }}>
                <AuctionItem item={entry} size={20} />
                <span className="ah-suggest__meta">{entry.priced ? <Coins value={entry.minUnitBuyout} compact /> : entry.listed ? 'listed' : 'none here'}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
