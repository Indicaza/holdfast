import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

async function seedRichFarmingItem(page, context) {
  await authenticate(context, 'member')
  await page.goto('/holdfast')

  return page.evaluate(async () => {
    async function json(url, options = {}) {
      const { headers = {}, ...requestOptions } = options
      const response = await fetch(url, {
        ...requestOptions,
        headers: { 'Content-Type': 'application/json', ...headers },
      })
      const body = await response.json()
      if (!response.ok) throw new Error(`${url}: ${response.status} ${JSON.stringify(body)}`)
      return body
    }

    const pairing = await json('/api/bridge/pairing/start', {
      method: 'POST',
      body: JSON.stringify({ deviceName: 'Farming Tooltip E2E' }),
    })
    await json('/api/bridge/pairing/approve', {
      method: 'POST',
      body: JSON.stringify({ userCode: pairing.userCode }),
    })
    const token = await json('/api/bridge/pairing/token', {
      method: 'POST',
      body: JSON.stringify({ deviceCode: pairing.deviceCode }),
    })

    const run = `${Date.now()}`
    const sourceName = `Tooltip Test Herb ${run}`
    const itemEnvelope = {
      schemaVersion: 1,
      eventType: 'item_definition',
      capturedAt: Math.floor(Date.now() / 1000),
      gameBuild: { version: '1.60.1', build: '70338', interface: 16001 },
      payloadSchemaVersion: 1,
      payload: {
        schemaVersion: 1,
        itemKey: 'item:249399',
        item: {
          itemId: 249399,
          itemLink: '|cff1eff00|Hitem:249399::::::::30:::::::|h[Frilled Lichen]|h|r',
          name: 'Frilled Lichen',
          qualityId: 2,
          iconFileDataId: 134193,
          sellPrice: 125,
          itemClass: { id: 7, name: 'Trade Goods' },
          itemSubclass: { id: 9, name: 'Herb' },
          isCraftingReagent: true,
          tooltip: {
            source: 'GameTooltip',
            method: 'SetHyperlink',
            rendered: true,
            complete: true,
            lines: [
              { left: 'Frilled Lichen', leftColor: { r: 0.12, g: 1, b: 0 } },
              { left: 'Crafting Reagent', leftColor: { r: 0.4, g: 0.73, b: 1 } },
            ],
          },
        },
      },
    }

    await json('/api/bridge/telemetry', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.deviceToken}`,
        'Idempotency-Key': `item-definition-${run}`,
      },
      body: JSON.stringify({
        streamKey: 'item_definition:item:249399',
        kind: 'state',
        revision: 1,
        envelope: itemEnvelope,
      }),
    })

    for (let index = 0; index < 4; index += 1) {
      const observationId = `tooltip-gather-${run}-${index}`
      const envelope = {
        schemaVersion: 1,
        eventType: 'gathering_loot',
        capturedAt: Math.floor(Date.now() / 1000) - index,
        gameBuild: { version: '1.60.1', build: '70338', interface: 16001 },
        realm: 'Classic Beta PvE 2',
        region: 'US',
        characterId: `character-tooltip-${run}`,
        payloadSchemaVersion: 1,
        payload: {
          schemaVersion: 1,
          activity: 'harvest',
          discipline: 'tooltip_test',
          observationId,
          source: { kind: 'herb_node', name: sourceName, objectId: 990001 },
          outputs: [
            { itemId: 2447, name: 'Peacebloom', qualityId: 1, iconFileDataId: 133939, quantity: 2 },
            { itemId: 249399, name: 'Frilled Lichen', qualityId: 2, iconFileDataId: 134193, quantity: 1 },
          ],
          context: {
            characterLevel: 30,
            profession: { skillLineId: 182, name: 'Herbalism', skillLevel: 90, maxSkillLevel: 150 },
            location: { mapId: 1429, zone: 'Elwynn Forest', x: 0.4, y: 0.6 },
          },
        },
      }

      await json('/api/bridge/telemetry', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.deviceToken}`,
          'Idempotency-Key': observationId,
        },
        body: JSON.stringify({
          streamKey: `gathering_loot:character-tooltip-${run}:${observationId}`,
          kind: 'event',
          revision: 1,
          envelope,
        }),
      })
    }

    return { sourceName }
  })
}

test('farming cards use an icon grid and the full rendered Blizzard item tooltip', async ({ page, context }) => {
  const { sourceName } = await seedRichFarmingItem(page, context)
  await page.goto('/holdfast/intelligence#farming')

  const card = page.locator('.farm-card').filter({ hasText: sourceName })
  await expect(card).toBeVisible()

  const preview = card.locator('.farm-card__drops:not(.farm-card__drops--match)')
  await expect(preview).toBeVisible()
  expect(await preview.evaluate((element) => getComputedStyle(element).display)).toBe('grid')
  await expect(preview.locator('.farm-rate')).toBeHidden()
  await expect(preview.locator('.farm-pips')).toBeHidden()

  const item = preview.locator('.farm-item-hover').filter({ hasText: 'Frilled Lichen' })
  await item.hover()
  const tooltip = page.getByRole('tooltip').filter({ hasText: 'Frilled Lichen' })
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText('Crafting Reagent')
  await expect(tooltip).toContainText('Sell Price:')
  await expect(tooltip).not.toContainText('Full Blizzard tooltip is still syncing')

  await page.getByRole('searchbox', { name: 'Search items or sources' }).fill('Frilled Lichen')
  const searchedCard = page.locator('.farm-card').filter({ hasText: sourceName })
  const match = searchedCard.locator('.farm-card__drops--match')
  await expect(match).toBeVisible()
  await expect(match.locator('.farm-rate')).toBeVisible()
  await expect(match.locator('.farm-pips')).toBeVisible()
})
