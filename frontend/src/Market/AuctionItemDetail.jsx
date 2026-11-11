import { AuctionItem, FavoriteStar } from './AuctionParts.jsx'
import { ItemSummary, PriceList } from './AuctionPrices.jsx'
import { AddToList, ListingState } from './MarketComponents.jsx'
import { formatDateTime } from './marketFormat.js'

// auctionhouse-itemheaderframe: the big icon and name (its tooltip on
// hover), the favorite star and "add to a shopping list".
export function ItemHeader({ item, variantName = '', favorite, onFavoritesChange, size = 52 }) {
  return (
    <div className="ah-item-header">
      <AuctionItem item={variantName ? { ...item, name: variantName } : item} size={size} />
      <span className="ah-spacer" />
      <AddToList itemId={item.itemId} className="ah-button ah-button--small" label="Add to list" />
      <FavoriteStar itemId={item.itemId} favorite={favorite} onChange={onFavoritesChange} />
    </div>
  )
}

// What this house has of the item: the figures, its versions, every price
// level. From one useItemMarket() result.
export function ItemPrices({ market, marketName, onOpenVariant, limit = 0 }) {
  const { detail, analysis, focusKey, here } = market
  const data = detail.data
  if (!data) return null
  const item = data.item
  return (
    <>
      {here && here.quantity > 0 ? <ItemSummary summary={here} metrics={analysis.data?.metrics} /> : (
        <p className="ah-unlisted">
          <ListingState listing={data.listing} observedAt={data.listingObservedAt} note={data.coverage?.note} ageSeconds={data.listingAgeSeconds} />{' '}
          {data.listing === 'none_listed' ? `None listed on ${marketName} at the last complete check${data.listingObservedAt ? ` (${formatDateTime(data.listingObservedAt)})` : ''}.`
            : `Not seen on ${marketName} yet. ${data.coverage?.note || ''} Nothing is estimated.`}
        </p>
      )}
      {data.variants.length > 1 ? (
        <div className="ah-versions">
          <span>Versions here</span>
          <ul>{data.variants.map((entry) => (
            <li key={entry.itemKey}>
              <button type="button" className={entry.itemKey === focusKey ? 'is-active' : ''}
                onClick={() => onOpenVariant?.({ itemId: item.itemId, itemKey: entry.itemKey === `i:${item.itemId}` ? '' : entry.itemKey, name: entry.variantName || item.name, qualityId: item.qualityId })}>
                {entry.label}<small>{entry.quantity.toLocaleString('en-US')} listed</small>
              </button>
            </li>
          ))}</ul>
        </div>
      ) : null}
      {here && here.quantity > 0 ? <PriceList ladder={data.ladder} points={here.pricePoints || []} limit={limit} /> : null}
    </>
  )
}
