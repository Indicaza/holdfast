import { expect, test } from '@playwright/test'

const scope = { gameBuild: '70338', locale: 'en_US' }
const cloth = { itemId: 2589, name: 'Linen Cloth', qualityId: 1, iconFileDataId: 132889, ...scope }
const robe = { itemId: 4343, name: 'Brown Linen Pants', qualityId: 1, ...scope }
const recipe = { recipeId: 3914, name: 'Brown Linen Pants', professionId: 197, professionName: 'Tailoring',
  craftedItemId: 4343, minQuantity: 1, maxQuantity: 1, reagents: [{ itemId: 2589, quantity: 2 }] }
function detail(item) {
  return { item: { ...item, tooltipLines: [{ left: item.name }, { left: 'Crafting Reagent' }] },
    sources: item.itemId === 2589 ? [{ activity: 'corpse_loot', discipline: 'loot', kind: 'creature', sourceId: 639,
      name: 'Edwin VanCleef', instanceId: 36, instanceName: 'The Deadmines', difficultyId: 1, mapId: 1436, observations: 12, observedQuantity: 37 }] : [],
    locations: [], createdBy: item.itemId === 4343 ? [recipe] : [], usedBy: item.itemId === 2589 ? [recipe] : [],
    references: [cloth, robe], truncated: {}, evidence: { note: 'Client-reported sightings. Loot visibility varies; missing items are not zero drops.' } }
}
async function mockCatalog(page) {
  await page.route('**/api/game-data/v1/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/scopes')) return route.fulfill({ json: { scopes: [{ ...scope, itemCount: 2 }, { gameBuild: '70339', locale: 'de_DE', itemCount: 1 }] } })
    if (url.pathname.endsWith('/2589')) return route.fulfill({ json: detail(cloth) })
    if (url.pathname.endsWith('/4343')) return route.fulfill({ json: detail(robe) })
    if (/\/items\/\d+$/.test(url.pathname)) return route.fulfill({ status: 404, json: { error: 'item_not_observed' } })
    const q = url.searchParams.get('q')?.toLowerCase() || ''
    return route.fulfill({ json: { items: [cloth, robe].filter((item) => item.name.toLowerCase().includes(q)), nextAfter: null } })
  })
}

test('public search → dungeon source → crafting use → ingredient, with reload and Back', async ({ page }, testInfo) => {
  await mockCatalog(page)
  await page.goto('/items')
  await expect(page.getByRole('heading', { name: 'Item catalog', exact: true })).toBeVisible()
  await page.getByLabel('Search items').fill('Linen Cloth')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page).toHaveURL(/q=Linen\+Cloth/)
  await expect(page.locator('.catalog-result')).toHaveCount(1)
  await page.locator('.catalog-result').click()
  await expect(page).toHaveURL(/\/items\/2589\?build=70338&locale=en_US/)
  await expect(page.getByRole('heading', { name: 'Where it was observed' })).toBeVisible()
  await expect(page.getByRole('table')).toContainText('Edwin VanCleef')
  await expect(page.getByRole('table')).toContainText('The Deadmines')
  await expect(page.getByRole('table')).toContainText('12 sightings')
  await expect(page.getByRole('table')).toContainText('37 units offered')
  await expect(page.locator('.catalog-caption')).toContainText(['Base item description', 'missing items are not zero drops'])
  const usedIn = page.locator('.catalog-panel').filter({ has: page.getByRole('heading', { name: 'Used in', exact: true }) })
  await usedIn.getByRole('link', { name: 'Brown Linen Pants' }).click()
  await expect(page).toHaveURL(/\/items\/4343/)
  await expect(page.locator('.catalog-panel').filter({ has: page.getByRole('heading', { name: 'Created by' }) })).toContainText('Tailoring')
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Brown Linen Pants' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1, name: 'Linen Cloth' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('item-catalog.png'), fullPage: true })
})

test('version filter, missing item and loading failure remain usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockCatalog(page)
  await page.goto('/items/2589?build=70338&locale=en_US')
  await page.getByLabel('Game version', { exact: true }).selectOption('70339/de_DE')
  await expect(page).toHaveURL(/build=70339&locale=de_DE/)
  await page.goto('/items/999?build=70338&locale=en_US')
  await expect(page.getByText('This item has not been observed in the selected game version.')).toBeVisible()
  await page.getByRole('link', { name: '← Browse items' }).click()
  await expect(page.locator('.catalog-result')).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.route('**/api/game-data/v1/items?**', (route) => route.fulfill({ status: 503, json: { error: 'unavailable' } }))
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Could not load the catalog')
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
})

test('empty catalog gives public visitors a clear starting point', async ({ page }) => {
  await page.route('**/api/game-data/v1/scopes', (route) => route.fulfill({ json: { scopes: [] } }))
  await page.goto('/items')
  await expect(page.getByText(/No game facts have synced yet/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeDisabled()
})
