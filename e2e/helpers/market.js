// Uploads auction_scan events the way Guildweaver Bridge does, for the
// signed-in player: pair a computer, then post each scan with its key.
// Scans are pages of the classic browse frame with item names, as the
// add-on sends them. Runs in the page so it uses the page's session.
export function syncAuctionScans(page, { deviceName = 'AH PC', realm = 'Normal', faction = 'alliance', scans = [] } = {}) {
  return page.evaluate(async ({ deviceName, realm, faction, scans }) => {
    const headers = { 'Content-Type': 'application/json', 'X-Guildweaver-Release': 'forever-live' }
    async function json(url, options = {}) {
      const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(`${url}: ${response.status} ${JSON.stringify(body)}`)
      return body
    }
    const pairing = await json('/api/bridge/pairing/start', { method: 'POST', body: JSON.stringify({ deviceName }) })
    await json('/api/bridge/pairing/approve', { method: 'POST', body: JSON.stringify({ userCode: pairing.userCode }) })
    const device = await json('/api/bridge/pairing/token', { method: 'POST', body: JSON.stringify({ deviceCode: pairing.deviceCode }) })
    const now = Math.floor(Date.now() / 1000)
    for (const [index, scan] of scans.entries()) {
      const scanId = `e2e-ah-${deviceName.replace(/\W/g, '')}-${index}`
      const observedAt = now - scan.ago
      await json('/api/bridge/telemetry', {
        method: 'POST',
        headers: { Authorization: `Bearer ${device.deviceToken}`, 'Idempotency-Key': `e2e-${scanId}` },
        body: JSON.stringify({
          streamKey: `auction_scan:e2e-char:${scanId}`,
          kind: 'event',
          revision: 1,
          envelope: {
            schemaVersion: 1, eventType: 'auction_scan', capturedAt: observedAt, characterId: 'e2e-char', realm, region: 'US',
            installationId: `e2e-${deviceName}`, gameBuild: { version: '1.60.1', build: '70790', interface: 16001 },
            addon: { name: 'Guildweaver', version: '0.6.0' }, payloadSchemaVersion: 1,
            payload: { schemaVersion: 1, scanId, observedAt, market: { faction, basis: 'player_faction' }, query: { kind: 'page', chunk: 1, chunks: 1 },
              coverage: 'items', items: scan.items },
          },
        }),
      })
    }
    return scans.length
  }, { deviceName, realm, faction, scans })
}

// Uploads item descriptions the way the add-on does (game_item_definition:
// a base item id rendered in the game's tooltip), so the website's item
// catalog knows them whether or not anyone has listed them.
export function syncItemDefinitions(page, { deviceName = 'Catalog PC', items = [] } = {}) {
  return page.evaluate(async ({ deviceName, items }) => {
    const headers = { 'Content-Type': 'application/json', 'X-Guildweaver-Release': 'forever-live' }
    async function json(url, options = {}) {
      const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(`${url}: ${response.status} ${JSON.stringify(body)}`)
      return body
    }
    const pairing = await json('/api/bridge/pairing/start', { method: 'POST', body: JSON.stringify({ deviceName }) })
    await json('/api/bridge/pairing/approve', { method: 'POST', body: JSON.stringify({ userCode: pairing.userCode }) })
    const device = await json('/api/bridge/pairing/token', { method: 'POST', body: JSON.stringify({ deviceCode: pairing.deviceCode }) })
    const capturedAt = Math.floor(Date.now() / 1000) - 60
    for (const item of items) {
      await json('/api/bridge/telemetry', {
        method: 'POST',
        headers: { Authorization: `Bearer ${device.deviceToken}`, 'Idempotency-Key': `e2e-item-${deviceName.replace(/\W/g, '')}-${item.itemId}` },
        body: JSON.stringify({
          streamKey: `game_item_definition:${item.itemId}`,
          kind: 'state',
          revision: 1,
          envelope: {
            schemaVersion: 1, eventType: 'game_item_definition', capturedAt, characterId: 'e2e-char', realm: 'Normal', region: 'US', locale: 'enUS',
            installationId: `e2e-${deviceName}`, gameBuild: { version: '1.60.1', build: '70790', interface: 16001 },
            addon: { name: 'Guildweaver', version: '0.6.0' }, payloadSchemaVersion: 1,
            payload: { schemaVersion: 1, basis: 'base_item_id', reference: `item:${item.itemId}`, item: {
              itemId: item.itemId, name: item.name, qualityId: item.qualityId, itemClass: item.itemClass, itemSubclass: item.itemSubclass,
              requiredLevel: item.requiredLevel ?? 0, itemLevel: item.itemLevel, bindType: item.bindType ?? 0, stackCount: item.stackCount ?? 1,
              tooltip: { source: 'GameTooltip', method: 'SetHyperlink', complete: true, rendered: true, lines: item.lines || [{ left: item.name }] },
            } },
          },
        }),
      })
    }
    return items.length
  }, { deviceName, items })
}

const tradeGoods = (id, name) => ({ id: 7, name: 'Trade Goods', sub: [id, name] })
function definition(itemId, name, qualityId, { id, name: className, sub }, extra = {}) {
  return { itemId, name, qualityId, itemClass: { id, name: className }, itemSubclass: { id: sub[0], name: sub[1] }, ...extra }
}

// The catalog: items the game described. Some are listed, some never were.
export const CATALOG = [
  definition(4319, 'Azure Silk Gloves', 2, { id: 4, name: 'Armor', sub: [1, 'Cloth'] }, { requiredLevel: 24, itemLevel: 29, bindType: 2,
    lines: [{ left: 'Azure Silk Gloves' }, { left: 'Binds when equipped' }, { left: 'Hands', right: 'Cloth' }, { left: '30 Armor' }, { left: 'Requires Level 24' }] }),
  definition(2589, 'Linen Cloth', 1, tradeGoods(5, 'Cloth'), { stackCount: 20, lines: [{ left: 'Linen Cloth' }, { left: 'Crafting Reagent' }] }),
  definition(2592, 'Wool Cloth', 1, tradeGoods(5, 'Cloth'), { stackCount: 20 }),
  definition(4306, 'Silk Cloth', 1, tradeGoods(5, 'Cloth'), { stackCount: 20 }),
  definition(2770, 'Copper Ore', 1, tradeGoods(7, 'Metal & Stone'), { stackCount: 20 }),
  definition(12359, 'Thorium Bar', 1, tradeGoods(7, 'Metal & Stone'), { stackCount: 20 }),
  definition(3575, 'Iron Bar', 1, tradeGoods(7, 'Metal & Stone'), { stackCount: 20 }),
  definition(15210, "Raider's Chestpiece", 2, { id: 4, name: 'Armor', sub: [2, 'Leather'] }, { requiredLevel: 15, itemLevel: 20 }),
  definition(18803, "Finkle's Lava Dredger", 4, { id: 2, name: 'Weapon', sub: [6, 'Polearms'] }, { requiredLevel: 60, itemLevel: 70 }),
]

const listed = (itemId, name, min, quantity, extra = {}) => ({ itemId, quantity, listings: Math.max(1, Math.round(quantity / 20)), minUnitBuyout: min, complete: true, name,
  qualityId: 1, requiredLevel: 0, prices: [[min, quantity, Math.max(1, Math.round(quantity / 20))]], ...extra })
// Many cheap practice listings, so the table scrolls.
const bulk = Array.from({ length: 40 }, (_, index) => listed(990001 + index, `Practice Token ${String(index + 1).padStart(2, '0')}`, 5 + index, 3))

// The Alliance in-game market: gloves, cloth, ore and two versions of the
// chestpiece. The Horde market: the same gloves at another price, iron.
export const ALLIANCE_SCANS = [
  { ago: 3600, items: [listed(4319, 'Azure Silk Gloves', 26000, 2, { qualityId: 2, requiredLevel: 24 }), listed(2589, 'Linen Cloth', 90, 400), listed(2592, 'Wool Cloth', 160, 60),
    listed(2770, 'Copper Ore', 70, 80),
    { itemId: 15210, suffix: -1081, quantity: 1, listings: 1, minUnitBuyout: 50000, complete: true, name: "Raider's Chestpiece of the Bear", qualityId: 2, requiredLevel: 15, prices: [[50000, 1, 1]] },
    { itemId: 15210, suffix: -1082, quantity: 1, listings: 1, minUnitBuyout: 9000, complete: true, name: "Raider's Chestpiece of the Eagle", qualityId: 2, requiredLevel: 15, prices: [[9000, 1, 1]] },
    ...bulk] },
]
export const HORDE_SCANS = [
  { ago: 1800, items: [listed(4319, 'Azure Silk Gloves', 31500, 1, { qualityId: 2, requiredLevel: 24 }), listed(3575, 'Iron Bar', 480, 40)] },
]

const linen = (min, quantity = 400) => ({ itemId: 2589, quantity, listings: 20, minUnitBuyout: min, complete: true, name: 'Linen Cloth', qualityId: 1, requiredLevel: 0,
  prices: [[min, quantity / 2, 10], [min + 10, quantity / 2, 10]] })
const chest = { itemId: 15210, suffix: -1081, quantity: 2, listings: 2, minUnitBuyout: 50000, complete: true, name: "Raider's Chestpiece of the Bear",
  qualityId: 2, requiredLevel: 30, prices: [[50000, 1, 1], [62000, 1, 1]] }
const wool = { itemId: 2592, quantity: 60, listings: 6, minUnitBuyout: 150, complete: true, name: 'Wool Cloth', qualityId: 1, requiredLevel: 0, prices: [[150, 60, 6]] }

// Three hours of one player's searches: linen moves, a variant and wool.
export const SAMPLE_SCANS = [
  { ago: 3 * 3600, items: [linen(90), chest] },
  { ago: 2 * 3600, items: [linen(95)] },
  { ago: 3600, items: [linen(80, 500), wool] },
]
