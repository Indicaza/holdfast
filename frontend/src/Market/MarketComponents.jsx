import { useState } from 'react'

import { ItemLabel } from '../Player/ui.jsx'
import { MarketCharts } from './MarketCharts.jsx'
import {
  SIGNAL_TONES,
  SOURCE_LABELS,
  auctionHref,
  coinParts,
  formatAge,
  formatAgeShort,
  formatChange,
  formatCoins,
  formatDateTime,
  postingSuggestion,
} from './marketFormat.js'
import { marketWrite, useMarketResource } from './useMarket.js'
import './Market.css'

export function Coins({ value, muted = false, compact = false }) {
  const parts = coinParts(value)
  if (!parts) return <span className="gw-coins gw-coins--none">—</span>
  // Compact: like the game's price column, zero-value leading coins dropped.
  return (
    <span className={`gw-coins${muted ? ' gw-coins--muted' : ''}${compact ? ' gw-coins--compact' : ''}`} aria-label={formatCoins(value)} title={formatCoins(value)}>
      {parts.negative ? <span aria-hidden="true">−</span> : null}
      {parts.gold ? <span className="gw-coin gw-coin--gold" aria-hidden="true">{parts.gold.toLocaleString('en-US')}</span> : null}
      {parts.gold || parts.silver ? <span className="gw-coin gw-coin--silver" aria-hidden="true">{String(parts.silver).padStart(parts.gold ? 2 : 1, '0')}</span> : null}
      <span className="gw-coin gw-coin--copper" aria-hidden="true">{String(parts.copper).padStart(parts.gold || parts.silver ? 2 : 1, '0')}</span>
    </span>
  )
}

// Where a price came from and how old it is. Stale and partial are said in
// words, not only colour.
export function Freshness({ price, showSource = true, short = false }) {
  if (!price) return <span className="gw-fresh gw-fresh--none">No data</span>
  if (price.variantsOnly) return <span className="gw-fresh" title={price.selectionReason}>{price.variants.length} versions</span>
  const age = short ? formatAgeShort(price.ageSeconds) : formatAge(price.ageSeconds)
  const label = `${showSource ? `${SOURCE_LABELS[price.source] || price.source} · ` : ''}${age}`
  const title = [`Seen ${formatAge(price.ageSeconds)} (${formatDateTime(price.observedAt)})`, price.unchangedSince && price.unchangedSince !== price.observedAt ? `unchanged since ${formatDateTime(price.unchangedSince)}` : null,
    SOURCE_LABELS[price.source], price.complete ? 'every listing seen' : 'partial view', `confidence ${price.confidence}`, price.selectionReason].filter(Boolean).join(' · ')
  return (
    <span className={`gw-fresh${price.stale ? ' gw-fresh--stale' : ''}${price.complete ? '' : ' gw-fresh--partial'}`} title={title}>
      {price.stale ? <span aria-hidden="true">⚠ </span> : null}{label}{price.stale ? ' · stale' : ''}{!price.complete && !short ? ' · partial' : ''}
    </span>
  )
}

export function Change({ pct }) {
  const change = formatChange(pct)
  if (!change) return <span className="gw-muted">—</span>
  return <span className={`gw-change gw-change--${change.direction}`}>{change.text}</span>
}

// The lowest ask as a share of the item's 14-day median, like the "Pct"
// column of the game's auction addons.
export function Pct({ value, days }) {
  if (value === null || value === undefined) return <span className="gw-muted" title="Needs three days of history">—</span>
  const tone = value <= 85 ? 'good' : value >= 130 ? 'bad' : 'flat'
  return <span className={`gw-pct gw-pct--${tone}`} title={`Lowest ask is ${value}% of the median of the last ${days} observed days`}>{value}%</span>
}

export function ConfidenceBadge({ confidence }) {
  const label = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' }[confidence] || 'Unknown confidence'
  return <span className={`gw-confb gw-confb--${confidence || 'low'}`}>{label}</span>
}

export function FavoriteButton({ itemId, favorite, onChange, size = 'sm' }) {
  const [busy, setBusy] = useState(false)
  async function toggle(event) {
    event.stopPropagation()
    setBusy(true)
    try {
      await marketWrite(`/api/market/favorites/${itemId}`, { method: favorite ? 'DELETE' : 'PUT' })
      onChange?.(!favorite)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" className={`gw-star gw-star--${size}${favorite ? ' is-on' : ''}`} onClick={toggle} disabled={busy}
      aria-pressed={favorite} aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'} title={favorite ? 'Favorited (F)' : 'Favorite (F)'}>
      {favorite ? '★' : '☆'}
    </button>
  )
}

// Adds an item to one of the player's shopping lists, inline.
export function AddToList({ itemId, defaultQuantity = 1, onAdded, label = '+ List', className = 'gw-btn gw-btn--sm' }) {
  const [open, setOpen] = useState(false)
  const lists = useMarketResource(open ? '/api/market/lists' : '')
  const [listId, setListId] = useState('')
  const [quantity, setQuantity] = useState(defaultQuantity)
  const [message, setMessage] = useState('')
  async function add(event) {
    event.preventDefault()
    let target = listId || lists.data?.lists?.[0]?.id
    if (!target) target = (await marketWrite('/api/market/lists', { method: 'POST', body: { name: 'Shopping list' } })).list.id
    await marketWrite(`/api/market/lists/${target}/items/${itemId}`, { body: { quantity: Number(quantity) || 1 } })
    setMessage('Added ✓')
    setOpen(false)
    onAdded?.()
  }
  if (!open) {
    return <button type="button" className={className} onClick={(event) => { event.stopPropagation(); setOpen(true); setMessage('') }} title="Add to a shopping list (A)">
      {message || label}
    </button>
  }
  return (
    <form className="gw-addlist" onSubmit={add} onClick={(event) => event.stopPropagation()}>
      <select aria-label="Shopping list" value={listId} onChange={(event) => setListId(event.target.value)}>
        {(lists.data?.lists || []).map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
        {!lists.data?.lists?.length ? <option value="">New list</option> : null}
      </select>
      <input aria-label="Quantity" type="number" min="1" max="100000" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
      <button type="submit" className="gw-btn gw-btn--sm gw-btn--primary">Add</button>
      <button type="button" className="gw-btn gw-btn--sm" onClick={() => setOpen(false)} aria-label="Cancel">×</button>
    </form>
  )
}

export function SignalChips({ signals = [], limit = 4 }) {
  if (!signals.length) return null
  return (
    <ul className="gw-signals" aria-label="Market observations">
      {signals.slice(0, limit).map((signal) => (
        <li key={signal.type} className={`gw-signal gw-signal--${SIGNAL_TONES[signal.type] || 'info'}`}
          title={`${signal.explanation} Based on ${signal.samples} observation${signal.samples === 1 ? '' : 's'}${signal.window?.from ? ` from ${formatDateTime(signal.window.from)}` : ''}; ${signal.confidence} confidence.`}>
          {signal.title}
        </li>
      ))}
    </ul>
  )
}

// The cheapest listings as the server last saw them: is the lowest ask a
// lone listing or a real price level?
export function PriceLadder({ points = [], stack = 1 }) {
  if (!points.length) return <p className="gw-muted gw-small">No listing detail for this observation (a browse row or summary only).</p>
  const max = Math.max(...points.map((point) => point[1]))
  return (
    <table className="gw-ladder">
      <thead><tr><th scope="col">Unit price</th><th scope="col" className="gw-col-num">Available</th><th scope="col" aria-label="Share" /></tr></thead>
      <tbody>{points.map(([unit, quantity]) => (
        <tr key={unit}>
          <td><Coins value={unit * (stack || 1)} compact /></td>
          <td className="gw-col-num">{quantity.toLocaleString('en-US')}</td>
          <td className="gw-ladder__bar"><span style={{ width: `${Math.max(4, (quantity / max) * 100)}%` }} /></td>
        </tr>
      ))}</tbody>
    </table>
  )
}

// Current price, recent median, change, supply and confidence in one strip.
export function MarketSummary({ summary, metrics }) {
  if (!summary) return null
  const median = metrics?.median7d?.value ?? null
  return (
    <dl className="gw-msum">
      <div><dt>Lowest ask</dt><dd><Coins value={summary.minUnitBuyout} /></dd>{summary.minQuantity ? <small>{summary.minQuantity.toLocaleString('en-US')} at this price</small> : null}</div>
      <div><dt>Typical ask</dt><dd><Coins value={summary.typicalUnitBuyout} /></dd></div>
      <div><dt>7-day median</dt><dd>{median === null ? <span className="gw-muted" title={metrics?.median7d?.reason}>not enough data</span> : <Coins value={median} />}</dd>
        {median !== null ? <small>{metrics.median7d.samples} hours observed</small> : null}</div>
      <div><dt>24 h</dt><dd><Change pct={metrics?.change24h?.pct ?? summary.change24hPct} /></dd>{metrics?.change24h?.reason ? <small title={metrics.change24h.reason}>no comparison</small> : null}</div>
      <div><dt>Listed</dt><dd>{summary.quantity.toLocaleString('en-US')}</dd><small>{summary.listings ? `${summary.listings} auctions` : 'auctions unknown'}{metrics?.supply?.changePct !== null && metrics?.supply?.changePct !== undefined ? ` · ${formatChange(metrics.supply.changePct).text} vs 7 d` : ''}</small></div>
      <div><dt>Data</dt><dd><ConfidenceBadge confidence={summary.confidence} /></dd><small><Freshness price={summary} /></small></div>
    </dl>
  )
}

// Why this price: the selection notes, conflicts included.
export function WhyThisPrice({ summary }) {
  if (!summary?.notes?.length) return null
  return (
    <ul className="gw-why">
      {summary.notes.map((note, index) => <li key={index} className={`gw-why--${note.code}`}>{note.text}</li>)}
    </ul>
  )
}

export function CraftingCosts({ itemId, marketKey }) {
  const crafting = useMarketResource(marketKey ? `/api/market/items/${itemId}/crafting?market=${encodeURIComponent(marketKey)}` : '')
  const recipes = crafting.data?.recipes || []
  if (!recipes.length) return null
  const names = crafting.data.items || {}
  return (
    <section className="gw-msec">
      <h3>Crafting cost</h3>
      {recipes.map((recipe) => (
        <div key={recipe.recipeId} className="gw-craft">
          <p><strong>{recipe.name}</strong>{recipe.professionName ? <span className="gw-muted"> · {recipe.professionName}</span> : null}</p>
          <table className="gw-table gw-table--dense">
            <tbody>
              {recipe.reagents.map((reagent) => (
                <tr key={reagent.itemId}>
                  <td>{reagent.quantity}× <ItemLabel item={names[reagent.itemId] || { itemId: reagent.itemId }} size={18} />{reagent.optional ? <span className="gw-muted"> (optional)</span> : null}</td>
                  <td className="gw-col-num">{reagent.cost === null ? <span className="gw-muted">no price</span> : <Coins value={reagent.cost} />}{reagent.stale ? <span className="gw-fresh--stale"> ⚠ stale</span> : null}</td>
                </tr>
              ))}
              <tr><th scope="row">Materials</th><td className="gw-col-num"><Coins value={recipe.materialCost} /></td></tr>
              <tr><th scope="row">Sells for (after {Math.round(recipe.auctionCut * 100)}% cut)</th><td className="gw-col-num"><Coins value={recipe.revenueAfterCut} /></td></tr>
              <tr><th scope="row">Margin</th><td className="gw-col-num">{recipe.margin === null ? <span className="gw-muted">unknown</span> : <><Coins value={recipe.margin} /> <span className="gw-muted">({recipe.marginPct}%)</span></>}</td></tr>
            </tbody>
          </table>
          <p className="gw-muted gw-small">{recipe.note}{recipe.missingPrices.length ? ` Missing prices: ${recipe.missingPrices.length}.` : ''}</p>
        </div>
      ))}
    </section>
  )
}

// Evidence: every source's recent observations of this variant.
export function Evidence({ evidence = [], basis }) {
  if (!evidence.length) return null
  return (
    <details className="gw-msec">
      <summary>Evidence ({evidence.length})</summary>
      <div className="gw-table-wrap">
        <table className="gw-table gw-table--dense">
          <thead><tr><th scope="col">Source</th><th scope="col">Seen</th><th scope="col" className="gw-col-num">Lowest</th><th scope="col" className="gw-col-num">Typical</th><th scope="col" className="gw-col-num">Listed</th></tr></thead>
          <tbody>{evidence.map((entry, index) => (
            <tr key={index}><td>{SOURCE_LABELS[entry.source]}{entry.complete ? '' : ' (partial)'}</td>
              <td title={entry.confirmedAt !== entry.observedAt ? `first seen ${formatDateTime(entry.observedAt)}` : undefined}>{formatDateTime(entry.confirmedAt)}</td>
              <td className="gw-col-num"><Coins value={entry.minUnitBuyout} /></td><td className="gw-col-num"><Coins value={entry.typicalUnitBuyout} /></td><td className="gw-col-num">{entry.quantity}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <p className="gw-small gw-muted">{basis}</p>
    </details>
  )
}

function variantQuery(itemKey) {
  return itemKey ? `&key=${encodeURIComponent(itemKey)}` : ''
}

// One item in one market: price and why, the cheapest listings,
// observations, history, crafting and evidence. Used by the Auction House
// and the item catalog.
export function ItemMarketPanel({ itemId, itemKey = '', marketKey: requestedMarket, showHistory = true, onFavoriteChange, range = '7d', onRange,
  onVariant, historyHref = null, stackPrices = false }) {
  const detail = useMarketResource(itemId ? `/api/market/items/${itemId}?market=${encodeURIComponent(requestedMarket || '')}${variantQuery(itemKey)}` : '')
  // Without a chosen market, the server picks one that has the item.
  const marketKey = requestedMarket || detail.data?.marketKey || ''
  const focusKey = detail.data?.itemKey || itemKey
  const analysis = useMarketResource(itemId && marketKey ? `/api/market/items/${itemId}/analysis?market=${encodeURIComponent(marketKey)}${variantQuery(focusKey)}` : '')
  const [localRange, setLocalRange] = useState(range)
  const chartRange = onRange ? range : localRange
  const history = useMarketResource(itemId && marketKey && showHistory ? `/api/market/items/${itemId}/history?market=${encodeURIComponent(marketKey)}&range=${chartRange}${variantQuery(focusKey)}` : '')
  const [favorite, setFavorite] = useState(null)
  if (detail.status === 'loading') return <div className="gw-mpanel" aria-busy="true"><div className="gw-skeleton"><div className="gw-skeleton__row" /><div className="gw-skeleton__row" /></div></div>
  if (detail.status === 'error') return <div className="gw-mpanel"><p className="gw-muted">Market data could not be loaded. <button type="button" className="gw-btn gw-btn--xs" onClick={detail.reload}>Retry</button></p></div>
  const data = detail.data
  if (!data) return null
  const isFavorite = favorite ?? data.favorite
  const here = data.variants.find((entry) => entry.itemKey === focusKey) || null
  const stack = stackPrices ? (data.item.stackCount || 1) : 1
  const suggestion = here ? postingSuggestion({ ...here, sellPrice: data.item.sellPrice }) : null
  return (
    <div className="gw-mpanel">
      <header className="gw-mpanel__head">
        <ItemLabel item={data.item} size={36} />
        <FavoriteButton itemId={data.item.itemId} favorite={isFavorite} size="md" onChange={(next) => { setFavorite(next); onFavoriteChange?.(next) }} />
      </header>
      <p className="gw-mpanel__facts">
        {[data.item.itemClass, data.item.itemSubclass, data.item.requiredLevel ? `Requires level ${data.item.requiredLevel}` : null,
          data.item.itemLevel ? `Item level ${data.item.itemLevel}` : null, data.item.stackCount > 1 ? `Stacks to ${data.item.stackCount}` : null].filter(Boolean).join(' · ')}
      </p>
      {data.variants.length > 1 ? (
        <label className="gw-mpanel__variant">
          <span>Version</span>
          <select value={focusKey} onChange={(event) => onVariant?.(event.target.value)} disabled={!onVariant} aria-label="Item version">
            {data.variants.map((entry) => <option key={entry.itemKey} value={entry.itemKey}>{entry.label} · {formatCoins(entry.minUnitBuyout)} · {entry.quantity} listed</option>)}
          </select>
        </label>
      ) : here?.variantName ? <p className="gw-small gw-muted">Version: {here.variantName}</p> : null}
      {here ? (
        <>
          <MarketSummary summary={here} metrics={analysis.data?.metrics} />
          <SignalChips signals={analysis.data?.signals} />
          {here.quantity === 0 ? <p className="gw-callout-inline">None listed at the last full check. The prices above are the last ones seen.</p> : null}
          <WhyThisPrice summary={here} />
        </>
      ) : <p className="gw-muted">No listings seen for this item in this market yet. Prices come from Blizzard's auction API and from players' in-game auction house searches; nothing is estimated.</p>}
      {here?.pricePoints?.length ? (
        <section className="gw-msec">
          <h3>Cheapest listings {stack > 1 ? <span className="gw-muted gw-small">per stack of {stack}</span> : null}</h3>
          <PriceLadder points={here.pricePoints} stack={stack} />
        </section>
      ) : null}
      {showHistory ? (
        <section className="gw-msec">
          <h3>Price and supply {historyHref ? <a className="gw-small" href={historyHref}>Open history</a> : null}</h3>
          <MarketCharts history={history.data} range={chartRange} onRange={onRange || setLocalRange} compact status={history.status} />
        </section>
      ) : null}
      {here && suggestion ? (
        <section className="gw-msec">
          <h3>Selling it</h3>
          <dl className="gw-mfacts">
            <div><dt>Vendor value</dt><dd>{data.item.sellPrice === null ? <span className="gw-muted">unknown</span> : <Coins value={data.item.sellPrice} />}</dd></div>
            <div><dt>Starting point</dt><dd><Coins value={suggestion.unitPrice} /></dd></div>
          </dl>
          {suggestion.belowVendor ? <p className="gw-small">The market is below vendor value: a vendor pays more.</p> : null}
        </section>
      ) : null}
      <CraftingCosts itemId={data.item.itemId} marketKey={marketKey} />
      <Evidence evidence={data.evidence} basis={data.basis} />
      {historyHref === null && marketKey ? <a className="gw-small" href={auctionHref({ tab: 'history', item: data.item.itemId, key: focusKey, market: marketKey })}>Full price history →</a> : null}
    </div>
  )
}

// A compact price cell for other pages (dungeon loot, wishlists).
export function MarketPriceCell({ price }) {
  if (!price) return <span className="gw-muted" title="No market data">—</span>
  if (price.variantsOnly) return <span className="gw-muted" title={price.selectionReason}>{price.variants.length} versions</span>
  return <span className="gw-price-cell"><Coins value={price.minUnitBuyout ?? price.typicalUnitBuyout} /><Freshness price={price} showSource={false} /></span>
}
