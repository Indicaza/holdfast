import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

// Pairs a device as the member persona and sends gathering_loot events
// through the bridge telemetry endpoint, exactly as Guildweaver does.
async function seedGathering(page, context) {
  await authenticate(context, 'member')
  await page.goto('/')

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
  })
}

test('farming intelligence finds sources by item and recomputes the source modal under filters', async ({ page, context }) => {
  await seedGathering(page, context)
  await page.goto('/intelligence#farming')

  await expect(page.getByRole('heading', { name: 'Farming', level: 1 })).toBeVisible()
  const herbalism = page.getByRole('region', { name: 'Herbalism' })
  await expect(herbalism.locator('.farm-card')).toHaveCount(2)
  await expect(herbalism.locator('.farm-card').filter({ hasText: 'Peacebloom' }).locator('.farm-card__drops')).toContainText('Frilled Lichen')
  await expect(page.getByRole('group', { name: 'Discipline' }).getByRole('button', { name: 'Herbalism' })).toBeVisible()

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
})
