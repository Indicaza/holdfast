import { useMemo, useRef, useState } from 'react'

import { ItemLabel } from '../Player/ui.jsx'
import {
  SOURCE_LABELS,
  auctionHref,
  coinParts,
  formatAge,
  formatChange,
  formatCoins,
  historySeries,
  postingSuggestion,
} from './marketFormat.js'
import { marketWrite, useMarketResource } from './useMarket.js'
import './Market.css'

// Chart colours: categorical slots 1 and 2 of the validated dark palette,
// checked against the panel colour (#101318) for colour-blind separation.
const LOWEST_COLOR = '#3987e5'
const TYPICAL_COLOR = '#d95926'

export function Coins({ value, muted = false }) {
  const parts = coinParts(value)
  if (!parts) return <span className="gw-coins gw-coins--none">—</span>
  return (
    <span className={`gw-coins${muted ? ' gw-coins--muted' : ''}`} aria-label={formatCoins(value)} title={formatCoins(value)}>
      {parts.negative ? <span aria-hidden="true">−</span> : null}
      {parts.gold ? <span className="gw-coin gw-coin--gold" aria-hidden="true">{parts.gold.toLocaleString('en-US')}<i>g</i></span> : null}
      {parts.gold || parts.silver ? <span className="gw-coin gw-coin--silver" aria-hidden="true">{parts.silver}<i>s</i></span> : null}
      <span className="gw-coin gw-coin--copper" aria-hidden="true">{parts.copper}<i>c</i></span>
    </span>
  )
}

export function Freshness({ price, showSource = true }) {
  if (!price) return <span className="gw-fresh gw-fresh--none">No data</span>
  const label = `${showSource ? `${SOURCE_LABELS[price.source] || price.source} · ` : ''}${formatAge(price.ageSeconds)}`
  const title = [label, price.complete ? 'every listing seen' : 'partial view', `confidence ${price.confidence}`, price.selectionReason].filter(Boolean).join(' · ')
  return (
    <span className={`gw-fresh${price.stale ? ' gw-fresh--stale' : ''}${price.complete ? '' : ' gw-fresh--partial'}`} title={title}>
      {price.stale ? <span aria-hidden="true">⚠ </span> : null}{label}{price.stale ? ' (stale)' : ''}
    </span>
  )
}

export function Change({ pct }) {
  const change = formatChange(pct)
  if (!change) return <span className="gw-muted">—</span>
  return <span className={`gw-change gw-change--${change.direction}`}>{change.text}</span>
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
      aria-pressed={favorite} aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'} title={favorite ? 'Favorited (f)' : 'Favorite (f)'}>
      {favorite ? '★' : '☆'}
    </button>
  )
}

// Adds an item to one of the player's shopping lists, inline.
export function AddToList({ itemId, defaultQuantity = 1, onAdded }) {
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
    setMessage('Added')
    setOpen(false)
    onAdded?.()
  }
  if (!open) {
    return <button type="button" className="gw-btn gw-btn--sm" onClick={(event) => { event.stopPropagation(); setOpen(true); setMessage('') }} title="Add to a shopping list (a)">
      {message || '+ List'}
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

function scale(domain, range) {
  const [d0, d1] = domain
  const [r0, r1] = range
  return (value) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((value - d0) / (d1 - d0)) * (r1 - r0))
}

// Asking-price history: lowest and typical ask as two lines on one copper
// axis, supply as its own small bar chart below (never a second axis).
// Hover or focus shows every value at that day; a table holds the same data.
export function PriceHistoryChart({ points = [], height = 200 }) {
  const series = useMemo(() => historySeries(points), [points])
  const [hover, setHover] = useState(null)
  const svgRef = useRef(null)
  if (series.length < 2) {
    return <p className="gw-muted gw-chart-empty">{series.length ? 'One day of history so far. The chart appears after a second day of data.' : 'No history yet for this market.'}</p>
  }
  const width = 640
  const pad = { top: 12, right: 64, bottom: 22, left: 56 }
  const values = series.flatMap((point) => [point.min, point.typical]).filter((value) => value !== null && value !== undefined)
  const maxValue = Math.max(...values) * 1.08
  const x = scale([0, series.length - 1], [pad.left, width - pad.right])
  const y = scale([0, maxValue], [height - pad.bottom, pad.top])
  const line = (key) => {
    let path = ''
    let open = false
    series.forEach((point, index) => {
      if (point[key] === null || point[key] === undefined) { open = false; return }
      path += `${open ? 'L' : 'M'}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`
      open = true
    })
    return path
  }
  const ticks = [0, 0.5, 1].map((fraction) => maxValue * fraction)
  const last = series.at(-1)
  // Direct labels at the line ends, pushed apart when the lines meet.
  const endLabels = [{ text: 'Typical', value: last.typical }, { text: 'Lowest', value: last.min }]
    .filter((label) => label.value !== null && label.value !== undefined).map((label) => ({ ...label, y: y(label.value) }))
    .sort((a, b) => a.y - b.y)
  if (endLabels.length === 2 && endLabels[1].y - endLabels[0].y < 13) {
    const middle = (endLabels[0].y + endLabels[1].y) / 2
    endLabels[0].y = middle - 6.5
    endLabels[1].y = middle + 6.5
  }
  const maxQuantity = Math.max(1, ...series.map((point) => point.quantity || 0))
  const supplyHeight = 64
  const barWidth = Math.max(2, (width - pad.left - pad.right) / series.length - 2)
  function pick(event) {
    const rect = svgRef.current.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * width
    const index = Math.round(((px - pad.left) / (width - pad.left - pad.right)) * (series.length - 1))
    setHover(Math.max(0, Math.min(series.length - 1, index)))
  }
  const active = hover === null ? null : series[hover]
  return (
    <figure className="gw-chart">
      <figcaption className="gw-chart__legend">
        <span><i style={{ background: LOWEST_COLOR }} />Lowest ask</span>
        <span><i style={{ background: TYPICAL_COLOR }} />Typical ask</span>
        <span className="gw-muted">Asking prices per unit, not sales</span>
      </figcaption>
      <div className="gw-chart__plot">
        <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Price history" tabIndex={0}
          onPointerMove={pick} onPointerLeave={() => setHover(null)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') setHover((value) => Math.min(series.length - 1, (value ?? -1) + 1))
            if (event.key === 'ArrowLeft') setHover((value) => Math.max(0, (value ?? series.length) - 1))
          }}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="gw-chart__grid" />
              <text x={pad.left - 6} y={y(tick) + 4} textAnchor="end" className="gw-chart__axis">{formatCoins(Math.round(tick)).replace(/ \d+c$/, '')}</text>
            </g>
          ))}
          <text x={pad.left} y={height - 6} className="gw-chart__axis">{series[0].day}</text>
          <text x={width - pad.right} y={height - 6} textAnchor="end" className="gw-chart__axis">{last.day}</text>
          <path d={line('typical')} stroke={TYPICAL_COLOR} strokeWidth="2" fill="none" />
          <path d={line('min')} stroke={LOWEST_COLOR} strokeWidth="2" fill="none" />
          {endLabels.map((label) => <text key={label.text} x={width - pad.right + 6} y={label.y + 4} className="gw-chart__label">{label.text}</text>)}
          {active ? (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={height - pad.bottom} className="gw-chart__cross" />
              {active.min !== null ? <circle cx={x(hover)} cy={y(active.min)} r="4" fill={LOWEST_COLOR} stroke="#101318" strokeWidth="2" /> : null}
              {active.typical !== null ? <circle cx={x(hover)} cy={y(active.typical)} r="4" fill={TYPICAL_COLOR} stroke="#101318" strokeWidth="2" /> : null}
            </g>
          ) : null}
        </svg>
        {active ? (
          <div className="gw-chart__tip" style={{ left: `${(x(hover) / width) * 100}%` }} role="status">
            <strong>{active.day}</strong>
            <span><i style={{ background: LOWEST_COLOR }} /><Coins value={active.min} /> lowest</span>
            <span><i style={{ background: TYPICAL_COLOR }} /><Coins value={active.typical} /> typical</span>
            <span>{(active.quantity || 0).toLocaleString('en-US')} listed</span>
          </div>
        ) : null}
      </div>
      <div className="gw-chart__supply">
        <span className="gw-muted">Quantity listed (highest seen that day)</span>
        <svg viewBox={`0 0 ${width} ${supplyHeight}`} role="img" aria-label="Quantity listed per day">
          {series.map((point, index) => {
            const h = ((point.quantity || 0) / maxQuantity) * (supplyHeight - 8)
            return <rect key={point.day} x={x(index) - barWidth / 2} y={supplyHeight - h} width={barWidth} height={Math.max(0, h)} rx="2"
              fill={LOWEST_COLOR} opacity={hover === index ? 1 : 0.55}><title>{`${point.day}: ${(point.quantity || 0).toLocaleString('en-US')} listed`}</title></rect>
          })}
        </svg>
      </div>
      <details className="gw-chart__table">
        <summary>Table</summary>
        <table className="gw-table">
          <thead><tr><th scope="col">Day</th><th scope="col" className="gw-col-num">Lowest</th><th scope="col" className="gw-col-num">Typical</th><th scope="col" className="gw-col-num">Listed</th></tr></thead>
          <tbody>{[...series].reverse().map((point) => (
            <tr key={point.day}><td>{point.day}</td><td className="gw-col-num"><Coins value={point.min} /></td><td className="gw-col-num"><Coins value={point.typical} /></td>
              <td className="gw-col-num">{(point.quantity || 0).toLocaleString('en-US')}</td></tr>
          ))}</tbody>
        </table>
      </details>
    </figure>
  )
}

const BIND_LABELS = { 0: 'Not bound: tradeable', 1: 'Binds when picked up', 2: 'Binds when equipped', 3: 'Binds when used', 4: 'Quest item' }

function CraftingCosts({ itemId, marketKey }) {
  const crafting = useMarketResource(marketKey ? `/api/market/items/${itemId}/crafting?market=${encodeURIComponent(marketKey)}` : '')
  const recipes = crafting.data?.recipes || []
  if (!recipes.length) return null
  const names = crafting.data.items || {}
  return (
    <section className="gw-market-section">
      <h3>Crafting cost</h3>
      {recipes.map((recipe) => (
        <div key={recipe.recipeId} className="gw-craft">
          <p><strong>{recipe.name}</strong>{recipe.professionName ? <span className="gw-muted"> · {recipe.professionName}</span> : null}</p>
          <table className="gw-table gw-table--dense">
            <tbody>
              {recipe.reagents.map((reagent) => (
                <tr key={reagent.itemId}>
                  <td>{reagent.quantity}× <ItemLabel item={names[reagent.itemId] || { itemId: reagent.itemId }} size={18} />{reagent.optional ? <span className="gw-muted"> (optional)</span> : null}</td>
                  <td className="gw-col-num">{reagent.cost === null ? <span className="gw-muted">no price</span> : <Coins value={reagent.cost} />}{reagent.stale ? <span className="gw-fresh--stale"> ⚠</span> : null}</td>
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

// One item in one market: the shown price and why, every source's latest
// evidence, vendor value, binding, crafting cost and history. Used by the
// Auction House, the item catalog and anywhere else an item is priced.
export function ItemMarketPanel({ itemId, marketKey: requestedMarket, mode = 'buy', showHistory = true, onFavoriteChange, range = '30d' }) {
  const detail = useMarketResource(itemId ? `/api/market/items/${itemId}?market=${encodeURIComponent(requestedMarket || '')}` : '')
  // Without a chosen market, the server picks one that has the item.
  const marketKey = requestedMarket || detail.data?.marketKey || ''
  const history = useMarketResource(itemId && marketKey && showHistory ? `/api/market/items/${itemId}/history?market=${encodeURIComponent(marketKey)}&range=${range}` : '')
  const [favorite, setFavorite] = useState(null)
  if (detail.status === 'loading') return <div className="gw-market-panel" aria-busy="true"><p className="gw-muted">Loading market data…</p></div>
  if (detail.status === 'error') return <div className="gw-market-panel"><p className="gw-muted">Market data could not be loaded.</p></div>
  const data = detail.data
  if (!data) return null
  const isFavorite = favorite ?? data.favorite
  const here = data.markets.find((entry) => entry.marketKey === marketKey && !entry.variant) || data.markets.find((entry) => entry.marketKey === marketKey) || null
  const variants = data.markets.filter((entry) => entry.marketKey === marketKey && entry.variant)
  const suggestion = here ? postingSuggestion({ ...here, sellPrice: data.item.sellPrice }) : null
  return (
    <div className="gw-market-panel">
      <header className="gw-market-panel__head">
        <ItemLabel item={data.item} size={36} />
        <FavoriteButton itemId={data.item.itemId} favorite={isFavorite} size="md" onChange={(next) => { setFavorite(next); onFavoriteChange?.(next) }} />
        <AddToList itemId={data.item.itemId} />
      </header>
      {here ? (
        <>
          <p className="gw-small gw-muted">{data.markets.find((entry) => entry.marketKey === marketKey)?.marketName}</p>
          <dl className="gw-market-facts">
            <div><dt>Lowest ask</dt><dd><Coins value={here.minUnitBuyout} /></dd></div>
            <div><dt>Typical ask</dt><dd><Coins value={here.typicalUnitBuyout} /></dd></div>
            <div><dt>Listed</dt><dd>{here.quantity.toLocaleString('en-US')}{here.listings ? <span className="gw-muted"> in {here.listings} auctions</span> : null}</dd></div>
            <div><dt>24 h</dt><dd><Change pct={here.change24hPct} /></dd></div>
          </dl>
          <p className="gw-small"><Freshness price={here} /> · confidence {here.confidence}</p>
          <p className="gw-small gw-muted">Why this price: {here.selectionReason}.{here.conflict ? ' Sources disagree; see the evidence below.' : ''}</p>
        </>
      ) : <p className="gw-muted">No listings seen for this item in this market yet.</p>}
      {mode === 'sell' ? (
        <section className="gw-market-section">
          <h3>Selling it</h3>
          <dl className="gw-market-facts">
            <div><dt>Vendor value</dt><dd>{data.item.sellPrice === null ? <span className="gw-muted">unknown</span> : <Coins value={data.item.sellPrice} />}</dd></div>
            <div><dt>Starting point</dt><dd>{suggestion ? <Coins value={suggestion.unitPrice} /> : <span className="gw-muted">no market price</span>}</dd></div>
            <div><dt>Range</dt><dd>{here ? <><Coins value={here.minUnitBuyout} /> – <Coins value={data.evidence.find((entry) => entry.maxUnitBuyout)?.maxUnitBuyout ?? null} /></> : '—'}</dd></div>
            <div><dt>Stack size</dt><dd>{data.item.stackCount ?? '—'}</dd></div>
          </dl>
          <p className="gw-small gw-muted">
            {suggestion?.belowVendor ? 'The market is below vendor value: selling to a vendor pays more. ' : ''}
            The auction house keeps 5% of a sale (15% at Blackwater houses), and a deposit is lost if the auction expires. Post from the game; this website cannot post, buy or cancel auctions.
          </p>
          <p className="gw-small">{BIND_LABELS[data.item.bindType] || 'Binding not known yet'}</p>
        </section>
      ) : null}
      {variants.length ? (
        <section className="gw-market-section">
          <h3>Other versions</h3>
          <ul className="gw-plain">{variants.map((entry) => <li key={entry.itemKey}><code>{entry.variant}</code> · <Coins value={entry.minUnitBuyout} /> · {entry.quantity} listed</li>)}</ul>
        </section>
      ) : null}
      {showHistory ? (
        <section className="gw-market-section">
          <h3>Price history <a className="gw-small" href={auctionHref({ tab: 'history', item: data.item.itemId, market: marketKey })}>open</a></h3>
          <PriceHistoryChart points={history.data?.points || []} height={160} />
        </section>
      ) : null}
      <CraftingCosts itemId={data.item.itemId} marketKey={marketKey} />
      {data.evidence.length ? (
        <details className="gw-market-section">
          <summary>Evidence ({data.evidence.length})</summary>
          <table className="gw-table gw-table--dense">
            <thead><tr><th scope="col">Source</th><th scope="col">Seen</th><th scope="col" className="gw-col-num">Lowest</th><th scope="col" className="gw-col-num">Listed</th></tr></thead>
            <tbody>{data.evidence.map((entry, index) => (
              <tr key={index}><td>{SOURCE_LABELS[entry.source]}{entry.complete ? '' : ' (partial)'}</td><td>{new Date(entry.observedAt * 1000).toLocaleString()}</td>
                <td className="gw-col-num"><Coins value={entry.minUnitBuyout} /></td><td className="gw-col-num">{entry.quantity}</td></tr>
            ))}</tbody>
          </table>
          <p className="gw-small gw-muted">{data.basis}</p>
        </details>
      ) : null}
    </div>
  )
}

// A compact price cell for other pages (dungeon loot, wishlists).
export function MarketPriceCell({ price }) {
  if (!price) return <span className="gw-muted" title="No market data">—</span>
  return <span className="gw-price-cell"><Coins value={price.minUnitBuyout ?? price.typicalUnitBuyout} /><Freshness price={price} showSource={false} /></span>
}
