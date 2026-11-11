import { ItemHeader, ItemPrices } from './AuctionItemDetail.jsx'
import { ItemPicker } from './AuctionParts.jsx'
import { goAuction } from './auctionNavigation.js'
import { Coins } from './MarketComponents.jsx'
import { itemFacts } from './marketBrowse.js'
import { postingSuggestion } from './marketFormat.js'
import { useItemMarket } from './useMarket.js'

// A starting price, from what is listed now: one copper under the lowest
// buyout, never under what a vendor pays. Posting happens in the game.
function PostingHint({ here, item }) {
  const suggestion = here && here.quantity > 0 ? postingSuggestion({ ...here, sellPrice: item.sellPrice }) : null
  return (
    <dl className="ah-summary ah-sell__hint">
      <div><dt>Undercut price</dt><dd>{suggestion ? <Coins value={suggestion.unitPrice} /> : <span className="ah-faint">nothing listed to undercut</span>}</dd>
        {suggestion?.belowVendor ? <small>raised to the vendor price</small> : <small>one copper under the lowest buyout</small>}</div>
      <div><dt>Vendor price</dt><dd>{Number.isFinite(item.sellPrice) ? <Coins value={item.sellPrice} /> : <span className="ah-faint">not known</span>}</dd><small>each</small></div>
    </dl>
  )
}

function SellItem({ itemId, itemKey, marketKey, marketName, favorite, onFavoritesChange, onOpenVariant, onInspect }) {
  const market = useItemMarket({ itemId, itemKey, marketKey })
  const { detail, here } = market
  if (detail.status === 'loading') return <div className="ah-loading" aria-label="Loading">Loading</div>
  if (detail.status === 'error' || detail.status === 'missing') return <div className="ah-empty">This item could not be loaded. <button type="button" className="ah-button" onClick={detail.reload}>Retry</button></div>
  if (!detail.data) return null
  const item = detail.data.item
  return (
    <>
      <ItemHeader item={item} variantName={here?.variantName || ''} favorite={favorite} onFavoritesChange={onFavoritesChange} size={64} />
      <p className="ah-facts">{itemFacts(item)}</p>
      <PostingHint here={here} item={item} />
      <ItemPrices market={market} marketName={marketName} onOpenVariant={onOpenVariant} />
      <p className="ah-sell__more">
        <button type="button" className="ah-band-button" onClick={() => onInspect({ itemId, itemKey, name: item.name, qualityId: item.qualityId, tab: 'history' })}>Price history ›</button>
      </p>
    </>
  )
}

// The Sell tab: choose an item, see what the house has of it and a price to
// start from. The website cannot post auctions; that happens in the game.
export default function AuctionSell({ state, server, active, marketKey, marketName, favorites, onFavoritesChange, onInspect }) {
  const choose = (entry) => goAuction({ ...state, tab: 'sell', item: entry.itemId, key: entry.itemKey || '' }, server)
  return (
    <div className="ah-pane ah-sell" hidden={!active}>
      <section className="ah-pane__left" aria-label="Item to sell">
        <ItemPicker id="ah-sell-item" label="Item to sell" marketKey={marketKey} onPick={choose} />
        <p className="ah-pane__note">Pick an item to see every price it is listed at on {marketName || 'this auction house'} and a price to start from.
          Posting happens in the game.</p>
      </section>
      <section className="ah-pane__right" aria-label="Item prices">
        {state.item ? (
          <SellItem itemId={state.item} itemKey={state.key} marketKey={marketKey} marketName={marketName} favorite={favorites.has(state.item)}
            onFavoritesChange={onFavoritesChange} onOpenVariant={choose} onInspect={onInspect} />
        ) : <div className="ah-empty">No item chosen.<p>Type an item's name on the left.</p></div>}
      </section>
    </div>
  )
}
