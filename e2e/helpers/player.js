// Connects a computer for the signed-in player and uploads characters the
// way Guildweaver Bridge does: pair, approve as the player, exchange the
// code for a device key, then post telemetry with that key. Runs in the page
// so it uses the page's own session cookie and origin.
export function connectAndSync(page, { deviceName = 'E2E PC', characters = [], gathers = [], telemetry = [] } = {}) {
  return page.evaluate(async ({ deviceName, characters, gathers, telemetry }) => {
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
    const auth = { Authorization: `Bearer ${device.deviceToken}` }

    let capturedAt = Math.floor(Date.now() / 1000) - 120
    for (const character of characters) {
      capturedAt += 1
      await json('/api/bridge/telemetry', {
        method: 'POST',
        headers: { ...auth, 'Idempotency-Key': `e2e-${deviceName}-${character.id}-${capturedAt}` },
        body: JSON.stringify({
          streamKey: `character:${character.id}`,
          kind: 'state',
          revision: capturedAt,
          envelope: {
            schemaVersion: 1,
            eventType: 'character',
            capturedAt,
            characterId: character.id,
            realm: character.realm,
            region: 'US',
            payloadSchemaVersion: 1,
            payload: {
              schemaVersion: 1,
              name: character.name,
              realm: character.realm,
              region: 'US',
              level: character.level || 20,
              class: { id: 1, name: 'Warrior', token: 'WARRIOR' },
              race: { id: 4, name: 'Night Elf', token: 'NightElf' },
            },
          },
        }),
      })
    }

    for (const gather of gathers) {
      capturedAt += 1
      await json('/api/bridge/telemetry', {
        method: 'POST',
        headers: { ...auth, 'Idempotency-Key': `e2e-gather-${gather.id}` },
        body: JSON.stringify({
          streamKey: `gathering_loot:${gather.characterId}:${gather.id}`,
          kind: 'event',
          revision: 1,
          envelope: {
            schemaVersion: 1,
            eventType: 'gathering_loot',
            capturedAt,
            gameBuild: { version: '1.60.1', build: '70790', interface: 16001 },
            realm: gather.realm,
            region: 'US',
            installationId: `e2e-${deviceName}`,
            characterId: gather.characterId,
            addon: { name: 'Guildweaver', version: '0.6.0' },
            payloadSchemaVersion: 1,
            payload: {
              schemaVersion: 1,
              activity: 'harvest',
              discipline: 'herbalism',
              observationId: gather.id,
              source: { kind: 'herb_node', name: 'Peacebloom', guid: `GameObject-0-1-2-3-1618-${gather.id}`, objectId: 1618, guidKind: 'GameObject' },
              outputs: [{ itemId: 2447, itemLink: 'item:2447', name: 'Peacebloom', quantity: 2, qualityId: 1, iconFileDataId: 134183 }],
              context: {
                attemptedAt: capturedAt - 2,
                characterLevel: 20,
                profession: { skillLineId: 182, name: 'Herbalism', skillLevel: 40, maxSkillLevel: 75, skillModifier: 0 },
                location: { mapId: 1429, zone: 'Elwynn Forest', subzone: 'Goldshire', x: 0.42, y: 0.65, coordinateSystem: 'ui_map_normalized' },
              },
            },
          },
        }),
      })
    }

    for (const record of telemetry) {
      await json('/api/bridge/telemetry', {
        method: 'POST', headers: { ...auth, 'Idempotency-Key': `e2e-${record.streamKey}-${record.revision}` },
        body: JSON.stringify(record),
      })
    }
    return { deviceId: device.deviceId }
  }, { deviceName, characters, gathers, telemetry })
}
