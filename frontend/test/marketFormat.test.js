import assert from 'node:assert/strict'
import test from 'node:test'

import {
  auctionHref,
  formatAge,
  formatChange,
  formatCoins,
  historySeries,
  postingSuggestion,
  readAuctionState,
  readRecentSearches,
  rememberSearch,
  resolveMarket,
} from '../src/Market/marketFormat.js'

function memoryStorage() {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) }
}

test('auction state round-trips through the URL and drops defaults', () => {
  const href = auctionHref({ tab: 'buy', market: 'api:us:house-113', q: 'linen', sort: 'price', dir: 'desc', page: 2, item: 2589, range: '30d' }, 'us:normal')
  assert.equal(href, '/dashboard/auctions?server=us%3Anormal&market=api%3Aus%3Ahouse-113&q=linen&sort=price&dir=desc&page=2&item=2589')
  const state = readAuctionState(href.split('?')[1])
  assert.equal(state.tab, 'buy')
  assert.equal(state.item, 2589)
  assert.equal(state.page, 2)
  assert.equal(readAuctionState('tab=evil&sort=drop&page=-3').tab, 'buy')
  assert.equal(readAuctionState('sort=drop').sort, 'name')
  assert.equal(readAuctionState('page=-3').page, 1)
  assert.equal(auctionHref(), '/dashboard/auctions')
})

test('coins, ages and changes read like the game', () => {
  assert.equal(formatCoins(1234567), '123g 45s 67c')
  assert.equal(formatCoins(505), '5s 5c')
  assert.equal(formatCoins(-99), '−99c')
  assert.equal(formatCoins(null), '—', 'unknown is not zero')
  assert.equal(formatAge(30), 'just now')
  assert.equal(formatAge(7200), '2 h ago')
  assert.equal(formatAge(null), 'never')
  assert.deepEqual(formatChange(-12.34), { text: '−12.3%', direction: 'down' })
  assert.equal(formatChange(null), null)
})

test('posting suggestion undercuts by a copper but never below vendor value', () => {
  assert.deepEqual(postingSuggestion({ minUnitBuyout: 500, sellPrice: 100 }), { unitPrice: 499, belowVendor: false })
  assert.deepEqual(postingSuggestion({ minUnitBuyout: 50, sellPrice: 100 }), { unitPrice: 100, belowVendor: true })
  assert.equal(postingSuggestion({ minUnitBuyout: null, typicalUnitBuyout: null }), null)
})

test('market choice: URL, then remembered, then freshest with data', () => {
  const markets = [{ marketKey: 'a', items: 0, lastSnapshotAt: 9 }, { marketKey: 'b', items: 5, lastSnapshotAt: 5 }, { marketKey: 'c', items: 3, lastSnapshotAt: 8 }]
  assert.equal(resolveMarket(markets, 'b', 'c'), 'b')
  assert.equal(resolveMarket(markets, 'zzz', 'c'), 'c')
  assert.equal(resolveMarket(markets, '', ''), 'c')
  assert.equal(resolveMarket([], '', ''), '')
})

test('recent searches are bounded and deduplicated', () => {
  const storage = memoryStorage()
  for (let index = 0; index < 12; index += 1) rememberSearch(`item ${index}`, storage)
  rememberSearch('ITEM 11', storage)
  const recent = readRecentSearches(storage)
  assert.equal(recent.length, 8)
  assert.equal(recent[0], 'ITEM 11')
  assert.equal(recent.filter((entry) => entry.toLowerCase() === 'item 11').length, 1)
})

test('history uses one source so lines never mix API and scan prices', () => {
  const points = [
    { day: '2026-11-01', source: 'official_api', minUnitBuyout: 10, typicalUnitBuyout: 12, quantity: 5 },
    { day: '2026-11-02', source: 'official_api', minUnitBuyout: 11, typicalUnitBuyout: 12, quantity: 6 },
    { day: '2026-11-02', source: 'addon_scan', minUnitBuyout: 3, typicalUnitBuyout: 4, quantity: 1 },
  ]
  assert.deepEqual(historySeries(points).map((point) => point.min), [10, 11])
  assert.deepEqual(historySeries(points, 'addon_scan').map((point) => point.min), [3])
})
