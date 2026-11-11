import { useState } from 'react'

import { Change, Coins, Freshness } from './MarketComponents.jsx'
import { formatAge, SOURCE_LABELS } from './marketFormat.js'

// The price levels of one item on one house, as the game's commodity list
// shows them: Unit Price, Available, Auctions, cheapest first. Clicking a
// level adds up everything up to it. Only what was observed: neither
// Blizzard's API nor the add-on reports sellers, so there is no seller column.
export function PriceList({ ladder, points = [], limit = 0 }) {
  const [upTo, setUpTo] = useState(-1)
  const levels = ladder?.levels?.length ? ladder.levels
    : points.map(([unitPrice, quantity, auctions]) => ({ unitPrice, quantity, auctions: auctions ?? null }))
  if (!levels.length) return <p className="ah-prices__note">No price levels were recorded for this item here (only a summary row was seen).</p>
  const shown = limit ? levels.slice(0, limit) : levels
  const max = Math.max(...shown.map((level) => level.quantity))
  const picked = upTo >= 0 ? shown.slice(0, upTo + 1) : []
  const quantity = picked.reduce((sum, level) => sum + level.quantity, 0)
  const cost = picked.reduce((sum, level) => sum + level.quantity * level.unitPrice, 0)
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
            <tr key={`${level.unitPrice}:${index}`} className={index <= upTo ? 'is-within' : ''} aria-selected={index === upTo}
              onClick={() => setUpTo(index === upTo ? -1 : index)} title="Click to add up every auction up to this price">
              <td><Coins value={level.unitPrice} compact /></td>
              <td>{level.quantity.toLocaleString('en-US')}</td>
              {hasAuctions ? <td>{level.auctions === null ? '—' : level.auctions.toLocaleString('en-US')}</td> : null}
              <td className="ah-prices__bar"><span style={{ width: `${Math.max(4, (level.quantity / max) * 100)}%` }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {picked.length ? (
        <p className="ah-prices__pick" role="status">
          Up to <Coins value={picked.at(-1).unitPrice} compact />: {quantity.toLocaleString('en-US')} for <Coins value={cost} compact /> (<Coins value={Math.round(cost / quantity)} compact /> each)
        </p>
      ) : null}
      <p className="ah-prices__note">
        {limit && levels.length > limit ? `Cheapest ${limit} of ${levels.length} price levels. ` : ''}
        {ladder?.truncated ? 'Only the cheapest levels were kept. ' : ''}
        {ladder ? `${SOURCE_LABELS[ladder.source] || 'Observed'} ${formatAge(ladder.ageSeconds)}${ladder.complete ? '' : ', partial scan'}. ` : ''}
        Sellers are not reported by Blizzard or the add-on.
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
