import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

async function seedFishing(page, context) {
  await authenticate(context, 'member')
  await page.goto('/')

  await page.evaluate(async () => {
    async function json(url, options = {}) {
      const { headers = {}, ...rest } = options
      const response = await fetch(url, {
        ...rest,
        headers: { 'Content-Type': 'application/json', ...headers },
      })
      const body = await response.json()
      if (!response.ok) throw new Error(`${url}: ${response.status} ${JSON.stringify(body)}`)
      return body
    }

    const pairing = await json('/api/bridge/pairing/start', {
      method: 'POST',
      body: JSON.stringify({ deviceName: 'Fishing Pools E2E' }),
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
    const scenarios = [
      ...Array.from({ length: 6 }, (_, index) => ({
        source: { kind: 'fishing_water', name: 'Open Water' },
        zone: 'Westfall', mapId: 1436, skill: 55 + index,
        outputs: [{ itemId: 6289, name: 'Raw Longjaw Mud Snapper', quantity: 1 }],
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        source: { kind: 'fishing_water', name: 'Open Water' },
        zone: 'Darkshore', mapId: 1439, skill: 70 + index,
        outputs: [{ itemId: 6303, name: 'Raw Slitherskin Mackerel', quantity: 1 }],
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        source: { kind: 'fishing_pool', name: 'Oily Blackmouth School', objectId: 180682 },
        zone: 'Darkshore', mapId: 1439, skill: 80 + index,
        outputs: [
          { itemId: 6358, name: 'Oily Blackmouth', quantity: index === 0 ? 2 : 1 },
          ...(index < 2 ? [{ itemId: 3820, name: 'Stranglekelp', quantity: 1 }] : []),
        ],
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        source: { kind: 'fishing_pool', name: 'Oily Blackmouth School', objectId: 180682 },
        zone: 'Wetlands', mapId: 1437, skill: 105 + index,
        outputs: [{ itemId: 6358, name: 'Oily Blackmouth', quantity: 1 }],
      })),
      {
        source: { kind: 'fishing_pool', name: 'Fishing Pool', objectId: 180684 },
        zone: 'Darkshore', mapId: 1439, skill: 110,
        outputs: [{ itemId: 6359, name: 'Firefin Snapper', quantity: 1 }],
      },
    ]

    for (const [index, scenario] of scenarios.entries()) {
      const attemptId = `pool-attempt-${run}-${index}`
      const catchId = `pool-catch-${run}-${index}`
      const common = {
        schemaVersion: 1,
        capturedAt: Math.floor(Date.now() / 1000) - index,
        gameBuild: { version: '1.60.1', build: '70338', interface: 16001 },
        realm: 'Classic Beta PvE 2',
        region: 'US',
        characterId: 'character-e2e-pool-fisher',
        payloadSchemaVersion: 1,
      }
      const contextPayload = {
        characterLevel: 30,
        profession: { skillLineId: 356, name: 'Fishing', skillLevel: scenario.skill, maxSkillLevel: 150, skillModifier: 5 },
        location: { mapId: scenario.mapId, zone: scenario.zone, x: 0.42, y: 0.61 },
      }

      await json('/api/bridge/telemetry', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.deviceToken}`, 'Idempotency-Key': attemptId },
        body: JSON.stringify({
          streamKey: `gathering_attempt:character-e2e-pool-fisher:${attemptId}`,
          kind: 'event',
          revision: 1,
          envelope: {
            ...common,
            eventType: 'gathering_attempt',
            payload: {
              schemaVersion: 1,
              observationId: attemptId,
              activity: 'cast',
              discipline: 'fishing',
              source: scenario.source,
              outputs: [],
              context: contextPayload,
            },
          },
        }),
      })

      await json('/api/bridge/telemetry', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.deviceToken}`, 'Idempotency-Key': catchId },
        body: JSON.stringify({
          streamKey: `gathering_loot:character-e2e-pool-fisher:${catchId}`,
          kind: 'event',
          revision: 1,
          envelope: {
            ...common,
            eventType: 'gathering_loot',
            payload: {
              schemaVersion: 1,
              observationId: catchId,
              activity: 'catch',
              discipline: 'fishing',
              source: scenario.source,
              outputs: scenario.outputs,
              context: contextPayload,
            },
          },
        }),
      })
    }
  })
}

test('fishing pools and open water remain distinct across zones', async ({ page, context }) => {
  await seedFishing(page, context)
  await page.goto('/intelligence#farming')

  const fishing = page.getByRole('region', { name: 'Fishing' })
  await expect(fishing).toBeVisible()
  await expect(page.getByRole('group', { name: 'Discipline' }).getByRole('button', { name: 'Fishing' })).toBeVisible()

  const openWater = fishing.locator('.farm-card').filter({ hasText: 'Open Water' })
  await expect(openWater.filter({ hasText: 'Westfall' })).toContainText('6 gathers')
  await expect(openWater.filter({ hasText: 'Darkshore' })).toContainText('4 gathers')

  const oilySchools = fishing.locator('.farm-card').filter({ hasText: 'Oily Blackmouth School' })
  await expect(oilySchools).toHaveCount(2)
  await expect(oilySchools.filter({ hasText: 'Darkshore' })).toBeVisible()
  await expect(oilySchools.filter({ hasText: 'Wetlands' })).toBeVisible()

  const restrictedPool = fishing.locator('.farm-card').filter({ hasText: 'Fishing Pool' })
  await expect(restrictedPool).toContainText('Darkshore')
  await restrictedPool.click()
  const restrictedModal = page.getByRole('dialog', { name: 'Fishing Pool' })
  await expect(restrictedModal.locator('.farm-loot__row').filter({ hasText: 'Firefin Snapper' })).toContainText('100%')
  await page.keyboard.press('Escape')

  await page.getByRole('searchbox', { name: 'Search items or sources' }).fill('Oily Blackmouth')
  const searchedSchools = page.locator('.farm-card').filter({ hasText: 'Oily Blackmouth School' })
  await expect(searchedSchools).toHaveCount(2)
  await expect(searchedSchools.filter({ hasText: 'Darkshore' }).locator('.farm-card__drops--match')).toContainText('100%')
  await expect(searchedSchools.filter({ hasText: 'Wetlands' }).locator('.farm-card__drops--match')).toContainText('100%')

  await searchedSchools.filter({ hasText: 'Darkshore' }).click()
  const modal = page.getByRole('dialog', { name: 'Oily Blackmouth School' })
  await expect(modal).toBeVisible()
  await expect(modal).toContainText('Darkshore')
  await expect(modal.locator('.farm-header__gathers')).toHaveText('5gathers')
  await expect(modal.locator('.farm-loot__row').filter({ hasText: 'Oily Blackmouth' })).toContainText('100%')
  await expect(modal.locator('.farm-loot__row').filter({ hasText: 'Stranglekelp' })).toContainText('40.0%')
  await expect(modal.getByRole('tab', { name: 'Fishing skill' })).toHaveAttribute('aria-selected', 'true')
  await expect(modal.getByRole('tab', { name: 'Bountiful Harvest' })).toHaveCount(0)
})
