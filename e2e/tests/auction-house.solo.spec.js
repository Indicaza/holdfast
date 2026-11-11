import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'
import { ALLIANCE_SCANS, CATALOG, HORDE_SCANS, SAMPLE_SCANS, syncAuctionScans, syncItemDefinitions } from '../helpers/market.js'

// The Auction House, end to end, laid out like the game's: search any known
// item (listed or not), browse categories, select with a click, inspect with
// a double click in floating windows; favorites, shopping lists, history and
// diagnostics for administrators.

const ALLIANCE = 'game:us:normal:alliance'
const HORDE = 'game:us:normal:horde'
const frame = (page) => page.locator('.gw-ahf')
const tabs = (page) => page.getByRole('navigation', { name: 'Auction House' })
const results = (page) => page.getByRole('table', { name: 'Auction items' })
const rows = (page) => results(page).locator('tbody tr[data-row]')
const row = (page, name) => rows(page).filter({ hasText: name })
const nameBox = (page) => page.getByRole('combobox', { name: 'Name' })
const inspector = (page, name) => page.getByRole('dialog', { name: `${name} inspector` })
const tree = (page) => page.getByRole('navigation', { name: 'Categories' })
const category = (page, label) => page.locator('.gw-ahf__tree > li').filter({ has: page.getByRole('button', { name: new RegExp(`^${label}`) }) })

async function search(page, text) {
  await nameBox(page).fill(text)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(text).replace(/%20/g, '\\+').replace(/[()]/g, '\\$&')}`))
}

// Seeds the catalog and both markets. Safe to run again: the same scans and
// descriptions are recognised as already received.
async function seed(page) {
  await syncItemDefinitions(page, { items: CATALOG })
  await syncAuctionScans(page, { deviceName: 'AH Alliance', faction: 'alliance', scans: ALLIANCE_SCANS })
  await syncAuctionScans(page, { deviceName: 'AH Horde', faction: 'horde', scans: HORDE_SCANS })
}

test('search finds any known item by name or id, listed or not, with this market\'s listings only', async ({ page, context }) => {
  await authenticate(context, 'trader')
  await page.goto('/dashboard/auctions')
  await expect(frame(page).getByText('No market data yet.')).toBeVisible()
  await seed(page)
  await page.goto(`/dashboard/auctions?market=${encodeURIComponent(ALLIANCE)}`)
  await expect(frame(page).getByRole('heading', { name: 'Browse Auctions' })).toBeVisible()
  await expect(tabs(page).getByRole('link')).toHaveText(['Browse', 'Appraiser', 'Shopping Lists', 'Favorites', 'History'])
  await expect(page.getByText(/Checked .* ago/)).toBeVisible()
  // Browse: this market's listings, never catalog entries.
  await expect(results(page).getByRole('columnheader')).toHaveText([/Price/, /Name/, /Available/, /Favorite/])
  await expect(row(page, 'Azure Silk Gloves')).toHaveCount(1)
  await expect(row(page, 'Thorium Bar')).toHaveCount(0)

  // Azure Silk Gloves (4319), a listed item, every way of asking for it.
  for (const text of ['Azure Silk Gloves', 'azure', 'AZURE SILK', 'gloves azure', '4319']) {
    await search(page, text)
    await expect(row(page, 'Azure Silk Gloves')).toHaveCount(1)
    await expect(row(page, 'Azure Silk Gloves').getByLabel('2g 60s 0c')).toBeVisible()
  }
  // Punctuation: an apostrophe typed or not.
  await search(page, 'finkles lava')
  await expect(row(page, "Finkle's Lava Dredger")).toHaveCount(1)
  // A known item nobody listed here: found, without a price, and said so.
  await search(page, 'thorium')
  await expect(row(page, 'Thorium Bar')).toContainText('Not seen here')
  await expect(page.getByText('Partial coverage', { exact: false })).toBeVisible()
  await expect(results(page).getByText('Known items without listings seen in this market')).toBeVisible()
  // Listed only hides it.
  await page.getByLabel('Listed only').click()
  await expect(page).toHaveURL(/listed=1/)
  await expect(page.getByText('No listings match “thorium” in this market.')).toBeVisible()
  await page.getByRole('button', { name: 'Show items without listings' }).click()
  await expect(row(page, 'Thorium Bar')).toHaveCount(1)
  // Variants: one row each, each at its own price.
  await search(page, 'raiders chestpiece')
  await expect(rows(page)).toHaveCount(2)
  await expect(row(page, 'of the Bear').getByLabel('5g 0s 0c')).toBeVisible()
  await expect(row(page, 'of the Eagle').getByLabel('90s 0c')).toBeVisible()
  // No match.
  await search(page, 'xyzzy plugh')
  await expect(page.getByText('No known item matches “xyzzy plugh”.')).toBeVisible()

  // Changing the market keeps the search and shows that market's price.
  await search(page, 'azure silk gloves')
  await page.getByRole('combobox', { name: 'Market' }).selectOption(HORDE)
  await expect(page).toHaveURL(/q=azure\+silk\+gloves/)
  await expect(page).toHaveURL(new RegExp(`market=${encodeURIComponent(HORDE)}`))
  await expect(row(page, 'Azure Silk Gloves').getByLabel('3g 15s 0c')).toBeVisible()
  await page.getByRole('combobox', { name: 'Market' }).selectOption(ALLIANCE)
  await expect(row(page, 'Azure Silk Gloves').getByLabel('2g 60s 0c')).toBeVisible()

  // Back and Forward walk the searches.
  await search(page, 'linen')
  await search(page, 'copper')
  await expect(row(page, 'Copper Ore')).toHaveCount(1)
  await page.goBack()
  await expect(page).toHaveURL(/q=linen/)
  await expect(nameBox(page)).toHaveValue('linen')
  await expect(row(page, 'Linen Cloth')).toHaveCount(1)
  await page.goForward()
  await expect(nameBox(page)).toHaveValue('copper')
  await expect(row(page, 'Copper Ore')).toHaveCount(1)

  // A suggestion opens the right item; Enter searches what is typed.
  await nameBox(page).fill('thor')
  await page.getByRole('listbox', { name: 'Suggestions' }).getByRole('option', { name: /Thorium Bar/ }).click()
  await expect(inspector(page, 'Thorium Bar')).toBeVisible()
  await expect(inspector(page, 'Thorium Bar').getByText(/Not seen in .* yet/)).toBeVisible()
  await expect(page).toHaveURL(/q=Thorium\+Bar/)
  await inspector(page, 'Thorium Bar').getByRole('button', { name: 'Close' }).click()
  await nameBox(page).fill('wool')
  await nameBox(page).press('Enter')
  await expect(page).toHaveURL(/q=wool/)
  await expect(row(page, 'Wool Cloth')).toHaveCount(1)

  // Reset returns to browsing.
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(page).not.toHaveURL(/q=/)
  await expect(nameBox(page)).toHaveValue('')
  await expect(row(page, 'Practice Token 01')).toHaveCount(1)
})

test('categories come from item classes, stay visible, and filter in place', async ({ page, context }) => {
  await authenticate(context, 'trader')
  await page.goto(`/dashboard/auctions?market=${encodeURIComponent(ALLIANCE)}`)
  await seed(page)
  await page.reload()
  for (const label of ['Weapons', 'Armor', 'Containers', 'Gems', 'Item Enhancements', 'Consumables', 'Glyphs', 'Trade Goods', 'Recipes', 'Miscellaneous']) {
    await expect(tree(page).getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible()
  }
  await tree(page).getByRole('button', { name: 'Expand Trade Goods' }).click()
  await category(page, 'Trade Goods').getByRole('button', { name: /^Cloth/ }).click()
  await expect(page).toHaveURL(/category=trade-goods&sub=cloth/)
  await expect(rows(page)).toHaveText([/Linen Cloth/, /Wool Cloth/])
  await category(page, 'Trade Goods').getByRole('button', { name: /^Metal & Stone/ }).click()
  await expect(page).toHaveURL(/sub=metal-stone/)
  await expect(rows(page)).toHaveText([/Copper Ore/])
  // A search filtered by the category: catalog matches in it too.
  await search(page, 'bar')
  await expect(row(page, 'Thorium Bar')).toHaveCount(1)
  await expect(row(page, 'Azure Silk Gloves')).toHaveCount(0)
  // Categories with nothing listed are still there; the open branch stays open.
  await expect(category(page, 'Trade Goods').getByRole('button', { name: /^Herbs/ })).toBeVisible()
  await expect(tree(page).getByRole('button', { name: /^Glyphs/ })).toBeVisible()
  // Sorting by price, then by name, then by quantity.
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(page).not.toHaveURL(/category=/)
  await expect(category(page, 'Trade Goods').getByRole('button', { name: /^Cloth/ })).toBeVisible()
  await results(page).getByRole('button', { name: /^Price/ }).click()
  await expect(results(page).getByRole('columnheader', { name: /Price/ })).toHaveAttribute('aria-sort', 'ascending')
  await expect(rows(page).first()).toContainText('Practice Token 01')
  await results(page).getByRole('button', { name: /^Available/ }).click()
  await expect(results(page).getByRole('columnheader', { name: /Available/ })).toHaveAttribute('aria-sort', 'descending')
  await expect(rows(page).first()).toContainText('Linen Cloth')
  await results(page).getByRole('button', { name: /^Name/ }).click()
  await expect(rows(page).first()).toContainText('Azure Silk Gloves')
  // Optional columns are off until chosen.
  await expect(results(page).getByRole('columnheader', { name: /Req/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Columns' }).click()
  await page.getByLabel('Required level').check()
  await expect(results(page).getByRole('columnheader', { name: /Req/ })).toBeVisible()
})

test('one click selects, a double click opens an inspector you can move, resize, stack and close', async ({ page, context }) => {
  await authenticate(context, 'trader')
  await page.setViewportSize({ width: 1400, height: 720 })
  await page.goto(`/dashboard/auctions?market=${encodeURIComponent(ALLIANCE)}`)
  await seed(page)
  await page.goto(`/dashboard/auctions?market=${encodeURIComponent(ALLIANCE)}&sort=name`)
  // Scroll the table, then select with one click: nothing navigates.
  const table = page.locator('.gw-ahf__tablewrap')
  await table.evaluate((element) => { element.scrollTop = 160 })
  const url = page.url()
  await row(page, 'Practice Token 10').click()
  await expect(row(page, 'Practice Token 10')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Selected item')).toContainText('Practice Token 10')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(page.url()).toBe(url)

  // Double click: an inspector with the tooltip, price and actions.
  await search(page, 'silk')
  await row(page, 'Azure Silk Gloves').dblclick()
  const gloves = inspector(page, 'Azure Silk Gloves')
  await expect(gloves).toBeVisible()
  await expect(gloves.getByLabel('Item tooltip')).toContainText('Binds when equipped')
  await expect(gloves.getByRole('term').filter({ hasText: /^Lowest ask$/ })).toBeVisible()
  await expect(gloves.getByText('Uncommon · Item level 29 · Requires level 24', { exact: false })).toBeVisible()
  await expect(gloves.getByRole('button', { name: 'Add to favorites' })).toBeVisible()
  await expect(gloves.getByRole('button', { name: '+ List' })).toBeVisible()
  // Drag by the title bar.
  const before = await gloves.boundingBox()
  const bar = gloves.locator('.gw-insp__bar')
  const barBox = await bar.boundingBox()
  await page.mouse.move(barBox.x + 80, barBox.y + 15)
  await page.mouse.down()
  await page.mouse.move(barBox.x - 220, barBox.y + 35, { steps: 6 })
  await page.mouse.up()
  const moved = await gloves.boundingBox()
  expect(Math.round(moved.x - before.x)).toBe(-300)
  expect(Math.round(moved.y - before.y)).toBe(20)
  // Resize from the corner.
  const corner = await gloves.locator('.gw-insp__resize').boundingBox()
  await page.mouse.move(corner.x + 8, corner.y + 8)
  await page.mouse.down()
  await page.mouse.move(corner.x + 68, corner.y - 52, { steps: 6 })
  await page.mouse.up()
  const resized = await gloves.boundingBox()
  expect(Math.round(resized.width - moved.width)).toBe(60)
  expect(Math.round(resized.height - moved.height)).toBe(-60)

  // A second inspector beside it; clicking a window brings it forward.
  // (The moved window covers part of the table, as a window would.)
  await row(page, 'Silk Cloth').dblclick({ position: { x: 40, y: 10 } })
  const cloth = inspector(page, 'Silk Cloth')
  await expect(cloth).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(2)
  // History on demand, in its own tab.
  await cloth.getByRole('tab', { name: 'History' }).click()
  await expect(cloth.getByRole('tabpanel', { name: 'History' })).toBeVisible()
  const z = (locator) => locator.evaluate((element) => Number(getComputedStyle(element).zIndex))
  expect(await z(cloth)).toBeGreaterThan(await z(gloves))
  await gloves.locator('.gw-insp__facts').click({ position: { x: 8, y: 4 } })
  expect(await z(gloves)).toBeGreaterThan(await z(cloth))
  // Double-clicking an open item focuses it: no duplicate.
  await row(page, 'Azure Silk Gloves').dblclick({ position: { x: 40, y: 10 } })
  await expect(page.getByRole('dialog')).toHaveCount(2)
  await expect(gloves).toBeFocused()
  // Closing one leaves the other, the search and the filters.
  await cloth.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(gloves).toBeVisible()
  await expect(nameBox(page)).toHaveValue('silk')
  await expect(page).toHaveURL(/q=silk/)
  // Opened windows come back after a refresh; reset tidies them.
  await page.reload()
  await expect(inspector(page, 'Azure Silk Gloves')).toBeVisible()
  await page.getByRole('button', { name: 'Reset positions' }).click()
  await page.getByRole('button', { name: 'Close all' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(nameBox(page)).toHaveValue('silk')

  // Scroll and selection survive an inspector opening and closing.
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(row(page, 'Practice Token 20')).toHaveCount(1)
  await row(page, 'Practice Token 12').dblclick()
  await expect(inspector(page, 'Practice Token 12')).toBeVisible()
  const scrolled = await table.evaluate((element) => element.scrollTop)
  expect(scrolled).toBeGreaterThan(0)
  await inspector(page, 'Practice Token 12').getByRole('button', { name: 'Close' }).click()
  expect(await table.evaluate((element) => element.scrollTop)).toBe(scrolled)
  await expect(row(page, 'Practice Token 12')).toHaveAttribute('aria-selected', 'true')

  // Variants open their own windows.
  await search(page, 'raiders chestpiece')
  await row(page, 'of the Bear').dblclick()
  await expect(inspector(page, "Raider's Chestpiece of the Bear")).toBeVisible()
  await expect(inspector(page, "Raider's Chestpiece of the Bear").getByRole('term').filter({ hasText: /^Lowest ask$/ })).toBeVisible()

  // A link to an item (Dungeon Companion loot) opens its inspector.
  await page.goto('/dashboard/auctions?q=Linen+Cloth&item=2589')
  await expect(inspector(page, 'Linen Cloth')).toBeVisible()
  await expect(page).not.toHaveURL(/item=2589/)
  await expect(row(page, 'Linen Cloth')).toHaveCount(1)
  // Switching tabs keeps the search and the windows.
  await tabs(page).getByRole('link', { name: 'Favorites' }).click()
  await expect(inspector(page, 'Linen Cloth')).toBeVisible()
  await tabs(page).getByRole('link', { name: 'Browse' }).click()
  await expect(nameBox(page)).toHaveValue('Linen Cloth')
})

test('favorites, shopping lists and history are the player\'s own', async ({ page, context, request }) => {
  await authenticate(context, 'trader')
  await page.goto('/dashboard/auctions')
  await syncAuctionScans(page, { deviceName: 'AH PC 2', scans: SAMPLE_SCANS })
  await page.goto(`/dashboard/auctions?market=${encodeURIComponent(ALLIANCE)}&q=linen`)
  await row(page, 'Linen Cloth').click()

  // From the selected item: add to a new shopping list, then favorite.
  await page.getByLabel('Selected item').getByRole('button', { name: '+ List' }).click()
  await page.getByLabel('Selected item').getByLabel('Quantity').fill('40')
  await page.getByLabel('Selected item').getByRole('button', { name: 'Add', exact: true }).click()
  await page.keyboard.press('f')
  await expect(row(page, 'Linen Cloth').getByRole('button', { name: 'Remove from favorites' })).toBeVisible()
  await tabs(page).getByRole('link', { name: 'Shopping Lists' }).click()
  await expect(frame(page).getByRole('heading', { name: 'Shopping Lists' })).toBeVisible()
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

  // Leaving and coming back from the menu restores the last search.
  await tabs(page).getByRole('link', { name: 'Browse' }).click()
  await page.getByRole('link', { name: /^Characters/ }).first().click()
  await page.getByRole('navigation', { name: 'Dashboard workspaces' }).getByRole('link', { name: /^Auction House/ }).click()
  await expect(page).toHaveURL(/q=linen/)

  // Another player sees prices but none of this.
  const rival = await request.get('/api/market/favorites', { headers: { Cookie: '' } })
  expect(rival.status()).toBe(401)
  await authenticate(context, 'rival')
  await page.goto('/dashboard/auctions?tab=favorites')
  await expect(page.getByText('No favorites yet.')).toBeVisible()
  await tabs(page).getByRole('link', { name: 'Shopping Lists' }).click()
  await expect(page.getByText('No shopping lists yet.')).toBeVisible()
})

test('diagnostics are for administrators only, out of the way', async ({ page, context }) => {
  await authenticate(context, 'trader')
  await page.goto('/dashboard/auctions?tab=diagnostics')
  await expect(frame(page).getByRole('link', { name: 'Diagnostics' })).toHaveCount(0)
  expect((await page.request.get('/api/market/admin/diagnostics')).status()).toBe(403)
  await authenticate(context, 'commander')
  await page.goto('/dashboard/auctions')
  await frame(page).getByRole('link', { name: 'Diagnostics' }).click()
  await expect(page).toHaveURL(/tab=diagnostics/)
  await expect(page.getByRole('heading', { name: 'Market identity' })).toBeVisible()
  await expect(page.getByText('In-game market not linked to an API house', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('Not configured')).toBeVisible()
})
