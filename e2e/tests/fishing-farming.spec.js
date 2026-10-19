import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

async function seedFishing(page, context) {
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

    const pairing = await json('/api/bridge/pairing/start', { method: 'POST', body: JSON.stringify({ deviceName: 'Fishing Farming E2E' }) })
    await json('/api/bridge/pairing/approve', { method: 'POST', body: JSON.stringify({ userCode: pairing.userCode }) })
    const token = await json('/api/bridge/pairing/token', { method: 'POST', body: JSON.stringify({ deviceCode: pairing.deviceCode }) })

    const run = `${Date.now()}`
    const baseEnvelope = {
      schemaVersion: 1,
      gameBuild: { version: '1.60.1', build: '70338', interface: 16001 },
      realm: 'Classic Beta PvE 2',
      region: 'US',
      characterId: 'character-e2e-fisher',
      payloadSchemaVersion: 1,
    }

    for (let index = 0; index < 15; index += 1) {
      const observationId = `e2e-fishing-cast-${run}-${index}`
      const zone = index < 10 ? 'Elwynn Forest' : 'Stormwind City'
      const envelope = {
        ...baseEnvelope,
        eventType: 'gathering_attempt',
        capturedAt: Math.floor(Date.now() / 1000) - 200 - index,
        payload: {
          schemaVersion: 1,
          activity: 'cast',
          discipline: 'fishing',
          observationId,
          source: { kind: 'fishing_water', name: 'Open Water' },
          outputs: [],
          context: {
            characterLevel: 22,
            profession: { skillLineId: 356, name: 'Fishing', skillLevel: 35 + index * 3, maxSkillLevel: 150, skillModifier: 5 },
            location: { mapId: zone === 'Elwynn Forest' ? 1429 : 1453, zone, x: 0.43, y: 0.66 },
          },
          capture: { accepted: true },
        },
      }
      await json('/api/bridge/telemetry', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.deviceToken}`, 'Idempotency-Key': observationId },
        body: JSON.stringify({ streamKey: `gathering_attempt:character-e2e-fisher:${observationId}`, kind: 'event', revision: 1, envelope }),
      })
    }

    for (let index = 0; index < 12; index += 1) {
      const observationId = `e2e-fishing-catch-${run}-${index}`
      const zone = index < 8 ? 'Elwynn Forest' : 'Stormwind City'
      const smallfish = index < 8
      const output = smallfish
        ? { itemId: 6291, name: 'Raw Brilliant Smallfish', qualityId: 1, iconFileDataId: 133894, quantity: 1 }
        : { itemId: 6289, name: 'Raw Longjaw Mud Snapper', qualityId: 1, iconFileDataId: 133918, quantity: 1 }
      const envelope = {
        ...baseEnvelope,
        eventType: 'gathering_loot',
        capturedAt: Math.floor(Date.now() / 1000) - 100 - index,
        payload: {
          schemaVersion: 1,
          activity: 'catch',
          discipline: 'fishing',
          observationId,
          source: { kind: 'fishing_water', name: 'Open Water' },
          outputs: [output],
          context: {
            characterLevel: 22,
            profession: { skillLineId: 356, name: 'Fishing', skillLevel: 40 + index * 4, maxSkillLevel: 150, skillModifier: 5 },
            location: { mapId: zone === 'Elwynn Forest' ? 1429 : 1453, zone, x: 0.43, y: 0.66 },
          },
        },
      }
      await json('/api/bridge/telemetry', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.deviceToken}`, 'Idempotency-Key': observationId },
        body: JSON.stringify({ streamKey: `gathering_loot:character-e2e-fisher:${observationId}`, kind: 'event', revision: 1, envelope }),
      })
    }
  })
}

test('fishing catches use zone-scoped Farming sources while casts stay a separate denominator', async ({ page, context }) => {
  await seedFishing(page, context)
  await page.goto('/holdfast/intelligence#farming')

  const fishing = page.getByRole('region', { name: 'Fishing' })
  const openWater = fishing.locator('.farm-card').filter({ hasText: 'Open Water' })
  const elwynn = openWater.filter({ hasText: 'Elwynn Forest' })
  const stormwind = openWater.filter({ hasText: 'Stormwind City' })

  await expect(elwynn).toBeVisible()
  await expect(stormwind).toBeVisible()
  await expect(elwynn).toContainText('8 catches')
  await expect(stormwind).toContainText('4 catches')
  await expect(page.getByRole('group', { name: 'Discipline' }).getByRole('button', { name: 'Fishing' })).toBeVisible()

  await page.getByRole('searchbox', { name: 'Search items or sources' }).fill('Raw Longjaw Mud Snapper')
  const searched = page.locator('.farm-card').filter({ hasText: 'Open Water' }).filter({ hasText: 'Stormwind City' })
  await expect(searched).toBeVisible()
  await expect(searched.locator('.farm-card__drops--match')).toContainText('Raw Longjaw Mud Snapper')
  await expect(searched.locator('.farm-card__drops--match')).toContainText('100%')
  await searched.click()

  const stormwindModal = page.getByRole('dialog', { name: 'Open Water' })
  await expect(stormwindModal.getByRole('heading', { name: 'Open Water' })).toBeVisible()
  await expect(stormwindModal).toContainText('Fishing · Open water')
  await expect(stormwindModal).toContainText('Stormwind City')
  await expect(stormwindModal.locator('.farm-header__gathers')).toHaveText('4catches')
  await expect(stormwindModal.locator('.farm-loot__row').filter({ hasText: 'Raw Longjaw Mud Snapper' })).toContainText('100%')
  await expect(stormwindModal.locator('.farm-loot__row').filter({ hasText: 'Raw Brilliant Smallfish' })).toHaveCount(0)
  await expect(stormwindModal.getByRole('tab', { name: 'Fishing skill' })).toHaveAttribute('aria-selected', 'true')
  await expect(stormwindModal.getByRole('tab', { name: 'Bountiful Harvest' })).toHaveCount(0)

  await page.keyboard.press('Escape')
  await page.getByRole('searchbox', { name: 'Search items or sources' }).fill('Raw Brilliant Smallfish')
  const searchedElwynn = page.locator('.farm-card').filter({ hasText: 'Open Water' }).filter({ hasText: 'Elwynn Forest' })
  await expect(searchedElwynn.locator('.farm-card__drops--match')).toContainText('Raw Brilliant Smallfish')
  await expect(searchedElwynn.locator('.farm-card__drops--match')).toContainText('100%')
  await searchedElwynn.click()

  const elwynnModal = page.getByRole('dialog', { name: 'Open Water' })
  await expect(elwynnModal).toContainText('Elwynn Forest')
  await expect(elwynnModal.locator('.farm-header__gathers')).toHaveText('8catches')
  await expect(elwynnModal.locator('.farm-loot__row').filter({ hasText: 'Raw Brilliant Smallfish' })).toContainText('100%')
})
