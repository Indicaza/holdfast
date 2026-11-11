import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'
import { ALLIANCE_SCANS, CATALOG, HORDE_SCANS, SAMPLE_SCANS, syncAuctionScans, syncItemDefinitions } from '../helpers/market.js'

// The Auction House, end to end, as WoW Forever's window: Buy (favorites
// when nothing is searched, search and categories showing what is on the
// chosen house), Sell and Shopping; a click selects, a double click opens an
// item window with every price level.

const ALLIANCE = 'game:us:normal:alliance'
const HORDE = 'game:us:normal:horde'
const frame = (page) => page.locator('.ah')
const results = (page) => page.getByRole('table', { name: 'Auction items' })
const rows = (page) => results(page).locator('tbody tr[data-row]')
const row = (page, name) => rows(page).filter({ hasText: name })
const nameBox = (page) => page.getByRole('combobox', { name: 'Name' })
const house = (page) => page.getByRole('combobox', { name: 'Auction house' })
const inspector = (page, name) => page.getByRole('dialog', { name: `${name} inspector` })
const tree = (page) => page.getByRole('navigation', { name: 'Categories' })
const categoryButton = (page, label) => tree(page).getByRole('button', { name: new RegExp(`^${label}\\s*\\d*$`) })
const tabs = (page) => page.getByRole('navigation', { name: 'Auction House' })

async function search(page, text) {
  await nameBox(page).fill(text)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(text).replace(/%20/g, '\\+')}`))
}

// The catalog and both houses of the Normal server. Safe to run again.
async function seed(page) {
  await syncItemDefinitions(page, { items: CATALOG })
  await syncAuctionScans(page, { deviceName: 'AH Alliance', faction: 'alliance', scans: ALLIANCE_SCANS })
  await syncAuctionScans(page, { deviceName: 'AH Horde', faction: 'horde', scans: HORDE_SCANS })
}

test('search shows what is on the chosen auction house, found by name or id', async ({ page, context }) => {
  await authenticate(context, 'trader')
  await page.goto('/dashboard/auctions')
  await expect(frame(page).getByText('No auction data yet.')).toBeVisible()
  await seed(page)
  await page.goto(`/dashboard/auctions?market=${encodeURIComponent(ALLIANCE)}`)
  await expect(frame(page).getByRole('heading', { name: 'Auction House' })).toBeVisible()
  // The game's tabs, and nothing else.
  await expect(tabs(page).getByRole('link')).toHaveText(['Buy', 'Sell', 'Shopping'])
  await expect(tabs(page).getByRole('link', { name: 'Buy' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText(/Updated .* ago/)).toBeVisible()
  // Home: favorites (none yet).
  await expect(page.getByText('No favorites yet.')).toBeVisible()

  // Azure Silk Gloves (4319), every way of asking for it, at this house's price.
  for (const text of ['Azure Silk Gloves', 'azure', 'AZURE SILK', 'gloves azure', '4319']) {
    await search(page, text)
    await expect(rows(page)).toHaveCount(1)
    await expect(row(page, 'Azure Silk Gloves').getByLabel('2g 60s 0c')).toBeVisible()
  }
  await expect(results(page).getByRole('columnheader')).toHaveText([/Price/, /Name/, /Available/, /Favorite/])
  // Hovering the name shows the game's tooltip.
  await row(page, 'Azure Silk Gloves').locator('.ah-item__name').hover()
  await expect(page.getByRole('tooltip')).toContainText('Binds when equipped')
  await expect(page.getByRole('tooltip')).toContainText('Requires Level 24')
  // Punctuation, typed or not.
  await search(page, 'raiders chestpiece')
  await expect(rows(page)).toHaveCount(2)
  await expect(row(page, 'of the Bear').getByLabel('5g 0s 0c')).toBeVisible()
  await expect(row(page, 'of the Eagle').getByLabel('90s 0c')).toBeVisible()
  // Known but not on this house: no rows, and it says so.
  await search(page, 'thorium')
  await expect(rows(page)).toHaveCount(0)
  await expect(page.getByText('No auctions for “thorium” on this auction house.')).toBeVisible()
  await expect(page.locator('.ah-known')).toContainText('Thorium Bar')
  await expect(page.locator('.ah-known')).toContainText('Not seen here')
  // Unknown.
  await search(page, 'xyzzy plugh')
  await expect(page.getByText('No item by that name or ID is known yet.')).toBeVisible()

  // The other faction's house of the same server: its own price.
  await search(page, 'azure silk gloves')
  await house(page).selectOption(HORDE)
  await expect(page).toHaveURL(/q=azure\+silk\+gloves/)
  await expect(row(page, 'Azure Silk Gloves').getByLabel('3g 15s 0c')).toBeVisible()
  await house(page).selectOption(ALLIANCE)
  await expect(row(page, 'Azure Silk Gloves').getByLabel('2g 60s 0c')).toBeVisible()

  // The window's Back and Forward walk the searches, as the browser's do.
  await search(page, 'linen')
  await search(page, 'copper')
  await expect(row(page, 'Copper Ore')).toHaveCount(1)
  const back = frame(page).getByRole('button', { name: 'Back', exact: true })
  const forward = frame(page).getByRole('button', { name: 'Forward', exact: true })
  await expect(forward).toBeDisabled()
  await back.click()
  await expect(nameBox(page)).toHaveValue('linen')
  await expect(row(page, 'Linen Cloth')).toHaveCount(1)
  await expect(forward).toBeEnabled()
  await forward.click()
  await expect(nameBox(page)).toHaveValue('copper')
  await page.goBack()
  await expect(nameBox(page)).toHaveValue('linen')
  await page.goForward()
  await expect(nameBox(page)).toHaveValue('copper')

  // A suggestion opens the item; Enter searches what is typed.
  await nameBox(page).fill('wool')
  await page.getByRole('listbox', { name: 'Suggestions' }).getByRole('option', { name: /Wool Cloth/ }).click()
  await expect(inspector(page, 'Wool Cloth')).toBeVisible()
  await expect(page).toHaveURL(/q=Wool\+Cloth/)
  await inspector(page, 'Wool Cloth').getByRole('button', { name: 'Close' }).click()
  await nameBox(page).fill('linen')
  await nameBox(page).press('Enter')
  await expect(row(page, 'Linen Cloth')).toHaveCount(1)

  // The favorites button goes home.
  await page.getByRole('button', { name: 'Show favorites' }).click()
  await expect(page).not.toHaveURL(/q=/)
  await expect(page.getByText('No favorites yet.')).toBeVisible()
})

test('a category opens without changing the results; only a leaf chooses what is shown', async ({ page, context }) => {
  await authenticate(context, 'trader')
  await page.goto(`/dashboard/auctions?market=${encodeURIComponent(ALLIANCE)}`)
  await seed(page)
  await page.reload()
  // WoW Forever's categories, in its order.
  await expect(tree(page).locator(':scope > ul > li > button .ah-cat__label')).toHaveText(['Weapons', 'Armor', 'Containers', 'Consumables', 'Trade Goods', 'Projectile',
    'Recipes', 'Quest Items', 'Miscellaneous'])
  // Opening Trade Goods only opens it: still the favorites.
  await categoryButton(page, 'Trade Goods').first().click()
  await expect(categoryButton(page, 'Trade Goods').first()).toHaveAttribute('aria-expanded', 'true')
  await expect(page).not.toHaveURL(/category=/)
  await expect(page.getByText('No favorites yet.')).toBeVisible()
  // "All Trade Goods" chooses the whole branch.
  await tree(page).getByRole('button', { name: 'All Trade Goods' }).click()
  await expect(page).toHaveURL(/category=trade-goods/)
  await expect(rows(page)).toHaveCount(3)
  await categoryButton(page, 'Cloth').click()
  await expect(page).toHaveURL(/category=trade-goods&sub=cloth/)
  await expect(rows(page)).toHaveText([/Linen Cloth/, /Wool Cloth/])
  await categoryButton(page, 'Metal & Stone').click()
  await expect(rows(page)).toHaveText([/Copper Ore/])
  // Opening Armor keeps Metal & Stone's results.
  const url = page.url()
  await categoryButton(page, 'Armor').click()
  await expect(categoryButton(page, 'Armor')).toHaveAttribute('aria-expanded', 'true')
  expect(page.url()).toBe(url)
  await expect(rows(page)).toHaveText([/Copper Ore/])
  // Armor › Cloth opens; Hands chooses the gloves, with the level column.
  await categoryButton(page, 'Cloth').first().click()
  expect(page.url()).toBe(url)
  await categoryButton(page, 'Hands').click()
  await expect(page).toHaveURL(/category=armor&sub=cloth&slot=hands/)
  await expect(rows(page)).toHaveText([/Azure Silk Gloves/])
  await expect(results(page).getByRole('columnheader')).toHaveText([/Price/, /Name/, /Req\. Lvl/, /Available/, /Favorite/])
  await expect(row(page, 'Azure Silk Gloves').locator('.ah-col-detail')).toHaveText('24')
  // Back returns to Metal & Stone; the branches stay open.
  await frame(page).getByRole('button', { name: 'Back', exact: true }).click()
  await expect(rows(page)).toHaveText([/Copper Ore/])
  await expect(categoryButton(page, 'Hands')).toBeVisible()
  // Sorting.
  await tree(page).getByRole('button', { name: 'All Trade Goods' }).click()
  await results(page).getByRole('button', { name: /^Price/ }).click()
  await expect(results(page).getByRole('columnheader', { name: /Price/ })).toHaveAttribute('aria-sort', 'ascending')
  await expect(rows(page).first()).toContainText('Copper Ore')
  await results(page).getByRole('button', { name: /^Available/ }).click()
  await expect(rows(page).first()).toContainText('Linen Cloth')
  await results(page).getByRole('button', { name: /^Name/ }).click()
  await expect(rows(page)).toHaveText([/Copper Ore/, /Linen Cloth/, /Wool Cloth/])
  // Closing a branch closes only that branch.
  await categoryButton(page, 'Trade Goods').first().click()
  await expect(tree(page).getByRole('button', { name: 'All Trade Goods' })).toHaveCount(0)
  await expect(rows(page)).toHaveCount(3)
})

test('a click selects, a double click opens a window with every price level', async ({ page, context }) => {
  await authenticate(context, 'trader')
  await page.setViewportSize({ width: 1400, height: 760 })
  await page.goto(`/dashboard/auctions?market=${encodeURIComponent(ALLIANCE)}`)
  await seed(page)
  await page.goto(`/dashboard/auctions?market=${encodeURIComponent(ALLIANCE)}&q=practice&sort=name`)
  const table = page.locator('.ah-table-wrap')
  await row(page, 'Practice Token 10').click()
  await expect(row(page, 'Practice Token 10')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Selected item')).toContainText('Practice Token 10')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // The selection is kept in the link (a refresh keeps it) but is not a step.
  await expect(page).toHaveURL(/sel=i%3A990010/)
  await expect(frame(page).getByRole('button', { name: 'Back', exact: true })).toBeDisabled()
  // Scroll and selection survive a window opening and closing.
  await row(page, 'Practice Token 30').dblclick()
  await expect(inspector(page, 'Practice Token 30')).toBeVisible()
  const scrolled = await table.evaluate((element) => element.scrollTop)
  expect(scrolled).toBeGreaterThan(0)
  await inspector(page, 'Practice Token 30').getByRole('button', { name: 'Close' }).click()
  expect(await table.evaluate((element) => element.scrollTop)).toBe(scrolled)
  await expect(row(page, 'Practice Token 30')).toHaveAttribute('aria-selected', 'true')

  await search(page, 'azure')
  await row(page, 'Azure Silk Gloves').dblclick()
  const gloves = inspector(page, 'Azure Silk Gloves')
  await expect(gloves.getByText('Uncommon · Item Level 29 · Requires Level 24', { exact: false })).toBeVisible()
  await expect(gloves.getByRole('term').filter({ hasText: /^Lowest buyout$/ })).toBeVisible()
  await expect(gloves.getByRole('button', { name: 'Add to favorites' })).toBeVisible()
  await expect(gloves.getByRole('button', { name: 'Add to list' })).toBeVisible()
  await expect(gloves.getByRole('tab')).toHaveText(['Prices', 'History'])
  // The price levels: unit price, available, auctions. No sellers.
  const levels = gloves.getByRole('table', { name: 'Price levels' })
  await expect(levels.getByRole('columnheader')).toHaveText(['Unit Price', 'Available', 'Auctions', 'Share'])
  await expect(levels.locator('tbody tr')).toHaveCount(1)
  await expect(gloves.getByText('Sellers are not reported by Blizzard or the add-on.')).toBeVisible()
  // Hovering the item's icon shows its tooltip.
  await gloves.locator('.ah-item-header .ah-item__icon').hover()
  await expect(page.getByRole('tooltip')).toContainText('Binds when equipped')
  // Drag by the title bar, resize from the corner.
  const before = await gloves.boundingBox()
  const bar = await gloves.locator('.gw-insp__bar').boundingBox()
  await page.mouse.move(bar.x + 200, bar.y + 15)
  await page.mouse.down()
  await page.mouse.move(bar.x - 100, bar.y + 35, { steps: 6 })
  await page.mouse.up()
  const moved = await gloves.boundingBox()
  expect(Math.round(moved.x - before.x)).toBe(-300)
  expect(Math.round(moved.y - before.y)).toBe(20)
  const corner = await gloves.locator('.gw-insp__resize').boundingBox()
  await page.mouse.move(corner.x + 8, corner.y + 8)
  await page.mouse.down()
  await page.mouse.move(corner.x + 68, corner.y - 52, { steps: 6 })
  await page.mouse.up()
  const resized = await gloves.boundingBox()
  expect(Math.round(resized.width - moved.width)).toBe(60)
  expect(Math.round(resized.height - moved.height)).toBe(-60)

  // A new search keeps the window; a second one opens beside it.
  await search(page, 'linen')
  await expect(gloves).toBeVisible()
  await row(page, 'Linen Cloth').dblclick({ position: { x: 40, y: 10 } })
  const linen = inspector(page, 'Linen Cloth')
  await expect(page.getByRole('dialog')).toHaveCount(2)
  await linen.getByRole('tab', { name: 'History' }).click()
  await expect(linen.getByRole('tabpanel', { name: 'History' })).toBeVisible()
  const z = (locator) => locator.evaluate((element) => Number(getComputedStyle(element).zIndex))
  expect(await z(linen)).toBeGreaterThan(await z(gloves))
  await gloves.locator('.ah-facts').click({ position: { x: 8, y: 4 } })
  expect(await z(gloves)).toBeGreaterThan(await z(linen))
  // Opening an open item focuses it: no duplicate.
  await row(page, 'Linen Cloth').dblclick({ position: { x: 40, y: 10 } })
  await expect(page.getByRole('dialog')).toHaveCount(2)
  await expect(linen).toBeFocused()
  // Escape closes the window on top.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(nameBox(page)).toHaveValue('linen')
  // Windows come back after a refresh; reset and close all.
  await page.reload()
  await expect(gloves).toBeVisible()
  await page.getByRole('button', { name: 'Reset windows' }).click()
  await page.getByRole('button', { name: 'Close all' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Variants open their own windows.
  await search(page, 'raiders chestpiece')
  await row(page, 'of the Bear').dblclick()
  await expect(inspector(page, "Raider's Chestpiece of the Bear")).toBeVisible()
  // A Dungeon Companion item link opens the item; an item-catalog history link opens History.
  await page.goto('/dashboard/auctions?q=Linen+Cloth&item=2589')
  await expect(inspector(page, 'Linen Cloth')).toBeVisible()
  await expect(page).not.toHaveURL(/item=2589/)
  await expect(row(page, 'Linen Cloth')).toHaveCount(1)
  await page.goto('/dashboard/auctions?tab=history&item=2592')
  await expect(inspector(page, 'Wool Cloth').getByRole('tabpanel', { name: 'History' })).toBeVisible()
})

test('favorites are the home screen and the dashboard card, with this house\'s prices, and private', async ({ page, context, request }) => {
  await authenticate(context, 'trader')
  await page.goto('/dashboard/auctions')
  await syncAuctionScans(page, { deviceName: 'AH PC 2', scans: SAMPLE_SCANS })
  await page.goto(`/dashboard/auctions?market=${encodeURIComponent(ALLIANCE)}&q=linen`)
  await row(page, 'Linen Cloth').click()
  await page.keyboard.press('f')
  await expect(row(page, 'Linen Cloth').getByRole('button', { name: 'Remove from favorites' })).toBeVisible()
  await search(page, 'wool')
  await row(page, 'Wool Cloth').getByRole('button', { name: 'Add to favorites' }).click()
  await expect(row(page, 'Wool Cloth').getByRole('button', { name: 'Remove from favorites' })).toBeVisible()
  await page.getByRole('button', { name: 'Show favorites' }).click()
  await expect(frame(page).getByText('Favorites', { exact: true })).toBeVisible()
  await expect(rows(page)).toHaveCount(2)
  await expect(row(page, 'Wool Cloth')).toHaveCount(1)
  await expect(row(page, 'Linen Cloth').locator('.gw-coins')).toBeVisible()
  // Two price levels, and adding them up.
  await row(page, 'Linen Cloth').dblclick()
  const linen = inspector(page, 'Linen Cloth')
  const levels = linen.getByRole('table', { name: 'Price levels' })
  await expect(levels.locator('tbody tr')).toHaveCount(2)
  await levels.locator('tbody tr').nth(1).click()
  await expect(linen.getByRole('status')).toContainText('500')
  // History in the item's window.
  await linen.getByRole('tab', { name: 'History' }).click()
  await expect(linen.getByRole('img', { name: /Asking price per unit over time/ })).toBeVisible()
  await expect(linen.getByRole('rowheader', { name: 'Median, 7 days' })).toBeVisible()
  await linen.getByRole('button', { name: 'Close' }).click()
  // Leaving and coming back from the menu keeps the screen.
  await page.getByRole('link', { name: /^Characters/ }).first().click()
  await page.getByRole('navigation', { name: 'Dashboard workspaces' }).getByRole('link', { name: /^Auction House/ }).click()
  await expect(rows(page)).toHaveCount(2)
  // The dashboard's home shows the favorites, and nothing else from the Auction House.
  await page.goto('/dashboard')
  const card = page.locator('#gw-ah-favorites')
  await expect(card.getByRole('heading', { name: 'Auction House favorites' })).toBeVisible()
  await expect(card.locator('.ah-home__list li')).toHaveCount(2)
  await expect(card.locator('.ah-home__list li').filter({ hasText: 'Wool Cloth' })).toBeVisible()
  await card.getByRole('link', { name: 'Open Linen Cloth in the Auction House' }).click()
  await expect(inspector(page, 'Linen Cloth')).toBeVisible()

  // Another player sees prices but none of this.
  const anonymous = await request.get('/api/market/favorites', { headers: { Cookie: '' } })
  expect(anonymous.status()).toBe(401)
  await authenticate(context, 'rival')
  await page.goto(`/dashboard/auctions?market=${encodeURIComponent(ALLIANCE)}`)
  await expect(page.getByText('No favorites yet.')).toBeVisible()
})

test('sell shows an item\'s price levels and a price to start from; shopping lists add up', async ({ page, context }) => {
  await authenticate(context, 'shopper')
  await page.goto(`/dashboard/auctions?market=${encodeURIComponent(ALLIANCE)}`)
  await seed(page)
  await page.reload()
  await tabs(page).getByRole('link', { name: 'Sell' }).click()
  await expect(page).toHaveURL(/tab=sell/)
  await page.getByRole('combobox', { name: 'Item to sell' }).fill('copper')
  await page.getByRole('listbox', { name: 'Items' }).getByRole('option', { name: /Copper Ore/ }).click()
  await expect(page).toHaveURL(/tab=sell&.*item=2770/)
  const pane = page.getByRole('region', { name: 'Item prices' })
  await expect(pane.locator('.ah-item-header')).toContainText('Copper Ore')
  await expect(pane.getByRole('term').filter({ hasText: /^Undercut price$/ })).toBeVisible()
  await expect(pane.getByLabel('69c').first()).toBeVisible()
  await expect(pane.getByRole('table', { name: 'Price levels' }).locator('tbody tr')).toHaveCount(1)
  // Back to Buy: the search tab as it was.
  await tabs(page).getByRole('link', { name: 'Buy' }).click()
  await expect(page.getByText('No favorites yet.')).toBeVisible()

  await tabs(page).getByRole('link', { name: 'Shopping' }).click()
  await expect(page.getByRole('region', { name: 'Shopping lists' })).toBeVisible()
  await page.getByRole('textbox', { name: 'New list name' }).fill('Tailoring')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { name: 'Tailoring' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Add an item' }).fill('copper')
  await page.getByRole('listbox', { name: 'Items' }).getByRole('option', { name: /Copper Ore/ }).click()
  const list = page.getByRole('table', { name: 'Tailoring items' })
  await expect(list.locator('tbody tr')).toHaveCount(1)
  await list.getByRole('spinbutton', { name: 'Copper Ore quantity' }).fill('20')
  await list.getByRole('spinbutton', { name: 'Copper Ore quantity' }).blur()
  await expect(page.locator('.ah-list-total').getByLabel('14s 0c')).toBeVisible()
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
  await expect(page.getByText('Not configured')).toBeVisible()
  await frame(page).getByRole('link', { name: 'Back to the Auction House' }).click()
  await expect(page).not.toHaveURL(/tab=diagnostics/)
})
