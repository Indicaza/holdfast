import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

// Pairs a device as the member persona and sends gathering_loot events
// through the bridge telemetry endpoint, exactly as Guildweaver does.
async function seedGathering(page, context) {
  await authenticate(context, 'member')
  await page.goto('/holdfast')

  return page.evaluate(async () => {
    async function json(url, options = {}) {
      const { headers = {}, ...requestOptions } = options
      const response = await fetch(url, { ...requestOptions, headers: { 'Content-Type': 'application/json', ...headers } })
      const body = await response.json()
      if (!response.ok) throw new Error(`${url}: ${response.status} ${JSON.stringify(body)}`)
      return body
    }

    const pairing = await json('/api/bridge/pairing/start', { method: 'POST', body: JSON.stringify({ deviceName: 'Farming E2E' }) })
    await json('/api/bridge/pairing/approve', { method: 'POST', body: JSON.stringify({ userCode: pairing.userCode }) })
    const token = await json('/api/bridge/pairing/token', { method: 'POST', body: JSON.stringify({ deviceCode: pairing.deviceCode }) })

    const run = `${Date.now()}`
    const herbs = {
      Peacebloom: { objectId: 1618, item: { itemId: 2447, name: 'Peacebloom', qualityId: 1, iconFileDataId: 133939 } },
      Silverleaf: { objectId: 1617, item: { itemId: 765, name: 'Silverleaf', qualityId: 1, iconFileDataId: 134190 } },
    }
    const gathers = [
      ...Array.from({ length: 30 }, (_, index) => ({ herb: 'Peacebloom', lichen: index < 3, zone: index < 15 ? 'Duskwood' : 'Elwynn Forest', rank: index % 3 })),
      ...Array.from({ length: 10 }, (_, index) => ({ herb: 'Silverleaf', lichen: index === 0, zone: 'Teldrassil', rank: 0 })),
    ]

    for (const [index, gather] of gathers.entries()) {
      const observationId = `e2e-${run}-${index}`
      const herb = herbs[gather.herb]
      const envelope = {
        schemaVersion: 1,
        eventType: 'gathering_loot',
        capturedAt: Math.floor(Date.now() / 1000) - index,
        gameBuild: { version: '1.60.1', build: '70338', interface: 16001 },
        realm: 'Classic Beta PvE 2',
        region: 'US',
        characterId: 'character-e2e-farmer',
        payloadSchemaVersion: 1,
        payload: {
          schemaVersion: 1,
          activity: 'harvest',
          discipline: 'herbalism',
          observationId,
          source: { kind: 'herb_node', name: gather.herb, objectId: herb.objectId },
          outputs: [{ ...herb.item, quantity: 2 }, ...(gather.lichen ? [{ itemId: 249399, name: 'Frilled Lichen', qualityId: 2, quantity: 1 }] : [])],
          context: {
            characterLevel: 24,
            profession: { skillLineId: 182, name: 'Herbalism', skillLevel: 40 + index, maxSkillLevel: 150, skillModifier: 0 },
            modifiers: { bountifulHarvest: { spellId: 1225435, rank: gather.rank, maxRanks: 5 } },
            location: { mapId: 1431, zone: gather.zone, x: 0.4, y: 0.6 },
          },
        },
      }
      await json('/api/bridge/telemetry', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.deviceToken}`, 'Idempotency-Key': observationId },
        body: JSON.stringify({ streamKey: `gathering_loot:character-e2e-farmer:${observationId}`, kind: 'event', revision: 1, envelope }),
      })
    }

    const miningGathers = Array.from({ length: 12 }, (_, index) => ({
      zone: index < 8 ? 'Dun Morogh' : 'Elwynn Forest',
      malachite: index < 2,
      roughStone: index % 2 === 0,
      skill: 35 + index * 4,
    }))

    for (const [index, gather] of miningGathers.entries()) {
      const observationId = `e2e-mining-${run}-${index}`
      const outputs = [
        { itemId: 2770, name: 'Copper Ore', qualityId: 1, iconFileDataId: 134566, quantity: index % 3 === 0 ? 3 : 2 },
        ...(gather.roughStone ? [{ itemId: 2835, name: 'Rough Stone', qualityId: 1, iconFileDataId: 135242, quantity: 1 }] : []),
        ...(gather.malachite ? [{ itemId: 774, name: 'Malachite', qualityId: 2, iconFileDataId: 134106, quantity: 1 }] : []),
      ]
      const envelope = {
        schemaVersion: 1,
        eventType: 'gathering_loot',
        capturedAt: Math.floor(Date.now() / 1000) - 100 - index,
        gameBuild: { version: '1.60.1', build: '70338', interface: 16001 },
        realm: 'Classic Beta PvE 2',
        region: 'US',
        characterId: 'character-e2e-miner',
        payloadSchemaVersion: 1,
        payload: {
          schemaVersion: 1,
          activity: 'harvest',
          discipline: 'mining',
          observationId,
          source: { kind: 'ore_vein', name: 'Copper Vein', objectId: 1731 },
          outputs,
          context: {
            characterLevel: 18,
            profession: { skillLineId: 186, name: 'Mining', skillLevel: gather.skill, maxSkillLevel: 150, skillModifier: 5 },
            location: { mapId: gather.zone === 'Dun Morogh' ? 1426 : 1429, zone: gather.zone, x: 0.51, y: 0.42 },
          },
        },
      }
      await json('/api/bridge/telemetry', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.deviceToken}`, 'Idempotency-Key': observationId },
        body: JSON.stringify({ streamKey: `gathering_loot:character-e2e-miner:${observationId}`, kind: 'event', revision: 1, envelope }),
      })
    }

    return token.deviceToken
  })
}

// One more gather, synced while the page is open.
async function syncGather(page, deviceToken, { name, objectId, item }) {
  await page.evaluate(async ({ deviceToken, name, objectId, item }) => {
    const observationId = `e2e-live-${Date.now()}`
    const response = await fetch('/api/bridge/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deviceToken}`, 'Idempotency-Key': observationId },
      body: JSON.stringify({
        streamKey: `gathering_loot:character-e2e-farmer:${observationId}`,
        kind: 'event',
        revision: 1,
        envelope: {
          schemaVersion: 1,
          eventType: 'gathering_loot',
          capturedAt: Math.floor(Date.now() / 1000),
          gameBuild: { version: '1.60.1', build: '70338', interface: 16001 },
          characterId: 'character-e2e-farmer',
          payloadSchemaVersion: 1,
          payload: {
            schemaVersion: 1,
            activity: 'harvest',
            discipline: 'herbalism',
            observationId,
            source: { kind: 'herb_node', name, objectId },
            outputs: [{ ...item, quantity: 1 }],
            context: { characterLevel: 24, profession: { skillLineId: 182, name: 'Herbalism', skillLevel: 90 }, location: { zone: 'Westfall' } },
          },
        },
      }),
    })
    if (response.status !== 201) throw new Error(`live gather rejected: ${response.status}`)
  }, { deviceToken, name, objectId, item })
}

test('farming intelligence finds sources by item and recomputes the source modal under filters', async ({ page, context }) => {
  const deviceToken = await seedGathering(page, context)
  await page.goto('/holdfast/intelligence#farming')

  await expect(page.getByRole('heading', { name: 'Farming', level: 1 })).toBeVisible()
  const herbalism = page.getByRole('region', { name: 'Herbalism' })
  await expect(herbalism.locator('.farm-card')).toHaveCount(2)
  await expect(herbalism.locator('.farm-card').filter({ hasText: 'Peacebloom' }).locator('.farm-card__drops')).toContainText('Frilled Lichen')
  await expect(page.getByRole('group', { name: 'Discipline' }).getByRole('button', { name: 'Herbalism' })).toBeVisible()

  const mining = page.getByRole('region', { name: 'Mining' })
  const copperVein = mining.locator('.farm-card').filter({ hasText: 'Copper Vein' })
  await expect(mining.locator('.farm-card')).toHaveCount(1)
  await expect(copperVein).toContainText('Dun Morogh')
  await expect(copperVein).toContainText('+1')
  await expect(copperVein.locator('.farm-card__drops')).toContainText('Malachite')
  await expect(page.getByRole('group', { name: 'Discipline' }).getByRole('button', { name: 'Mining' })).toBeVisible()

  await page.getByRole('searchbox', { name: 'Search items or sources' }).fill('Frilled Lichen')
  const peacebloom = page.locator('.farm-card').filter({ hasText: 'Peacebloom' })
  const match = peacebloom.locator('.farm-card__drops--match')
  await expect(match).toContainText('Frilled Lichen')
  await expect(match).toContainText('10.0%')
  await expect(peacebloom.getByRole('img', { name: 'Low confidence' })).toBeVisible()
  await expect(page.locator('.farm-card').filter({ hasText: 'Silverleaf' })).toContainText('10.0%')

  await peacebloom.click()
  const modal = page.getByRole('dialog', { name: 'Peacebloom' })
  await expect(modal.getByRole('heading', { name: 'Peacebloom' })).toBeVisible()
  await expect(modal.locator('.farm-header__gathers')).toHaveText('30gathers')
  const lichen = modal.locator('.farm-loot__row').filter({ hasText: 'Frilled Lichen' })
  await expect(lichen).toHaveAttribute('aria-pressed', 'true')
  await expect(lichen.locator('.farm-loot__num').first()).toHaveText('3')
  await expect(lichen).toContainText('10.0%')

  const dropsList = modal.locator('.farm-drops__list')
  const rowBeforeHover = await lichen.boundingBox()
  const overflowBeforeHover = await dropsList.evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(rowBeforeHover).not.toBeNull()
  expect(overflowBeforeHover, 'drop list should not overflow before hover').toBeLessThanOrEqual(1)
  await lichen.hover()
  const rowAfterHover = await lichen.boundingBox()
  const overflowAfterHover = await dropsList.evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(rowAfterHover).not.toBeNull()
  expect(Math.abs(rowAfterHover.width - rowBeforeHover.width), 'hover must not change drop-row width').toBeLessThanOrEqual(0.5)
  expect(Math.abs(rowAfterHover.height - rowBeforeHover.height), 'hover must not change drop-row height').toBeLessThanOrEqual(0.5)
  expect(overflowAfterHover, 'hover must not create horizontal overflow').toBeLessThanOrEqual(1)

  await expect(modal.getByRole('tab', { name: 'Herbalism skill' })).toHaveAttribute('aria-selected', 'true')
  await expect(modal.getByRole('img', { name: 'Frilled Lichen drop rate by skill' })).toBeVisible()
  await modal.getByRole('tab', { name: 'Bountiful Harvest' }).click()
  await expect(modal.getByRole('tabpanel')).toContainText('Observed outcomes, not proven effects.')
  await expect(modal.getByRole('img', { name: 'Rank 2' })).toBeVisible()
  await expect(modal.getByRole('img', { name: 'Frilled Lichen drop rate by Bountiful Harvest rank' })).toBeVisible()

  const window = await modal.evaluate((panel) => ({ scroll: panel.scrollHeight, client: panel.clientHeight }))
  expect(window.scroll, 'the window itself never scrolls').toBeLessThanOrEqual(window.client)

  await modal.getByRole('combobox').first().selectOption('Duskwood')
  await expect(modal.locator('.farm-header__gathers')).toHaveText('15of 30 gathers')
  await expect(modal.locator('.farm-chip.is-active')).toHaveCount(1)
  await expect(lichen).toContainText('20.0%')

  await page.setViewportSize({ width: 360, height: 760 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)

  await page.keyboard.press('Escape')
  await expect(modal).toHaveCount(0)
  await expect(page).not.toHaveURL(/source=/)

  // A gather synced while the page is open appears without a reload.
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('searchbox', { name: 'Search items or sources' }).fill('')
  await expect(page.locator('.farm-card').filter({ hasText: 'Earthroot' })).toHaveCount(0)
  await syncGather(page, deviceToken, { name: 'Earthroot', objectId: 1619, item: { itemId: 2449, name: 'Earthroot', qualityId: 1 } })
  await expect(page.locator('.farm-card').filter({ hasText: 'Earthroot' })).toContainText('1 gather')

  // Mining uses the same source browser/modal contract without Herbalism-only analysis.
  await page.getByRole('searchbox', { name: 'Search items or sources' }).fill('Copper Ore')
  const searchedCopperVein = page.locator('.farm-card').filter({ hasText: 'Copper Vein' })
  await expect(searchedCopperVein).toBeVisible()
  await expect(searchedCopperVein.locator('.farm-card__drops--match')).toContainText('Copper Ore')
  await expect(searchedCopperVein.locator('.farm-card__drops--match')).toContainText('100%')
  await searchedCopperVein.click()

  const miningModal = page.getByRole('dialog', { name: 'Copper Vein' })
  await expect(miningModal.getByRole('heading', { name: 'Copper Vein' })).toBeVisible()
  await expect(miningModal).toContainText('Mining · Vein')
  await expect(miningModal.locator('.farm-header__gathers')).toHaveText('12gathers')
  await expect(miningModal.locator('.farm-loot__row').filter({ hasText: 'Copper Ore' })).toContainText('100%')
  await expect(miningModal.locator('.farm-loot__row').filter({ hasText: 'Rough Stone' })).toContainText('50.0%')
  await expect(miningModal.locator('.farm-loot__row').filter({ hasText: 'Malachite' })).toContainText('16.7%')
  await expect(miningModal.getByRole('tab', { name: 'Mining skill' })).toHaveAttribute('aria-selected', 'true')
  await expect(miningModal.getByRole('tab', { name: 'Bountiful Harvest' })).toHaveCount(0)
})
