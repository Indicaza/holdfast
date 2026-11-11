import './AuctionHouse.css'

import { useMemo } from 'react'

import { Panel } from '../Player/ui.jsx'
import { AuctionItem } from './AuctionParts.jsx'
import { Change, Coins, Freshness, ListingState } from './MarketComponents.jsx'
import { factionForServer } from './marketBrowse.js'
import { auctionHref } from './marketFormat.js'
import { useMarketResource, useMarkets } from './useMarket.js'

const SHOWN = 8

// The dashboard's Auction House card: the player's favorite items only,
// priced on the house they use. Nothing else from the Auction House.
export default function FavoriteAuctions({ server = '', characters = [] }) {
  const faction = useMemo(() => factionForServer(characters, server), [characters, server])
  const { status, marketKey, market } = useMarkets('', server, faction)
  const favorites = useMarketResource(marketKey ? `/api/market/favorites?market=${encodeURIComponent(marketKey)}` : '')
  const rows = favorites.data?.favorites || []
  const open = auctionHref({ market: marketKey }, server)
  if (status === 'error' || (status === 'ready' && !marketKey)) return null
  return (
    <Panel id="gw-ah-favorites" title="Auction House favorites" className="ah-home"
      description={market ? `Prices on ${market.name}.` : undefined}
      actions={<a className="gw-btn gw-btn--sm" href={open}>Open the Auction House</a>}>
      {favorites.status === 'loading' || status === 'loading' ? <p className="ah-home__note">Loading…</p> : null}
      {favorites.status === 'error' ? <p className="ah-home__note">Your favorites could not be loaded.</p> : null}
      {favorites.status === 'ready' && !rows.length ? (
        <p className="ah-home__note">No favorites yet. In the <a href={open}>Auction House</a>, click the star next to an item to follow its price here.</p>
      ) : null}
      {rows.length ? (
        <ul className="ah-home__list">
          {rows.slice(0, SHOWN).map((entry) => {
            const price = entry.price && !entry.price.variantsOnly ? entry.price : null
            const listed = Boolean(price && price.quantity > 0)
            return (
              <li key={entry.item.itemId}>
                <AuctionItem item={entry.item} size={28} />
                <span className="ah-home__price">
                  {listed ? <Coins value={price.minUnitBuyout} compact />
                    : entry.price?.variantsOnly ? <span className="gw-listing">{entry.price.variants.length} versions</span>
                      : <ListingState listing={price ? 'none_listed' : 'unknown'} observedAt={price?.observedAt} ageSeconds={price?.ageSeconds} />}
                </span>
                <span className="ah-home__change">{listed ? <Change pct={entry.metrics?.change24h?.pct ?? price.change24hPct} /> : null}</span>
                <span className="ah-home__seen">{price ? <Freshness price={price} showSource={false} short /> : null}</span>
                <a className="ah-home__open" href={auctionHref({ market: marketKey, item: entry.item.itemId }, server)} aria-label={`Open ${entry.item.name} in the Auction House`}>Open ›</a>
              </li>
            )
          })}
        </ul>
      ) : null}
      {rows.length > SHOWN ? <p className="ah-home__note"><a href={open}>All {rows.length} favorites ›</a></p> : null}
    </Panel>
  )
}
