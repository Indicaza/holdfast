// Formatting, URL state and chart math for the Auction House. Pure: tested
// without a browser.

// The tabs along the bottom of the frame, as in the game's auction house.
export const AUCTION_TABS = Object.freeze([
  { id: 'browse', label: 'Browse', hint: 'Search the market', key: '1' },
  { id: 'appraiser', label: 'Appraiser', hint: 'What is it worth?', key: '2' },
  { id: 'shopping', label: 'Shopping', hint: 'Shopping lists', key: '3' },
  { id: 'favorites', label: 'Favorites', hint: 'Items you watch', key: '4' },
  { id: 'history', label: 'History', hint: 'Price and supply over time', key: '5' },
])
export const ADMIN_TAB = Object.freeze({ id: 'diagnostics', label: 'Diagnostics', hint: 'Market data health (administrators)', key: '6' })
// Links from before the redesign keep working.
const TAB_ALIASES = { buy: 'browse', sell: 'appraiser', lists: 'shopping' }

export const SORTS = Object.freeze(['name', 'price', 'typical', 'quantity', 'listings', 'age', 'change', 'ilvl', 'level', 'pct'])
export const RANGES = Object.freeze([
  { id: '24h', label: '24h' }, { id: '7d', label: '7d' }, { id: '30d', label: '30d' },
  { id: '90d', label: '90d' }, { id: '1y', label: '1y' }, { id: 'all', label: 'All' },
])
export const QUALITIES = Object.freeze([
  { id: '', label: 'All' }, { id: '0', label: 'Poor' }, { id: '1', label: 'Common' }, { id: '2', label: 'Uncommon' },
  { id: '3', label: 'Rare' }, { id: '4', label: 'Epic' }, { id: '5', label: 'Legendary' },
])

const STATE_KEYS = ['tab', 'market', 'q', 'category', 'sub', 'quality', 'minLevel', 'maxLevel', 'below', 'sort', 'dir', 'page', 'item', 'key', 'list', 'range', 'stack']
const DEFAULTS = { tab: 'browse', sort: 'name', dir: 'asc', page: 1, range: '7d', below: false, stack: false }

function level(value) {
  return /^\d{1,3}$/.test(String(value || '')) ? String(Math.min(100, Number(value))) : ''
}

export function readAuctionState(queryString = '') {
  const params = new URLSearchParams(queryString)
  const state = Object.fromEntries(STATE_KEYS.map((key) => [key, params.get(key) || '']))
  state.tab = TAB_ALIASES[state.tab] || state.tab
  state.tab = [...AUCTION_TABS, ADMIN_TAB].some((tab) => tab.id === state.tab) ? state.tab : 'browse'
  state.sort = SORTS.includes(state.sort) ? state.sort : 'name'
  state.dir = state.dir === 'desc' ? 'desc' : 'asc'
  state.page = Math.max(1, Math.trunc(Number(state.page)) || 1)
  state.item = /^\d+$/.test(state.item) ? Number(state.item) : null
  state.key = /^i:\d+(:[sb][\d.-]+)*$/.test(state.key) ? state.key : ''
  state.list = /^\d+$/.test(state.list) ? Number(state.list) : null
  state.range = RANGES.some((range) => range.id === state.range) ? state.range : '7d'
  state.quality = QUALITIES.some((quality) => quality.id === state.quality) ? state.quality : ''
  state.minLevel = level(state.minLevel)
  state.maxLevel = level(state.maxLevel)
  state.below = state.below === '1'
  state.stack = state.stack === '1'
  return state
}

// The page URL for a state; defaults are left out to keep links short.
export function auctionHref(state = {}, server = '') {
  const params = new URLSearchParams()
  if (server) params.set('server', server)
  for (const key of STATE_KEYS) {
    let value = state[key]
    if (key === 'tab') value = TAB_ALIASES[value] || value
    if (value === '' || value === null || value === undefined || DEFAULTS[key] === value) continue
    params.set(key, value === true ? '1' : String(value))
  }
  const query = params.toString()
  return `/dashboard/auctions${query ? `?${query}` : ''}`
}

// Is this a fresh visit (no search, filter or item in the URL)?
export function isBlankState(queryString = '') {
  const params = new URLSearchParams(queryString)
  return !STATE_KEYS.some((key) => key !== 'market' && params.has(key))
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

// Axis labels: the largest coin only ("12g", "4.5g", "80s", "35c").
export function formatCoinsShort(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return ''
  const v = Math.abs(Number(value))
  if (v >= 1e7) return `${Math.round(v / 1e7)}kg`
  if (v >= 10000) return `${v >= 1e5 ? Math.round(v / 10000) : Math.round(v / 1000) / 10}g`
  if (v >= 100) return `${Math.round(v / 100)}s`
  return `${Math.round(v)}c`
}

export function formatAge(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return 'never'
  const value = Math.max(0, Number(seconds))
  if (value < 90) return 'just now'
  if (value < 3600) return `${Math.round(value / 60)} min ago`
  if (value < 172800) return `${Math.round(value / 3600)} h ago`
  return `${Math.round(value / 86400)} days ago`
}

// "2h", "14m", "3d": compact age for table cells.
export function formatAgeShort(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return '—'
  const value = Math.max(0, Number(seconds))
  if (value < 60) return 'now'
  if (value < 3600) return `${Math.round(value / 60)}m`
  if (value < 172800) return `${Math.round(value / 3600)}h`
  return `${Math.round(value / 86400)}d`
}

export function formatDateTime(seconds, { withDate = true } = {}) {
  if (!Number.isFinite(Number(seconds))) return '—'
  const date = new Date(Number(seconds) * 1000)
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return withDate ? `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}` : time
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
const LAST_STATE_KEY = 'guildweaver:auctions:last'

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

// The last search and filters, restored when the Auction House is opened
// again from the menu.
export function storedAuctionQuery(storage = globalThis.localStorage) {
  try { return storage?.getItem(LAST_STATE_KEY) || '' } catch { return '' }
}

export function storeAuctionQuery(queryString, storage = globalThis.localStorage) {
  const params = new URLSearchParams(queryString)
  params.delete('server')
  try { storage?.setItem(LAST_STATE_KEY, params.toString()) } catch { /* a convenience */ }
}

// The market to show: the URL's, else the remembered one, else the freshest
// market with data.
export function resolveMarket(markets = [], requested = '', remembered = '') {
  const keys = new Set(markets.map((market) => market.marketKey))
  if (requested && keys.has(requested)) return requested
  if (remembered && keys.has(remembered)) return remembered
  const withData = [...markets].filter((market) => market.items > 0).sort((a, b) => (b.lastCheckedAt || b.lastSnapshotAt || 0) - (a.lastCheckedAt || a.lastSnapshotAt || 0))
  return withData[0]?.marketKey || markets[0]?.marketKey || ''
}

// Chart math ---------------------------------------------------------------------------

// Continuous runs of a measure: a run breaks where a value is missing or
// two observations are further apart than `gapSeconds`. Nothing is drawn
// across a gap.
export function chartSegments(points = [], key, gapSeconds = Infinity) {
  const segments = []
  let current = []
  let last = null
  for (const point of points) {
    const value = point[key]
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      if (current.length) segments.push(current)
      current = []
      last = null
      continue
    }
    if (last !== null && point.t - last > gapSeconds) {
      if (current.length) segments.push(current)
      current = []
    }
    current.push({ t: point.t, value: Number(value) })
    last = point.t
  }
  if (current.length) segments.push(current)
  return segments
}

// The gaps themselves, for shading: [from, to] pairs.
export function chartGaps(points = [], gapSeconds = Infinity) {
  const gaps = []
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].t - points[index - 1].t > gapSeconds) gaps.push([points[index - 1].t, points[index].t])
  }
  return gaps
}

// A trailing median of the typical ask over `windowSeconds`, computed only
// from observed points (a point needs three observations behind it).
export function rollingMedian(points = [], windowSeconds) {
  return points.map((point, index) => {
    const values = []
    for (let back = index; back >= 0 && point.t - points[back].t <= windowSeconds; back -= 1) {
      const value = points[back].typical ?? points[back].min
      if (value !== null && value !== undefined) values.push(value)
    }
    if (values.length < 3) return { t: point.t, median: null }
    values.sort((a, b) => a - b)
    const middle = Math.floor(values.length / 2)
    return { t: point.t, median: values.length % 2 ? values[middle] : Math.round((values[middle - 1] + values[middle]) / 2) }
  })
}

const TICK_STEPS = [3600, 3 * 3600, 6 * 3600, 12 * 3600, 86400, 2 * 86400, 3 * 86400, 7 * 86400, 14 * 86400, 30 * 86400, 91 * 86400, 182 * 86400, 365 * 86400]

// Time ticks aligned to whole hours or days, at most `max` of them.
export function timeTicks(from, to, max = 6) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return { step: 3600, ticks: [] }
  const step = TICK_STEPS.find((candidate) => (to - from) / candidate <= max) || TICK_STEPS.at(-1)
  const offset = step < 86400 ? new Date().getTimezoneOffset() * 60 : 0
  const ticks = []
  for (let tick = Math.ceil((from + offset) / step) * step - offset; tick <= to; tick += step) ticks.push(tick)
  return { step, ticks }
}

// "Nov 8" for a day label (YYYY-MM-DD, UTC), "Week of Nov 3" for a week.
export function formatDayLabel(label, resolution = 'day') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(label || ''))) return label || ''
  const text = new Date(`${label}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return resolution === 'week' ? `Week of ${text}` : text
}

export function formatTick(seconds, step) {
  const date = new Date(seconds * 1000)
  if (step < 86400) return date.toLocaleTimeString('en-US', { hour: 'numeric' })
  if (step < 182 * 86400) return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

// A round upper bound for an axis.
export function niceMax(value) {
  if (!Number.isFinite(value) || value <= 0) return 1
  const exponent = 10 ** Math.floor(Math.log10(value))
  const fraction = value / exponent
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
  return nice * exponent
}

// The plain-language headline for a chart, for screen readers and the
// summary line above it.
export function seriesSummary(points = [], key = 'typical') {
  const values = points.map((point) => point[key] ?? point.min).filter((value) => value !== null && value !== undefined)
  if (!values.length) return null
  const first = values[0]
  const last = values.at(-1)
  return { first, last, low: Math.min(...values), high: Math.max(...values), observations: values.length,
    changePct: first ? Math.round(((last - first) / first) * 1000) / 10 : null }
}

export const SIGNAL_TONES = Object.freeze({
  below_recent_market: 'good', isolated_low_listing: 'info', supply_increasing: 'info', supply_decreasing: 'info',
  price_spike: 'warn', volatile_market: 'warn',
})

// Categorical slots 1–3 of the validated dark palette, checked together
// against the panel colour (#101318): blue, orange, aqua. The rolling
// median is a neutral reference line, not a fourth hue.
export const CHART_COLORS = Object.freeze({ min: '#3987e5', typical: '#d95926', supply: '#199e70', median: '#a1a9b6' })

const BIND_LABELS = { 0: 'Not bound: tradeable', 1: 'Binds when picked up', 2: 'Binds when equipped', 3: 'Binds when used', 4: 'Quest item' }
export function bindLabel(bindType) {
  return BIND_LABELS[bindType] || 'Binding not known yet'
}
