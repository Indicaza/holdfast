import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

import { authenticate } from '../helpers/auth.js'

// Deadmines' real floors and pin positions (the add-on's table) over a
// placeholder picture: no game art is in the repository. With E2E_REAL_MAP
// set, the pictures are the ones imported into the server's Content Studio.
const metadata = JSON.parse(readFileSync(new URL('../../backend/src/Atlas/data/sources/journal-maps.json', import.meta.url), 'utf8'))
const deadmines = metadata.instances.find((entry) => entry.instanceId === 36)
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const SHOTS = process.env.E2E_MAP_SHOTS

async function open(page, context, path = '/dashboard/dungeons?open=36') {
  await authenticate(context, 'journalTester')
  if (!process.env.E2E_REAL_MAP) {
    await page.route(/\/api\/player\/loot\/dungeons\/36(\?.*)?$/, async (route) => {
      const response = await route.fetch()
      const detail = await response.json()
      const byName = new Map(detail.atlas.bosses.map((boss) => [boss.name, boss]))
      detail.atlas.journalMap = {
        floors: deadmines.floors.map((floor) => ({ floorId: floor.floorId, index: floor.index, name: floor.name, imageUrl: PIXEL, width: 1002, height: 668, attribution: 'Test placeholder' })),
        pins: deadmines.pins.filter((pin) => byName.has(pin.name)).map((pin) => ({ bossKey: String(byName.get(pin.name).encounterId), name: pin.name, floorId: `journal-36-${pin.floor}`, x: pin.x, y: pin.y })),
      }
      await route.fulfill({ response, json: detail })
    })
  }
  await page.goto(path)
}

const mapRegion = (page) => page.getByRole('region', { name: 'Map', exact: true })

test('Deadmines: floors switch, pins sit at their coordinates and open their boss', async ({ page, context }) => {
  await open(page, context)
  const map = mapRegion(page)
  await expect(map.getByRole('img', { name: 'Map of The Deadmines' })).toBeVisible()
  await expect(map.getByRole('button', { name: /Rhahk'Zor, boss 1/ })).toBeVisible()
  await expect(map.getByRole('button', { name: /Edwin VanCleef/ })).toHaveCount(0)

  const frame = await map.locator('.gw-dmap__frame').boundingBox()
  const pin = await map.getByRole('button', { name: /Rhahk'Zor/ }).boundingBox()
  const expected = deadmines.pins.find((entry) => entry.name === "Rhahk'Zor")
  expect(Math.abs(pin.x + pin.width / 2 - (frame.x + 1 + expected.x * (frame.width - 2)))).toBeLessThan(2)
  expect(Math.abs(pin.y + pin.height / 2 - (frame.y + 1 + expected.y * (frame.height - 2)))).toBeLessThan(2)
  expect(frame.width / frame.height).toBeCloseTo(1002 / 668, 1)
  if (SHOTS) await map.screenshot({ path: `${SHOTS}/deadmines-floor-1-desktop.png` })

  await map.getByRole('button', { name: 'Ironclad Cove' }).click()
  await expect(map.getByRole('img', { name: 'Map of Ironclad Cove' })).toBeVisible()
  await expect(map.getByRole('button', { name: /Rhahk'Zor/ })).toHaveCount(0)
  if (SHOTS) await map.screenshot({ path: `${SHOTS}/deadmines-floor-2-desktop.png` })
  await map.getByRole('button', { name: /Edwin VanCleef/ }).click()

  const boss = page.getByRole('article', { name: 'Edwin VanCleef' })
  await expect(boss).toBeVisible()
  await expect(page).toHaveURL(/boss=2747/)
  const location = boss.getByRole('region', { name: 'Edwin VanCleef on the map' })
  await expect(location.getByRole('img', { name: 'Map of Ironclad Cove' })).toBeVisible()
  await expect(location.getByRole('button', { name: /Edwin VanCleef/ })).toHaveAttribute('aria-current', 'true')
})

test('choosing a boss in the encounter list turns to its floor and highlights its pin', async ({ page, context }) => {
  await open(page, context, '/dashboard/dungeons?open=36&boss=2747')
  await page.getByRole('navigation', { name: 'Bosses' }).getByRole('button', { name: /Sneed/ }).click()
  const location = page.getByRole('article', { name: 'Sneed' }).getByRole('region', { name: 'Sneed on the map' })
  await expect(location.getByRole('img', { name: 'Map of The Deadmines' })).toBeVisible()
  await expect(location.getByRole('button', { name: /Sneed/ })).toHaveAttribute('aria-current', 'true')
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the map fits the screen and its pins stay inside it', async ({ page, context }) => {
    await open(page, context)
    const map = mapRegion(page)
    await map.scrollIntoViewIfNeeded()
    const frame = await map.locator('.gw-dmap__frame').boundingBox()
    expect(frame.x).toBeGreaterThanOrEqual(0)
    expect(frame.x + frame.width).toBeLessThanOrEqual(390)
    const pin = await map.getByRole('button', { name: /Sneed/ }).boundingBox()
    expect(pin.x).toBeGreaterThanOrEqual(frame.x - 1)
    expect(pin.x + pin.width).toBeLessThanOrEqual(frame.x + frame.width + 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    if (SHOTS) await map.screenshot({ path: `${SHOTS}/deadmines-floor-1-phone.png` })
  })
})
