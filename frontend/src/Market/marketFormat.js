// Formatting and URL state for the Auction House. Pure: tested without a
// browser.

export const AUCTION_TABS = Object.freeze([
  { id: 'buy', label: 'Buy', hint: 'Search the market' },
  { id: 'sell', label: 'Sell', hint: 'What is it worth?' },
  { id: 'lists', label: 'Shopping lists', hint: 'Plan purchases' },
  { id: 'favorites', label: 'Favorites', hint: 'Items you watch' },
  { id: 'history', label: 'History', hint: 'Price over time' },
])

export const SORTS = Object.freeze(['name', 'price', 'typical', 'quantity', 'age', 'change'])
const STATE_KEYS = ['tab', 'market', 'q', 'category', 'sort', 'dir', 'page', 'item', 'list', 'range']

export function readAuctionState(queryString = '') {
  const params = new URLSearchParams(queryString)
  const state = Object.fromEntries(STATE_KEYS.map((key) => [key, params.get(key) || '']))
  state.tab = AUCTION_TABS.some((tab) => tab.id === state.tab) ? state.tab : 'buy'
  state.sort = SORTS.includes(state.sort) ? state.sort : 'name'
  state.dir = state.dir === 'desc' ? 'desc' : 'asc'
  state.page = Math.max(1, Math.trunc(Number(state.page)) || 1)
  state.item = /^\d+$/.test(state.item) ? Number(state.item) : null
  state.list = /^\d+$/.test(state.list) ? Number(state.list) : null
  state.range = ['7d', '30d', '90d', '1y', '2y'].includes(state.range) ? state.range : '30d'
  return state
}

// The page URL for a state; defaults are left out to keep links short.
export function auctionHref(state = {}, server = '') {
  const params = new URLSearchParams()
  if (server) params.set('server', server)
  const defaults = { tab: 'buy', sort: 'name', dir: 'asc', page: 1, range: '30d' }
  for (const key of STATE_KEYS) {
    const value = state[key]
    if (value === '' || value === null || value === undefined || defaults[key] === value) continue
    params.set(key, String(value))
  }
  const query = params.toString()
  return `/dashboard/auctions${query ? `?${query}` : ''}`
}

// Copper → { gold, silver, copper } parts, for coin-coloured display.
export function coinParts(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null
  const total = Math.abs(Math.trunc(Number(value)))
  return { negative: Number(value) < 0, gold: Math.floor(total / 10000), silver: Math.floor(total / 100) % 100, copper: total % 100 }
}

export function formatCoins(value) {
  const parts = coinParts(value)
  if (!parts) return '—'
  const out = []
  if (parts.gold) out.push(`${parts.gold.toLocaleString('en-US')}g`)
  if (parts.gold || parts.silver) out.push(`${parts.silver}s`)
  out.push(`${parts.copper}c`)
  return `${parts.negative ? '−' : ''}${out.join(' ')}`
}

export function formatAge(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return 'never'
  const value = Math.max(0, Number(seconds))
  if (value < 90) return 'just now'
  if (value < 3600) return `${Math.round(value / 60)} min ago`
  if (value < 172800) return `${Math.round(value / 3600)} h ago`
  return `${Math.round(value / 86400)} days ago`
}

export const SOURCE_LABELS = Object.freeze({ addon_scan: 'In-game scan', official_api: 'Blizzard API', provider: 'Data provider' })

export function formatChange(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(Number(pct))) return null
  const value = Number(pct)
  return { text: `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}%`, direction: value > 0 ? 'up' : value < 0 ? 'down' : 'flat' }
}

// The price a list or valuation uses: the lowest ask, else the typical one.
export function unitAsk(price) {
  if (!price) return null
  return price.minUnitBuyout ?? price.typicalUnitBuyout ?? null
}

// A starting point for posting: one copper under the lowest ask, never
// under the vendor price. A suggestion, not advice: the website cannot post.
export function postingSuggestion({ minUnitBuyout, typicalUnitBuyout, sellPrice }) {
  const ask = minUnitBuyout ?? typicalUnitBuyout
  if (!ask) return null
  const undercut = Math.max(1, ask - 1)
  const floor = Number.isFinite(sellPrice) ? sellPrice : 0
  return { unitPrice: Math.max(undercut, floor), belowVendor: floor > 0 && undercut < floor }
}

export function marketLabel(market) {
  if (!market) return 'No market'
  return market.name || market.marketKey
}

const RECENT_KEY = 'guildweaver:auctions:recent'
const MARKET_KEY = 'guildweaver:auctions:market'

export function readRecentSearches(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(RECENT_KEY) || '[]')
    return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string').slice(0, 8) : []
  } catch {
    return []
  }
}

export function rememberSearch(q, storage = globalThis.localStorage) {
  const value = String(q || '').trim().slice(0, 100)
  if (!value) return readRecentSearches(storage)
  const next = [value, ...readRecentSearches(storage).filter((entry) => entry.toLowerCase() !== value.toLowerCase())].slice(0, 8)
  try { storage?.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* a convenience */ }
  return next
}

export function storedMarket(storage = globalThis.localStorage) {
  try { return storage?.getItem(MARKET_KEY) || '' } catch { return '' }
}

export function storeMarket(marketKey, storage = globalThis.localStorage) {
  try { storage?.setItem(MARKET_KEY, marketKey || '') } catch { /* a convenience */ }
}

// The market to show: the URL's, else the remembered one, else the freshest
// market with data.
export function resolveMarket(markets = [], requested = '', remembered = '') {
  const keys = new Set(markets.map((market) => market.marketKey))
  if (requested && keys.has(requested)) return requested
  if (remembered && keys.has(remembered)) return remembered
  const withData = [...markets].filter((market) => market.items > 0).sort((a, b) => (b.lastSnapshotAt || 0) - (a.lastSnapshotAt || 0))
  return withData[0]?.marketKey || markets[0]?.marketKey || ''
}

// Chart data: a daily series per measure, gaps kept as gaps.
export function historySeries(points = [], source = null) {
  const chosen = source || preferredHistorySource(points)
  return points.filter((point) => point.source === chosen).map((point) => ({
    day: point.day, min: point.minUnitBuyout, typical: point.typicalUnitBuyout, quantity: point.quantity,
  }))
}

export function preferredHistorySource(points = []) {
  const counts = new Map()
  for (const point of points) counts.set(point.source, (counts.get(point.source) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
}
