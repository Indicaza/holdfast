// Sorting, auction houses per server, item tooltips and the floating item
// windows' geometry. Pure: tested without a browser.
import { bindLabel } from './marketFormat.js'

// Clicking a header: a new column starts in its natural direction (cheapest
// first, most available first), the active one flips.
export function nextSort(state, column) {
  if (state.sort === column.id) return { sort: column.id, dir: state.dir === 'asc' ? 'desc' : 'asc' }
  return { sort: column.id, dir: column.firstDir || 'asc' }
}

// One table row: a market listing (one per variant) or a catalog match
// without listings here.
export function rowId(row) {
  return row.itemKey || `c:${row.item.itemId}`
}

// Category tree state kept for the browser session: which categories are
// open survives searches, tab switches and leaving the Auction House.
const TREE_KEY = 'guildweaver:auctions:tree'

export function readOpenCategories(storage = globalThis.sessionStorage) {
  try {
    const value = JSON.parse(storage?.getItem(TREE_KEY) || '[]')
    return Array.isArray(value) ? value.filter((key) => typeof key === 'string').slice(0, 40) : []
  } catch {
    return []
  }
}

export function storeOpenCategories(keys, storage = globalThis.sessionStorage) {
  try { storage?.setItem(TREE_KEY, JSON.stringify([...keys].slice(0, 40))) } catch { /* a convenience */ }
}

// Auction houses per server ---------------------------------------------------------

const FACTION_LABELS = { alliance: 'Alliance', horde: 'Horde', neutral: 'Blackwater' }

// A race's faction, as fixed by the game.
const RACE_FACTION = { human: 'alliance', dwarf: 'alliance', nightelf: 'alliance', gnome: 'alliance', draenei: 'alliance',
  orc: 'horde', undead: 'horde', scourge: 'horde', tauren: 'horde', troll: 'horde', bloodelf: 'horde' }

// The faction of the player's most recently seen character on a server
// (characters come most recent first), for the house to open on.
export function factionForServer(characters = [], server = '') {
  for (const character of characters) {
    const key = `${String(character.region || '').toLowerCase()}:${String(character.realm || '').toLowerCase()}`
    if (server && key !== server) continue
    const faction = RACE_FACTION[String(character.race || '').toLowerCase().replace(/[\s_-]+/g, '')]
    if (faction) return faction
  }
  return ''
}

// The dashboard's server key ("us:normal") of an in-game auction house.
export function marketServer(market) {
  return market?.kind === 'client_house' && market.realm ? `${String(market.region || '').toLowerCase()}:${market.realm.toLowerCase()}` : ''
}

function count(market) {
  return `${(market.items || 0).toLocaleString('en-US')} listed`
}

// The houses to offer: with a server chosen, that server's Alliance, Horde
// and Blackwater houses, then Blizzard's houses linked to it or not yet
// matched to any server. Without one (or with no data from it), every house.
export function marketChoices(markets = [], server = '', faction = '') {
  const game = markets.filter((market) => market.kind === 'client_house')
  const api = markets.filter((market) => market.kind === 'api_house')
  const serversOf = new Map(api.map((house) => [house.marketKey, new Set(game.filter((market) => market.linkedMarketKey === house.marketKey).map(marketServer))]))
  const byServer = new Map()
  for (const market of game) {
    const key = marketServer(market)
    if (!byServer.has(key)) byServer.set(key, { label: market.realm, markets: [] })
    byServer.get(key).markets.push({ ...market, label: `${market.realm} · ${FACTION_LABELS[market.faction] || market.faction} · ${count(market)}` })
  }
  // The player's faction first, then Alliance, Horde, Blackwater.
  const rank = (market) => (market.faction === faction ? -1 : Object.keys(FACTION_LABELS).indexOf(market.faction))
  const order = (list) => list.sort((a, b) => rank(a) - rank(b))
  const otherServers = Boolean(server) && !byServer.has(server) && markets.length > 0
  const servers = server && byServer.has(server) ? [byServer.get(server)] : [...byServer.values()].sort((a, b) => a.label.localeCompare(b.label))
  const houses = api.filter((house) => !server || otherServers || !serversOf.get(house.marketKey).size || serversOf.get(house.marketKey).has(server))
    .map((house) => ({ ...house, label: `${house.name} · ${count(house)}` }))
  const groups = [...servers.map((entry) => ({ label: entry.label, markets: order(entry.markets) })),
    ...(houses.length ? [{ label: 'Blizzard auction houses', markets: houses }] : [])]
  return { groups, keys: groups.flatMap((group) => group.markets.map((market) => market.marketKey)), otherServers }
}

// Inspectors ------------------------------------------------------------------------

export const INSPECTOR_SIZE = Object.freeze({ width: 400, height: 540, minWidth: 300, minHeight: 200, margin: 8, title: 34, cascade: 30 })
const INSPECTORS_KEY = 'guildweaver:auctions:inspectors'
export const MAX_INSPECTORS = 8

// One window per item variant: the variant key, else the base item.
export function inspectorId({ itemId, itemKey }) {
  return itemKey || `i:${itemId}`
}

// Inside the viewport, never larger than it. A collapsed window only needs
// its title bar to fit.
export function clampWindow(win, viewport) {
  const { margin, minWidth, minHeight, title } = INSPECTOR_SIZE
  const maxWidth = Math.max(minWidth, viewport.width - margin * 2)
  const maxHeight = Math.max(minHeight, viewport.height - margin * 2)
  const width = Math.round(Math.min(maxWidth, Math.max(minWidth, Number(win.width) || INSPECTOR_SIZE.width)))
  const height = Math.round(Math.min(maxHeight, Math.max(minHeight, Number(win.height) || INSPECTOR_SIZE.height)))
  const shownHeight = win.collapsed ? title : height
  const x = Math.round(Math.min(Math.max(margin, Number(win.x) || margin), Math.max(margin, viewport.width - width - margin)))
  const y = Math.round(Math.min(Math.max(margin, Number(win.y) || margin), Math.max(margin, viewport.height - shownHeight - margin)))
  return { ...win, x, y, width, height }
}

// Where a new window opens: cascaded from the right edge, below the
// Auction House's top bar, so the search and the table stay visible.
export function cascadePosition(index, viewport, size = INSPECTOR_SIZE) {
  const step = size.cascade
  const top = 140
  const rows = Math.max(1, Math.floor((viewport.height - size.height - top) / step))
  return clampWindow({ x: viewport.width - size.width - 24 - (Math.floor(index / rows) % 4) * step * 3 - (index % rows) * step,
    y: top + (index % rows) * step, width: size.width, height: size.height }, viewport)
}

function topZ(windows) {
  return windows.reduce((max, win) => Math.max(max, win.z || 0), 0)
}

// Opening an item already open focuses its window: raised and expanded,
// never a second copy. The oldest unpinned window gives way past the limit.
export function openInspector(windows, item, viewport) {
  const id = inspectorId(item)
  const existing = windows.find((win) => win.id === id)
  if (existing) {
    const opened = windows.map((win) => (win.id === id ? { ...win, collapsed: false, ...(item.tab ? { tab: item.tab } : {}) } : win))
    return { windows: raiseInspector(opened, id), id, existed: true }
  }
  let next = windows
  if (next.length >= MAX_INSPECTORS) {
    const oldest = [...next].filter((win) => !win.pinned).sort((a, b) => (a.z || 0) - (b.z || 0))[0]
    if (oldest) next = next.filter((win) => win.id !== oldest.id)
  }
  const placed = cascadePosition(next.length, viewport)
  const win = { id, itemId: Number(item.itemId), itemKey: item.itemKey || '', name: item.name || '', qualityId: item.qualityId ?? null,
    ...placed, z: topZ(next) + 1, collapsed: false, pinned: false, tab: item.tab || 'overview' }
  return { windows: [...next, win], id, existed: false }
}

export function raiseInspector(windows, id) {
  const target = windows.find((win) => win.id === id)
  if (!target) return windows
  const top = topZ(windows)
  if (target.z === top && windows.filter((win) => win.z === top).length === 1) return windows
  return windows.map((win) => (win.id === id ? { ...win, z: top + 1 } : win))
}

export function updateInspector(windows, id, patch, viewport) {
  return windows.map((win) => (win.id === id ? clampWindow({ ...win, ...patch }, viewport) : win))
}

export function closeInspector(windows, id) {
  return windows.filter((win) => win.id !== id)
}

// Every window back to its cascade position and default size.
export function resetInspectors(windows, viewport) {
  return [...windows].sort((a, b) => (a.z || 0) - (b.z || 0)).map((win, index) => ({ ...win, ...cascadePosition(index, viewport), collapsed: false }))
}

// Stacking: pinned windows always above unpinned ones, then by z.
export function stackOrder(windows) {
  return [...windows].sort((a, b) => Number(a.pinned) - Number(b.pinned) || (a.z || 0) - (b.z || 0)).map((win) => win.id)
}

export function readInspectors(viewport, storage = globalThis.sessionStorage) {
  try {
    const value = JSON.parse(storage?.getItem(INSPECTORS_KEY) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter((win) => Number.isSafeInteger(win?.itemId) && win.itemId > 0 && typeof win.id === 'string')
      .slice(0, MAX_INSPECTORS)
      .map((win) => clampWindow({ id: win.id, itemId: win.itemId, itemKey: typeof win.itemKey === 'string' ? win.itemKey : '', name: String(win.name || '').slice(0, 120),
        qualityId: Number.isFinite(win.qualityId) ? win.qualityId : null, x: win.x, y: win.y, width: win.width, height: win.height, z: Number(win.z) || 1,
        collapsed: win.collapsed === true, pinned: win.pinned === true, tab: typeof win.tab === 'string' ? win.tab : 'overview' }, viewport))
  } catch {
    return []
  }
}

export function storeInspectors(windows, storage = globalThis.sessionStorage) {
  try { storage?.setItem(INSPECTORS_KEY, JSON.stringify(windows)) } catch { /* a convenience */ }
}

// Item tooltips -------------------------------------------------------------------

export const QUALITY_NAMES = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact', 'Heirloom']

// The tooltip lines for an item: what the game showed (or Blizzard's item
// API described), else the few facts the website knows, said to be
// incomplete. Never made up.
export function tooltipItem(item) {
  if (!item) return null
  if (Array.isArray(item.tooltipLines) && item.tooltipLines.length) return { ...item, tooltipLines: item.tooltipLines }
  const quality = Number.isFinite(Number(item.qualityId)) ? Number(item.qualityId) : null
  const lines = [{ left: item.name || `Item ${item.itemId}` }]
  if (item.bindType !== null && item.bindType !== undefined && item.bindType !== 0) lines.push({ left: bindLabel(item.bindType) })
  if (item.itemClass || item.itemSubclass) lines.push({ left: item.itemClass || '', right: item.itemSubclass || '' })
  if (item.itemLevel) lines.push({ left: `Item Level ${item.itemLevel}` })
  if (item.requiredLevel) lines.push({ left: `Requires Level ${item.requiredLevel}` })
  if (quality === null && lines.length === 1) lines.push({ left: `Item ${item.itemId}`, leftColor: { r: 0.6, g: 0.6, b: 0.6 } })
  lines.push({ left: 'No player\'s game has shown this item\'s full tooltip yet.', leftColor: { r: 0.5, g: 0.5, b: 0.5 } })
  return { ...item, qualityId: quality ?? item.qualityId, tooltipLines: lines }
}

export function qualityName(qualityId) {
  return QUALITY_NAMES[Number(qualityId)] || ''
}

// The item's facts in one line: rarity, levels, binding, kind.
export function itemFacts(item) {
  return [qualityName(item.qualityId), item.itemLevel ? `Item Level ${item.itemLevel}` : null, item.requiredLevel ? `Requires Level ${item.requiredLevel}` : null,
    item.bindType !== null && item.bindType !== undefined && item.bindType !== 0 ? bindLabel(item.bindType) : null,
    [item.itemClass, item.itemSubclass].filter(Boolean).join(' · ') || null].filter(Boolean).join(' · ')
}
