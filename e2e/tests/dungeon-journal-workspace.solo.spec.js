import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

import { authenticate } from '../helpers/auth.js'
import { connectAndSync } from '../helpers/player.js'

// The Journal as one application: it fits the window, its map stays in view,
// and the same workspace opens over the world map. Real floors and pins with
// a placeholder picture, unless E2E_REAL_MAP uses the server's imported art.
const metadata = JSON.parse(readFileSync(new URL('../../backend/src/Atlas/data/sources/journal-maps.json', import.meta.url), 'utf8'))
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const SHOTS = process.env.E2E_JOURNAL_SHOTS
const CHARACTER = { id: 'Player-workspace-1', name: 'Mapwright', realm: 'E2E Workspace Realm', level: 20 }
let paired = false

async function withMaps(page) {
  if (process.env.E2E_REAL_MAP) return
  await page.route(/\/api\/player\/loot\/dungeons\/(\d+)(\?.*)?$/, async (route) => {
    const id = Number(/dungeons\/(\d+)/.exec(route.request().url())[1])
    const instance = metadata.instances.find((entry) => entry.instanceId === id)
    // The page may close while this is in flight, as a test ends.
    const response = await route.fetch().catch(() => null)
    if (!response) return undefined
    if (!instance || !response.ok()) return route.fulfill({ response }).catch(() => {})
    const detail = await response.json().catch(() => null)
    if (!detail?.atlas) return route.fulfill({ response }).catch(() => {})
    const byName = new Map(detail.atlas.bosses.map((boss) => [boss.name, boss]))
    detail.atlas.journalMap = {
      floors: instance.floors.map((floor) => ({ floorId: floor.floorId, index: floor.index, name: floor.name, imageUrl: PIXEL, width: 1002, height: 668, attribution: 'Test placeholder' })),
      pins: instance.pins.filter((pin) => byName.has(pin.name)).map((pin) => ({ bossKey: String(byName.get(pin.name).encounterId || byName.get(pin.name).npcId), name: pin.name, floorId: `journal-${id}-${pin.floor}`, x: pin.x, y: pin.y })),
    }
    return route.fulfill({ response, json: detail }).catch(() => {})
  })
}

async function signIn(page, context) {
  await authenticate(context, 'workspaceTester')
  await withMaps(page)
  await page.goto('/dashboard/dungeons')
  if (!paired) {
    await connectAndSync(page, { deviceName: 'Workspace PC', characters: [CHARACTER] })
    paired = true
  }
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

const noPageScroll = (page) => page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1)
const inView = async (page, locator) => {
  const box = await locator.boundingBox()
  const size = page.viewportSize()
  return Boolean(box) && box.x >= -1 && box.y >= -1 && box.x + box.width <= size.width + 1 && box.y + box.height <= size.height + 1
}
const mapOf = (root) => root.getByRole('region', { name: 'Map', exact: true })

for (const size of [{ width: 1536, height: 960 }, { width: 1280, height: 720 }]) {
  test(`Deadmines at ${size.width}x${size.height}: everything in one window`, async ({ page, context }) => {
    await page.setViewportSize(size)
    await signIn(page, context)
    await page.goto('/dashboard/dungeons?open=36')
    const encounters = page.getByRole('navigation', { name: 'Bosses' })
    await encounters.getByRole('button', { name: /Mr\. Smite/ }).click()
    await expect(page).toHaveURL(/boss=2745/)
    const map = mapOf(page)
    await expect(map.getByRole('img', { name: 'Map of Ironclad Cove' })).toBeVisible()
    await expect(map.getByRole('button', { name: /Mr\. Smite/ })).toHaveAttribute('aria-current', 'true')
    const loot = page.getByRole('region', { name: 'Mr. Smite loot' })
    const slot = loot.locator('button.gw-slot').first()
    await expect(slot).toBeVisible()
    const slotBox = await slot.boundingBox()
    expect(slotBox.width).toBeGreaterThanOrEqual(60)
    expect(slotBox.width).toBeLessThanOrEqual(64)
    const portrait = page.getByRole('article', { name: 'Mr. Smite' }).locator('.gw-atlas-portrait')
    expect((await portrait.boundingBox()).width).toBe(72)
    expect((await encounters.locator('.gw-atlas-portrait').first().boundingBox()).width).toBe(54)
    const railBox = await encounters.boundingBox()
    expect(railBox.width).toBeGreaterThanOrEqual(190)
    expect(railBox.width).toBeLessThanOrEqual(232)
    const dock = page.getByRole('region', { name: 'Encounter details' })
    const before = { map: await map.boundingBox(), dock: await dock.boundingBox() }
    expect(before.map.height / (before.map.height + before.dock.height)).toBeGreaterThan(0.66)
    const mechanics = page.locator('.gw-jw-mechanics')
    await expect(mechanics).not.toHaveAttribute('open', '')
    await mechanics.locator('summary').first().click()
    await expect(mechanics).toHaveAttribute('open', '')
    await expect(page.getByRole('button', { name: 'Tank', exact: true })).toBeAttached()
    expect(await map.boundingBox()).toEqual(before.map)
    expect(await dock.boundingBox()).toEqual(before.dock)
    expect(await noPageScroll(page)).toBe(true)
    await mechanics.locator('summary').first().click()
    await expect(mechanics).not.toHaveAttribute('open', '')
    expect(await noPageScroll(page)).toBe(true)
    for (const part of [page.getByRole('heading', { name: /Deadmines/, level: 2 }), encounters, map.locator('.gw-dmap__frame'), page.getByRole('article', { name: 'Mr. Smite' }), slot]) expect(await inView(page, part)).toBe(true)
    const frame = await map.locator('.gw-dmap__frame').boundingBox()
    expect(frame.width / frame.height).toBeCloseTo(1002 / 668, 1)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/journal-${size.width}.png` })

    await slot.hover()
    const tip = page.getByRole('tooltip')
    await expect(tip).toBeVisible()
    expect(await inView(page, tip)).toBe(true)
    expect(await slot.boundingBox()).toEqual(slotBox)
    await page.mouse.move(2, 2)
    await slot.click()
    const inspector = page.locator('.gw-itempop')
    const add = inspector.getByRole('button', { name: /^Add .* wishlist$/ })
    const put = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().includes('/wishlists/'))
    await add.click()
    if ((await put).ok()) {
      const remove = inspector.getByRole('button', { name: /^Remove .* wishlist$/ })
      await expect(remove).toHaveAttribute('aria-pressed', 'true')
      await remove.click()
      await expect(add).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await expect(inspector).toHaveCount(0)

    const allLoot = page.getByRole('button', { name: 'All loot' })
    await allLoot.click()
    await expect(page).toHaveURL(/loot=all/)
    await expect(page.getByRole('region', { name: 'Bosses', exact: true })).toBeVisible()
    await expect(map.locator('.gw-dmap__frame')).toBeVisible()
    expect(await noPageScroll(page)).toBe(true)
    if (SHOTS && size.width === 1536) await page.screenshot({ path: `${SHOTS}/all-loot-1536.png` })
    await allLoot.click()
    await expect(loot).toBeVisible()

    const tabs = page.getByRole('navigation', { name: /Deadmines sections/ })
    await expect(tabs.getByRole('button')).toHaveText(['Journal', 'Quests', 'My runs'])
    await tabs.getByRole('button', { name: 'Quests' }).click()
    await expect(map.getByRole('img', { name: 'Map of Ironclad Cove' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Preparation checklist' })).toBeVisible()
    expect(await noPageScroll(page)).toBe(true)
    const overlaps = await page.locator('.gw-jw-checklist .gw-qplan__row').evaluateAll((rows) => rows.filter((row) => {
      const title = row.querySelector('.gw-qplan__title')?.getBoundingClientRect()
      const where = row.querySelector(':scope > .gw-qplan__where')?.getBoundingClientRect()
      return title && where && where.top < title.bottom - 1 && where.left < title.right - 1 && where.right > title.left + 1
    }).length)
    expect(overlaps).toBe(0)
    if (SHOTS && size.width === 1536) await page.screenshot({ path: `${SHOTS}/quests-1536.png` })
    await tabs.getByRole('button', { name: 'My runs' }).click()
    await expect(map).toHaveCount(0)
    await tabs.getByRole('button', { name: 'Journal' }).click()
    await expect(page.getByRole('article', { name: 'Mr. Smite' })).toBeVisible()
    await page.goBack()
    await expect(page).not.toHaveURL(/open=36/)
    await expect(page.getByRole('navigation', { name: 'Dungeon views' })).toBeVisible()
  })
}

test('old Loot and Prepare links land on what they now are', async ({ page, context }) => {
  await signIn(page, context)
  await page.goto('/dashboard/dungeons?open=36&section=loot')
  await expect(page).toHaveURL(/open=36&loot=all/)
  await expect(page.getByRole('button', { name: 'All loot' })).toHaveAttribute('aria-pressed', 'true')
  await page.goto('/dashboard/dungeons?open=36&section=prepare')
  await expect(page).toHaveURL(/section=quests/)
  await expect(page.getByRole('region', { name: 'Preparation checklist' })).toBeVisible()
})

test('a dungeon without a map, or with many floors, stays compact', async ({ page, context }) => {
  await page.setViewportSize({ width: 1536, height: 960 })
  await signIn(page, context)
  await page.goto('/dashboard/dungeons?open=3065')
  await expect(page.getByText('No map of The Hall of Thanes yet.')).toBeVisible()
  expect((await page.locator('.gw-jw-map').boundingBox()).height).toBeLessThan(60)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/no-map-1536.png` })
  await expect(page.locator('.gw-atlas-floor__plot')).toHaveCount(0)
  expect(await noPageScroll(page)).toBe(true)
  await page.goto('/dashboard/dungeons?open=33')
  await page.getByRole('combobox', { name: /floor/ }).selectOption({ label: '7. The Wall Walk' })
  await expect(mapOf(page).getByRole('img', { name: 'Map of The Wall Walk' })).toBeVisible()
  expect(await noPageScroll(page)).toBe(true)
  await page.goto('/dashboard/dungeons?open=389')
  await expect(page.getByRole('heading', { name: 'Ragefire Chasm', level: 2 })).toBeVisible()
  expect(await inView(page, mapOf(page).locator('.gw-dmap__frame'))).toBe(true)
  expect(await noPageScroll(page)).toBe(true)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ragefire-1536.png` })
})

test('the Resource Map keeps its place under the Journal', async ({ page, context }) => {
  await page.setViewportSize({ width: 1536, height: 960 })
  await signIn(page, context)
  await page.goto('/map?zone=1436&dungeons=1')
  const pin = page.getByRole('button', { name: /Deadmines/ }).first()
  await expect(pin).toBeVisible()
  const canvas = page.locator('.gw-rmap canvas').first()
  await canvas.evaluate((node) => { node.dataset.sameCanvas = '1' })
  const stage = await canvas.boundingBox()
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2)
  await page.mouse.wheel(0, -240)
  await page.waitForTimeout(900)
  const spots = page.getByRole('button', { name: 'Spots', exact: true })
  await spots.click()
  await expect(spots).toHaveAttribute('aria-pressed', 'true')
  const before = await pin.boundingBox()
  const url = page.url()
  await pin.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: /Deadmines/, level: 2 })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
  await dialog.getByRole('navigation', { name: 'Bosses' }).getByRole('button', { name: /Sneed/ }).click()
  await expect(mapOf(dialog).getByRole('button', { name: /Sneed/ })).toHaveAttribute('aria-current', 'true')
  await dialog.getByRole('group', { name: /floors/ }).getByRole('button', { name: 'Ironclad Cove' }).click()
  await expect(mapOf(dialog).getByRole('img', { name: 'Map of Ironclad Cove' })).toBeVisible()
  expect(await inView(page, dialog)).toBe(true)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/resource-map-modal.png` })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(page.url()).toBe(url)
  await expect(page.locator('.gw-rmap canvas[data-same-canvas="1"]')).toHaveCount(1)
  await expect(spots).toHaveAttribute('aria-pressed', 'true')
  const after = await pin.boundingBox()
  expect(Math.abs(after.x - before.x)).toBeLessThan(2)
  expect(Math.abs(after.y - before.y)).toBeLessThan(2)
  await expect(pin).toBeFocused()
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('map first, one panel at a time, and only that panel scrolls', async ({ page, context }) => {
    await signIn(page, context)
    await page.goto('/dashboard/dungeons?open=36')
    const panes = page.getByRole('group', { name: 'Show' })
    await expect(mapOf(page).locator('.gw-dmap__frame')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Bosses' })).toBeHidden()
    await expect(page.getByRole('article', { name: "Rhahk'Zor" }).locator('button.gw-slot').first()).toBeVisible()
    await panes.getByRole('button', { name: 'Encounters' }).tap()
    await page.getByRole('navigation', { name: 'Bosses' }).getByRole('button', { name: /Mr\. Smite/ }).tap()
    await expect(page.getByRole('article', { name: 'Mr. Smite' })).toBeVisible()
    await expect(mapOf(page)).toBeHidden()
    expect(await noPageScroll(page)).toBe(true)
    await page.getByRole('region', { name: 'Mr. Smite loot' }).locator('button.gw-slot').first().tap()
    await expect(page.getByRole('dialog').last()).toBeVisible()
    await page.keyboard.press('Escape')
    await panes.getByRole('button', { name: 'Map' }).tap()
    await expect(mapOf(page).getByRole('img', { name: 'Map of Ironclad Cove' })).toBeVisible()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-map.png` })
  })
})
