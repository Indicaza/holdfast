import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'
import { SAMPLE_SCANS, syncAuctionScans } from '../helpers/market.js'

// The Auction House, end to end: prices from in-game scans, the
// game-like Browse frame, the item drawer, favorites, shopping lists,
// history, and diagnostics for administrators only.

const frame = (page) => page.locator('.gw-ahf')
const tabs = (page) => page.getByRole('navigation', { name: 'Auction House' })
const results = (page) => page.getByRole('table', { name: 'Auction items' })
const drawer = (page) => page.getByRole('complementary', { name: 'Item market' })

test('browse like the game: search, filter, sort, open an item, keys, and the search is remembered', async ({ page, context }) => {
  await authenticate(context, 'trader')
  await page.goto('/dashboard/auctions')
  await expect(frame(page).getByText('No market data yet.')).toBeVisible()
  await syncAuctionScans(page, { scans: SAMPLE_SCANS })
  await page.reload()

  await expect(frame(page).getByRole('heading', { name: 'Browse Auctions' })).toBeVisible()
  await expect(tabs(page).getByRole('link')).toHaveText(['Browse', 'Appraiser', 'Shopping', 'Favorites', 'History'])
  await expect(page.getByText(/Checked .* ago/)).toBeVisible()
  await expect(results(page).locator('tbody tr')).toHaveCount(3)
  await expect(page.getByText('Items 1 - 3 (3 total)')).toBeVisible()
  await expect(results(page).getByText("Raider's Chestpiece of the Bear")).toHaveCount(1)

  // Suggestions while typing, Enter searches.
  const name = page.getByRole('combobox', { name: 'Name' })
  await name.fill('lin')
  await expect(page.getByRole('listbox', { name: 'Suggestions' }).getByRole('option', { name: /Linen Cloth/ })).toBeVisible()
  await name.press('Enter')
  await expect(page).toHaveURL(/q=lin/)
  await expect(results(page).locator('tbody tr')).toHaveCount(1)
  await name.press('Escape')
  await expect(name).toHaveValue('lin')

  // Open the item: price, the cheapest listings, history, and why.
  await results(page).getByText('Linen Cloth').click()
  await expect(drawer(page)).toBeVisible()
  await expect(drawer(page).getByRole('term').filter({ hasText: /^Lowest ask$/ })).toBeVisible()
  await expect(drawer(page).getByRole('heading', { name: /Cheapest listings/ })).toBeVisible()
  await expect(drawer(page).getByText('In-game scan from', { exact: false })).toBeVisible()
  await drawer(page).getByRole('group', { name: 'Time range' }).getByRole('button', { name: '24h' }).click()
  await expect(page).toHaveURL(/range=24h/)
  await expect(drawer(page).getByRole('img', { name: /Asking price per unit over time/ })).toBeVisible()
  await expect(page.getByLabel('Selected item').getByText('Linen Cloth')).toBeVisible()

  // Keys: Esc closes, F favorites the selected row.
  await name.blur()
  await page.keyboard.press('Escape')
  await expect(drawer(page)).toHaveCount(0)
  await page.keyboard.press('f')
  await expect(results(page).getByRole('button', { name: 'Remove from favorites' })).toBeVisible()

  // Rarity and sorting.
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(results(page).locator('tbody tr')).toHaveCount(3)
  await page.getByLabel('Rarity').selectOption({ label: 'Uncommon' })
  await expect(results(page).locator('tbody tr')).toHaveCount(1)
  await page.getByLabel('Rarity').selectOption({ label: 'All' })
  await results(page).getByRole('button', { name: /^Price/ }).click()
  await expect(results(page).getByRole('columnheader', { name: /Price/ })).toHaveAttribute('aria-sort', 'ascending')
  await expect(results(page).locator('tbody tr').first()).toContainText('Linen Cloth')

  // Leaving and coming back from the menu restores the last search.
  await page.getByRole('link', { name: /^Characters/ }).first().click()
  await page.getByRole('navigation', { name: 'Dashboard workspaces' }).getByRole('link', { name: /^Auction House/ }).click()
  await expect(page).toHaveURL(/sort=price/)
})

test('favorites, shopping lists and history are the player\'s own', async ({ page, context, request }) => {
  await authenticate(context, 'trader')
  await page.goto('/dashboard/auctions')
  await syncAuctionScans(page, { deviceName: 'AH PC 2', scans: SAMPLE_SCANS })
  await page.goto('/dashboard/auctions?q=linen')
  await results(page).getByText('Linen Cloth').click()

  // From the action bar: add to a new shopping list.
  await page.getByLabel('Selected item').getByRole('button', { name: '+ List' }).click()
  await page.getByLabel('Selected item').getByLabel('Quantity').fill('40')
  await page.getByLabel('Selected item').getByRole('button', { name: 'Add', exact: true }).click()
  await tabs(page).getByRole('link', { name: 'Shopping' }).click()
  await expect(frame(page).getByRole('heading', { name: 'Shopping' })).toBeVisible()
  const list = page.getByRole('region', { name: 'Shopping list' })
  await expect(list.getByText('Linen Cloth')).toBeVisible()
  await expect(list.getByText('Estimated total')).toBeVisible()
  await list.getByRole('button', { name: 'Bought all' }).click()
  await expect(list.locator('tr.is-done')).toHaveCount(1)

  // Favorites with metrics and a target price.
  await tabs(page).getByRole('link', { name: 'Favorites' }).click()
  const favorites = page.getByRole('region', { name: 'Favorites' })
  await expect(favorites.getByText('Linen Cloth')).toBeVisible()
  await favorites.getByLabel('Target price in gold for Linen Cloth').fill('0.01')
  await favorites.getByLabel('Target price in gold for Linen Cloth').blur()
  await expect(favorites.locator('tr.is-target')).toHaveCount(1)

  // History: chart, metrics with their windows, and honest gaps.
  await favorites.getByRole('link', { name: 'History' }).click()
  await expect(page).toHaveURL(/tab=history/)
  const history = page.getByRole('region', { name: 'Price history' })
  await expect(history.getByRole('img', { name: /Asking price per unit over time/ })).toBeVisible()
  await expect(history.getByRole('rowheader', { name: 'Median, 7 days' })).toBeVisible()
  await expect(history.getByText('Needs at least 6 observed hours over 2 days.')).toBeVisible()
  await history.getByRole('group', { name: 'Time range' }).getByRole('button', { name: 'All' }).click()
  await expect(page).toHaveURL(/range=all/)

  // Another player sees prices but none of this.
  const rival = await request.get('/api/market/favorites', { headers: { Cookie: '' } })
  expect(rival.status()).toBe(401)
  await authenticate(context, 'rival')
  await page.goto('/dashboard/auctions?tab=favorites')
  await expect(page.getByText('No favorites yet.')).toBeVisible()
  await tabs(page).getByRole('link', { name: 'Shopping' }).click()
  await expect(page.getByText('No shopping lists yet.')).toBeVisible()
})

test('diagnostics are for administrators only', async ({ page, context }) => {
  await authenticate(context, 'trader')
  await page.goto('/dashboard/auctions?tab=diagnostics')
  await expect(tabs(page).getByRole('link', { name: 'Diagnostics' })).toHaveCount(0)
  expect((await page.request.get('/api/market/admin/diagnostics')).status()).toBe(403)
  await authenticate(context, 'commander')
  await page.goto('/dashboard/auctions?tab=diagnostics')
  await expect(tabs(page).getByRole('link', { name: 'Diagnostics' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Market identity' })).toBeVisible()
  await expect(page.getByText('In-game market not linked to an API house', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('Not configured')).toBeVisible()
})
