import assert from 'node:assert/strict'
import test from 'node:test'

import {
  auctionHref,
  chartGaps,
  chartSegments,
  formatAge,
  formatChange,
  formatCoins,
  formatCoinsShort,
  isBlankState,
  niceMax,
  postingSuggestion,
  readAuctionState,
  readRecentSearches,
  rememberSearch,
  resolveMarket,
  rollingMedian,
  seriesSummary,
  storeAuctionQuery,
  storedAuctionQuery,
  timeTicks,
} from '../src/Market/marketFormat.js'

function memoryStorage() {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) }
}

test('auction state round-trips through the URL and drops defaults', () => {
  const href = auctionHref({ tab: 'browse', market: 'api:us:house-113', q: 'linen', quality: '2', minLevel: '10', below: true, sort: 'price', dir: 'desc', page: 2, item: 2589,
    key: 'i:2589', range: '7d', stack: false }, 'us:normal')
  assert.equal(href, '/dashboard/auctions?server=us%3Anormal&market=api%3Aus%3Ahouse-113&q=linen&quality=2&minLevel=10&below=1&sort=price&dir=desc&page=2&item=2589&key=i%3A2589')
  const state = readAuctionState(href.split('?')[1])
  assert.equal(state.tab, 'browse')
  assert.equal(state.item, 2589)
  assert.equal(state.page, 2)
  assert.equal(state.below, true)
  assert.equal(state.quality, '2')
  assert.equal(state.key, 'i:2589')
  assert.equal(readAuctionState('tab=evil&sort=drop&page=-3').tab, 'browse')
  assert.equal(readAuctionState('sort=drop').sort, '', 'an unknown sort lets the server choose (relevance or name)')
  assert.equal(readAuctionState('listed=1').listed, true)
  assert.equal(auctionHref({ tab: 'browse', listed: false, sort: '' }), '/dashboard/auctions', 'defaults stay out of the link')
  assert.equal(readAuctionState(`q=${'x'.repeat(300)}`).q.length, 100)
  assert.equal(readAuctionState('category=trade-goods&sub=metal-stone').sub, 'metal-stone')
  assert.equal(readAuctionState('page=-3').page, 1)
  assert.equal(readAuctionState('key=DROP TABLE').key, '', 'variant keys are validated')
  assert.equal(readAuctionState('minLevel=abc').minLevel, '')
  assert.equal(readAuctionState('quality=9').quality, '')
  assert.equal(readAuctionState('tab=sell').tab, 'sell')
  assert.equal(readAuctionState('tab=appraiser').tab, 'sell', 'old links keep working')
  assert.equal(readAuctionState('tab=favorites').tab, 'browse')
  assert.equal(readAuctionState('sel=i%3A2589%3As-1081').sel, 'i:2589:s-1081', 'the selected row is kept in the link')
  assert.equal(readAuctionState('sel=c%3A4319').sel, 'c:4319')
  assert.equal(readAuctionState('sel=x%3Abad').sel, '', 'selections are validated')
  assert.equal(readAuctionState('category=armor&sub=mail&slot=chest').slot, 'chest')
  assert.equal(readAuctionState('tab=lists').tab, 'shopping')
  assert.equal(auctionHref({ tab: 'buy' }), '/dashboard/auctions', 'the old default tab is the new default')
  assert.equal(auctionHref(), '/dashboard/auctions')
})

test('the last search is remembered and restored only for a blank visit', () => {
  const storage = memoryStorage()
  assert.equal(isBlankState(''), true)
  assert.equal(isBlankState('market=api%3Aus%3Ahouse-113'), true, 'a market alone is still a blank visit')
  assert.equal(isBlankState('q=linen'), false)
  storeAuctionQuery('server=us&q=linen&page=2', storage)
  assert.equal(storedAuctionQuery(storage), 'q=linen&page=2', 'the server is not remembered with the search')
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

test('chart lines break at gaps and missing values; nothing is drawn across them', () => {
  const points = [{ t: 0, min: 10 }, { t: 3600, min: 12 }, { t: 7200, min: null }, { t: 10800, min: 11 }, { t: 50000, min: 9 }]
  assert.deepEqual(chartSegments(points, 'min', 9000).map((segment) => segment.map((point) => point.t)), [[0, 3600], [10800], [50000]])
  assert.deepEqual(chartGaps(points, 9000), [[10800, 50000]])
  assert.deepEqual(chartSegments([], 'min', 1), [])
})

test('rolling median uses observed points only and needs three of them', () => {
  const points = [{ t: 0, typical: 100 }, { t: 1, typical: 300 }, { t: 2, typical: 200 }, { t: 100, typical: 50 }]
  assert.deepEqual(rollingMedian(points, 10).map((point) => point.median), [null, null, 200, null])
})

test('axes: time ticks on whole steps, round maxima, short coin labels', () => {
  const { step, ticks } = timeTicks(0, 7 * 86400, 7)
  assert.equal(step, 86400)
  assert.ok(ticks.length >= 6 && ticks.length <= 8)
  assert.deepEqual(timeTicks(10, 5).ticks, [])
  assert.equal(niceMax(173), 200)
  assert.equal(niceMax(0), 1)
  assert.equal(formatCoinsShort(123456), '12g')
  assert.equal(formatCoinsShort(45000), '4.5g')
  assert.equal(formatCoinsShort(850), '9s')
  assert.equal(formatCoinsShort(35), '35c')
  assert.equal(formatCoinsShort(null), '')
})

test('series summary describes the visible window', () => {
  assert.deepEqual(seriesSummary([{ typical: 100 }, { typical: null, min: 80 }, { typical: 150 }]), { first: 100, last: 150, low: 80, high: 150, observations: 3, changePct: 50 })
  assert.equal(seriesSummary([]), null)
})
