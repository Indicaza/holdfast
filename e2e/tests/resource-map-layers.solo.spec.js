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

test('map links update waypoints, filtered resources and entrance pins without remounting', async ({ page, context }) => {
  await openMap(page, context, '?zone=1436&mark=0.55,0.48&label=First+stop&discipline=herbalism&dungeons=0')
  const map = page.locator('.gw-rmap--full')
  await expect(map.getByRole('button', { name: 'First stop (marked spot)' })).toBeVisible()
  await expect(map.getByText('Community gathering · All realms')).toBeVisible()
  await map.evaluate((node) => { node.dataset.navigationProbe = 'retained' })

  const layers = map.getByRole('region', { name: 'Map layer controls' })
  const toggle = layers.getByRole('button', { name: /Map layers/ })
  await toggle.click()
  const hiddenResource = layers.getByRole('checkbox', { name: /Show .* on the map/ }).first()
  await expect(hiddenResource).toBeVisible()
  const resourceName = await hiddenResource.getAttribute('aria-label')
  await hiddenResource.uncheck()

  await page.evaluate(() => {
    window.history.pushState({}, '', '/map?zone=1436&mark=0.57,0.50&label=Second+stop&discipline=herbalism&dungeons=1')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(map).toHaveAttribute('data-navigation-probe', 'retained')
  await expect(map.getByRole('button', { name: 'Second stop (marked spot)' })).toBeVisible()
  await expect(map.getByRole('button', { name: 'First stop (marked spot)' })).toHaveCount(0)
  await expect(layers.getByRole('checkbox', { name: /Dungeon entrances/ })).toBeChecked()

  await page.getByRole('link', { name: 'Clear resource filters' }).click()
  await expect(page).not.toHaveURL(/discipline=/)
  await expect(page).toHaveURL(/mark=0.57/)
  await expect(page).toHaveURL(/dungeons=1/)
  await expect(map).toHaveAttribute('data-navigation-probe', 'retained')
  await expect(map.getByRole('button', { name: 'Second stop (marked spot)' })).toBeVisible()
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
  await expect(layers.getByRole('checkbox', { name: resourceName, exact: true })).not.toBeChecked()
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
