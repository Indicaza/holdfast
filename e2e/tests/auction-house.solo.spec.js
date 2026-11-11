import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'
import { ALLIANCE_SCANS, CATALOG, HORDE_SCANS, SAMPLE_SCANS, syncAuctionScans, syncItemDefinitions } from '../helpers/market.js'

// The Auction House, end to end, as one screen like the game's: favorites
// when nothing is searched, search and categories showing what is on the
// chosen house, a click to select, a double click to open an item window.

const ALLIANCE = 'game:us:normal:alliance'
const HORDE = 'game:us:normal:horde'
const frame = (page) => page.locator('.gw-ahf')
const results = (page) => page.getByRole('table', { name: 'Auction items' })
const rows = (page) => results(page).locator('tbody tr[data-row]')
const row = (page, name) => rows(page).filter({ hasText: name })
const nameBox = (page) => page.getByRole('combobox', { name: 'Name' })
const house = (page) => page.getByRole('combobox', { name: 'Auction house' })
const inspector = (page, name) => page.getByRole('dialog', { name: `${name} inspector` })
const tree = (page) => page.getByRole('navigation', { name: 'Categories' })
const category = (page, label) => page.locator('.gw-ahf__tree > li').filter({ has: page.getByRole('button', { name: new RegExp(`^${label}`) }) })

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
  // One screen: no tabs.
  await expect(page.getByRole('navigation', { name: 'Auction House' })).toHaveCount(0)
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
  // Punctuation, typed or not.
  await search(page, 'raiders chestpiece')
  await expect(rows(page)).toHaveCount(2)
  await expect(row(page, 'of the Bear').getByLabel('5g 0s 0c')).toBeVisible()
  await expect(row(page, 'of the Eagle').getByLabel('90s 0c')).toBeVisible()
  // Known but not on this house: no rows, and it says so.
  await search(page, 'thorium')
  await expect(rows(page)).toHaveCount(0)
  await expect(page.getByText('No auctions for “thorium” on this auction house.')).toBeVisible()
  await expect(page.locator('.gw-ahf__known')).toContainText('Thorium Bar')
  await expect(page.locator('.gw-ahf__known')).toContainText('Not seen here')
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

  // Back and Forward walk the searches.
  await search(page, 'linen')
  await search(page, 'copper')
  await expect(row(page, 'Copper Ore')).toHaveCount(1)
  await page.goBack()
  await expect(nameBox(page)).toHaveValue('linen')
  await expect(row(page, 'Linen Cloth')).toHaveCount(1)
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

  // Reset goes home.
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(page).not.toHaveURL(/q=/)
  await expect(page.getByText('No favorites yet.')).toBeVisible()
})

test('categories filter what is on the house; sort by price, name and quantity', async ({ page, context }) => {
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
  await expect(rows(page)).toHaveText([/Copper Ore/])
  await category(page, 'Trade Goods').getByRole('button', { name: /^Trade Goods/ }).click()
  await expect(rows(page)).toHaveCount(3)
  await results(page).getByRole('button', { name: /^Price/ }).click()
  await expect(results(page).getByRole('columnheader', { name: /Price/ })).toHaveAttribute('aria-sort', 'ascending')
  await expect(rows(page).first()).toContainText('Copper Ore')
  await results(page).getByRole('button', { name: /^Available/ }).click()
  await expect(rows(page).first()).toContainText('Linen Cloth')
  await results(page).getByRole('button', { name: /^Name/ }).click()
  await expect(rows(page)).toHaveText([/Copper Ore/, /Linen Cloth/, /Wool Cloth/])
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(page).not.toHaveURL(/category=/)
  await expect(category(page, 'Trade Goods').getByRole('button', { name: /^Cloth/ }).first()).toBeVisible()
})

test('a click selects, a double click opens a window you can move, resize, stack and close', async ({ page, context }) => {
  await authenticate(context, 'trader')
  await page.setViewportSize({ width: 1400, height: 720 })
  await page.goto(`/dashboard/auctions?market=${encodeURIComponent(ALLIANCE)}`)
  await seed(page)
  await page.goto(`/dashboard/auctions?market=${encodeURIComponent(ALLIANCE)}&q=practice&sort=name`)
  const table = page.locator('.gw-ahf__tablewrap')
  const url = page.url()
  await row(page, 'Practice Token 10').click()
  await expect(row(page, 'Practice Token 10')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Selected item')).toContainText('Practice Token 10')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(page.url()).toBe(url)
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
  await expect(gloves.getByLabel('Item tooltip')).toContainText('Binds when equipped')
  await expect(gloves.getByRole('term').filter({ hasText: /^Lowest ask$/ })).toBeVisible()
  await expect(gloves.getByText('Uncommon · Item level 29 · Requires level 24', { exact: false })).toBeVisible()
  await expect(gloves.getByRole('button', { name: 'Add to favorites' })).toBeVisible()
  await expect(gloves.getByRole('tab')).toHaveText(['Overview', 'History'])
  // Drag by the title bar, resize from the corner.
  const before = await gloves.boundingBox()
  const bar = await gloves.locator('.gw-insp__bar').boundingBox()
  await page.mouse.move(bar.x + 80, bar.y + 15)
  await page.mouse.down()
  await page.mouse.move(bar.x - 220, bar.y + 35, { steps: 6 })
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
  await gloves.locator('.gw-insp__facts').click({ position: { x: 8, y: 4 } })
  expect(await z(gloves)).toBeGreaterThan(await z(linen))
  // Opening an open item focuses it: no duplicate.
  await row(page, 'Linen Cloth').dblclick({ position: { x: 40, y: 10 } })
  await expect(page.getByRole('dialog')).toHaveCount(2)
  await expect(linen).toBeFocused()
  await linen.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(nameBox(page)).toHaveValue('linen')
  // Windows come back after a refresh; reset and close all.
  await page.reload()
  await expect(gloves).toBeVisible()
  await page.getByRole('button', { name: 'Reset positions' }).click()
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

test('favorites are the home screen, with this house\'s prices, and private', async ({ page, context, request }) => {
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
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(frame(page).getByText('Favorites', { exact: true })).toBeVisible()
  await expect(rows(page)).toHaveCount(2)
  await expect(row(page, 'Wool Cloth')).toHaveCount(1)
  await expect(row(page, 'Linen Cloth').locator('.gw-coins')).toBeVisible()
  // History in the item's window.
  await row(page, 'Linen Cloth').dblclick()
  await inspector(page, 'Linen Cloth').getByRole('tab', { name: 'History' }).click()
  await expect(inspector(page, 'Linen Cloth').getByRole('img', { name: /Asking price per unit over time/ })).toBeVisible()
  await expect(inspector(page, 'Linen Cloth').getByRole('rowheader', { name: 'Median, 7 days' })).toBeVisible()
  // Leaving and coming back from the menu keeps the screen.
  await page.getByRole('link', { name: /^Characters/ }).first().click()
  await page.getByRole('navigation', { name: 'Dashboard workspaces' }).getByRole('link', { name: /^Auction House/ }).click()
  await expect(rows(page)).toHaveCount(2)

  // Another player sees prices but none of this.
  const anonymous = await request.get('/api/market/favorites', { headers: { Cookie: '' } })
  expect(anonymous.status()).toBe(401)
  await authenticate(context, 'rival')
  await page.goto(`/dashboard/auctions?market=${encodeURIComponent(ALLIANCE)}`)
  await expect(page.getByText('No favorites yet.')).toBeVisible()
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
