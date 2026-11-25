import { expect, test } from '@playwright/test'

import { authenticate } from '../helpers/auth.js'

async function openMap(page, context, query = '') {
  await authenticate(context, 'mapLayers')
  await page.goto('/map' + query)
  await expect(page.locator('.gw-rmap--full')).toBeVisible()
}

test('map layers expand in place while the main navigation and camera stay unchanged', async ({ page, context }) => {
  await openMap(page, context, '?dungeons=0')

  const nav = page.getByRole('navigation', { name: 'Dashboard workspaces' })
  await expect(nav.getByRole('link', { name: 'Home' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Dungeons' })).toBeVisible()

  const map = page.locator('.gw-rmap--full')
  const stage = map.locator('.gw-rmap__stage')
  const before = await stage.boundingBox()
  const layers = map.getByRole('region', { name: 'Map layer controls' })
  const trigger = layers.getByRole('button', { name: /Map layers/ })
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')

  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(layers.getByRole('complementary', { name: 'Map legend' })).toBeVisible()
  const entrances = layers.getByRole('checkbox', { name: /Dungeon entrances/ })
  await expect(entrances).not.toBeChecked()
  await entrances.check()
  await expect(page).toHaveURL(/dungeons=1/)
  const expandedStage = await stage.boundingBox()
  expect(Math.abs(expandedStage.width - before.width)).toBeLessThan(1)
  expect(Math.abs(expandedStage.height - before.height)).toBeLessThan(1)

  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()
  await expect(entrances).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger).toBeFocused()

  await page.goto('/map')
  await page.locator('.gw-rmap--full .gw-rmap__layers-trigger').click()
  await expect(page.getByRole('checkbox', { name: /Dungeon entrances/ })).toBeChecked()
  await expect(page.getByRole('navigation', { name: 'Dashboard workspaces' }).getByRole('link', { name: 'Home' })).toBeVisible()
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the map button grows into a usable legend without horizontal overflow', async ({ page, context }) => {
    await openMap(page, context)
    const map = page.locator('.gw-rmap--full')
    const layers = map.getByRole('region', { name: 'Map layer controls' })
    const trigger = layers.getByRole('button', { name: /Map layers/ })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(async () => (await layers.boundingBox()).width).toBeGreaterThan(300)
    const bounds = await layers.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
    await expect(layers.getByRole('checkbox', { name: /Dungeon entrances/ })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
    await page.keyboard.press('Escape')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})
