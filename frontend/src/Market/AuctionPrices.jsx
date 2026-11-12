import { useState } from 'react'

import { Change, Coins, Freshness } from './MarketComponents.jsx'
import { costToBuy } from './marketBrowse.js'
import { formatAge, SOURCE_LABELS } from './marketFormat.js'

// The price levels of one item on one house, as the game's commodity list
// shows them: Unit Price, Available, Auctions, cheapest first, and what
// buying a number of them would cost, level by level. Clicking a level
// fills in everything up to it. Only what was observed: neither Blizzard's
// API nor the add-on reports sellers, so there is no seller column.
export function PriceList({ ladder, points = [], limit = 0 }) {
  const [want, setWant] = useState('')
  const levels = ladder?.levels?.length ? ladder.levels
    : points.map(([unitPrice, quantity, auctions]) => ({ unitPrice, quantity, auctions: auctions ?? null }))
  if (!levels.length) return <p className="ah-prices__note">No price levels were recorded for this item here (only a summary row was seen).</p>
  const shown = limit ? levels.slice(0, limit) : levels
  const max = Math.max(...shown.map((level) => level.quantity))
  const total = levels.reduce((sum, level) => sum + level.quantity, 0)
  const buy = want ? costToBuy(levels, want) : null
  const hasAuctions = shown.some((level) => level.auctions !== null)
  return (
    <div className="ah-prices-wrap">
      <table className="ah-prices" aria-label="Price levels">
        <thead>
          <tr>
            <th scope="col"><span className="ah-head">Unit Price</span></th>
            <th scope="col"><span className="ah-head ah-head--num">Available</span></th>
            {hasAuctions ? <th scope="col"><span className="ah-head ah-head--num">Auctions</span></th> : null}
            <th scope="col" className="ah-prices__bar"><span className="ah-head"><span className="gw-sr">Share</span></span></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((level, index) => (
            <tr key={`${level.unitPrice}:${index}`} className={buy && index <= buy.upTo ? 'is-within' : ''} aria-selected={buy?.upTo === index}
              onClick={() => setWant(String(shown.slice(0, index + 1).reduce((sum, entry) => sum + entry.quantity, 0)))} title="Click to buy everything up to this price">
              <td><Coins value={level.unitPrice} compact /></td>
              <td>{level.quantity.toLocaleString('en-US')}</td>
              {hasAuctions ? <td>{level.auctions === null ? '—' : level.auctions.toLocaleString('en-US')}</td> : null}
              <td className="ah-prices__bar"><span style={{ width: `${Math.max(4, (level.quantity / max) * 100)}%` }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="ah-buycost" onSubmit={(event) => event.preventDefault()}>
        <label>Cost to buy
          <input type="number" min="1" max={total} inputMode="numeric" value={want} placeholder="quantity" aria-label="Quantity to buy"
            onChange={(event) => setWant(event.target.value.replace(/\D/g, '').slice(0, 9))} />
        </label>
        <span>of {total.toLocaleString('en-US')} listed</span>
        {buy?.quantity ? (
          <output role="status">
            {buy.quantity.toLocaleString('en-US')} for <Coins value={buy.cost} compact /> · <Coins value={buy.average} compact /> each on average, up to <Coins value={buy.highest} compact />
            {buy.short ? <small> · only {buy.quantity.toLocaleString('en-US')} listed</small> : null}
          </output>
        ) : null}
      </form>
      <p className="ah-prices__note">
        {limit && levels.length > limit ? `Cheapest ${limit} of ${levels.length} price levels. ` : ''}
        {ladder?.truncated ? 'Only the cheapest levels were kept; more is listed. ' : ''}
        {ladder ? `${SOURCE_LABELS[ladder.source] || 'Observed'} ${formatAge(ladder.ageSeconds)}${ladder.complete ? '' : ', partial scan'}. ` : ''}
        Auctions of items that are not stackable goods are bought whole, so the real cost can be higher. Sellers are not reported by Blizzard or the add-on.
      </p>
    </div>
  )
}

// The figures under an item's header: what is listed and what it costs.
export function ItemSummary({ summary, metrics }) {
  if (!summary) return null
  const median = metrics?.median7d?.value ?? null
  return (
    <dl className="ah-summary">
      <div><dt>Lowest buyout</dt><dd><Coins value={summary.minUnitBuyout} /></dd>{summary.minQuantity ? <small>{summary.minQuantity.toLocaleString('en-US')} at this price</small> : null}</div>
      <div><dt>Available</dt><dd>{summary.quantity.toLocaleString('en-US')}</dd><small>{summary.listings ? `${summary.listings.toLocaleString('en-US')} auctions` : 'auctions not reported'}</small></div>
      <div><dt>Typical buyout</dt><dd><Coins value={summary.typicalUnitBuyout} /></dd><small>middle of what is listed</small></div>
      <div><dt>7-day median</dt><dd>{median === null ? <span className="ah-faint" title={metrics?.median7d?.reason}>not enough data</span> : <Coins value={median} />}</dd>
        {median !== null ? <small>{metrics.median7d.samples} hours observed</small> : null}</div>
      <div><dt>24 hours</dt><dd><Change pct={metrics?.change24h?.pct ?? summary.change24hPct} /></dd>{metrics?.change24h?.reason ? <small title={metrics.change24h.reason}>no comparison yet</small> : null}</div>
      <div><dt>Seen</dt><dd><Freshness price={summary} /></dd></div>
    </dl>
  )
}
