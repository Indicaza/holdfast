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
