import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'
import { connectAndSync } from '../helpers/player.js'

// A Discord player with no guild, end to end: first run, first sync, their
// characters by server, the armory, devices, and nobody else's data.

const account = (page, name = 'Pip Player') => page.getByRole('button', { name: `Account menu for ${name}` })
const rail = (page) => page.getByRole('navigation', { name: 'Dashboard workspaces' })
const heading = (page) => page.locator('.gw-top h1')

test('signed out, the dashboard asks for Discord and private data stays private', async ({ page, request }) => {
  await page.goto('/dashboard/characters')
  await expect(page.getByRole('heading', { name: 'Your dashboard' })).toBeVisible()
  await expect(page.locator('main').getByRole('button', { name: 'Sign in with Discord' })).toBeVisible()
  for (const route of ['/api/player/overview', '/api/player/characters', '/api/player/devices', '/api/player/farming']) {
    expect((await request.get(route)).status(), route).toBe(401)
  }
})

test('a new player follows the first-run checklist to their first sync, then sees characters by server', async ({ page, context }) => {
  await authenticate(context, 'player')
  await page.goto('/dashboard')
  await expect(account(page)).toBeVisible()
  await expect(heading(page)).toHaveText('Home')
  await expect(page.getByRole('heading', { name: 'Three steps to your first sync.' })).toBeVisible()
  await expect(page.getByText('Connect a computer to start syncing.')).toBeVisible()
  await expect(page.getByText('so uploads arrive at those moments', { exact: false })).toBeVisible()
  await expect(rail(page).getByRole('link')).toHaveText([/^Home/, /^Drop rates/, /^Characters/, /^Professions/, /^My gathering/, /^Sync/])
  // Community drop rates are there before the player has synced anything.
  await expect(page.getByRole('heading', { name: 'What are you farming today?' })).toBeVisible()

  await connectAndSync(page, {
    deviceName: 'Pip desktop',
    characters: [
      { id: 'pip-rook', name: 'Rook', realm: 'Doomhowl', level: 42 },
      { id: 'pip-fern', name: 'Fern', realm: 'Doomhowl', level: 18 },
      { id: 'pip-rook-sm', name: 'Rook', realm: 'Shadowmoon', level: 60 },
    ],
    gathers: [{ id: 'pip-herb-1', characterId: 'pip-rook', realm: 'Doomhowl' }],
  })

  // Live updates replace the checklist with the overview.
  await expect(page.getByRole('heading', { name: 'Your characters' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Three steps to your first sync.' })).toHaveCount(0)
  const scorecards = page.getByRole('region', { name: 'Your summary' })
  await expect(scorecards.locator('article').filter({ hasText: 'Your characters' }).locator('strong')).toHaveText('3')
  // Most recently synced first.
  await expect(page.getByLabel('Server').locator('option')).toHaveText(['All servers', 'Shadowmoon (1)', 'Doomhowl (2)'])

  // The server choice filters every tool and survives navigation.
  await page.getByLabel('Server').selectOption({ label: 'Doomhowl (2)' })
  await expect(page).toHaveURL(/\/dashboard\?server=us%3Adoomhowl$/)
  await rail(page).getByRole('link', { name: /^Characters/ }).click()
  await expect(page).toHaveURL(/\/dashboard\/characters\?server=us%3Adoomhowl$/)
  await expect(heading(page)).toHaveText('Characters')
  await expect(page.locator('.gw-char')).toHaveCount(2)
  await expect(page.locator('.gw-char').filter({ hasText: 'Rook' })).toHaveCount(1)

  await rail(page).getByRole('link', { name: /^My gathering/ }).click()
  await expect(heading(page)).toHaveText('My gathering')
  await expect(page.getByRole('region', { name: 'Your farming summary' })).toContainText('1')

  // The gather is in the community drop rates too; its source opens as a page.
  await rail(page).getByRole('link', { name: /^Drop rates/ }).click()
  await expect(heading(page)).toHaveText('Drop rates')
  const sources = page.getByRole('table', { name: 'Sources' })
  await sources.getByRole('link', { name: /Peacebloom/ }).click()
  await expect(page).toHaveURL(/\/dashboard\/farming\?source=herbalism/)
  await expect(page.getByRole('heading', { name: 'Peacebloom', exact: true })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Drop table' })).toContainText('100%')
  // Its map opens on the zone it was gathered in, with the spot's in-game
  // coordinates.
  const sourceMap = page.getByRole('region', { name: 'Resource map' })
  await expect(sourceMap.getByRole('navigation', { name: 'Map location' })).toContainText('Elwynn Forest')
  await expect(sourceMap.getByRole('region', { name: 'Busiest spots in Elwynn Forest' })).toContainText('42.0, 65.0')
  await page.goBack()
  await expect(sources).toBeVisible()

  // The full resource map is in the navbar; its legend is the dashboard's
  // sidebar, which folds to a rail of resource toggles.
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Map', exact: true }).click()
  await expect(page).toHaveURL(/\/map(\?|$)/)
  await expect(heading(page)).toHaveText('Resource map')
  const legend = page.getByRole('complementary', { name: 'Map legend' })
  await expect(legend).toContainText('1 of 1 shown')
  await legend.getByRole('checkbox', { name: /Peacebloom/ }).uncheck()
  await expect(legend).toContainText('0 of 1 shown')
  await legend.getByRole('button', { name: 'Show all' }).click()
  await page.getByRole('button', { name: 'Collapse the sidebar' }).first().click()
  await expect(legend.getByRole('button', { name: 'Hide Peacebloom' })).toBeVisible()
  await page.getByRole('button', { name: 'Expand the sidebar' }).first().click()
  await expect(legend).toContainText('1 of 1 shown')
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.getByRole('application').focus()
  await page.keyboard.press('0')
  await expect(page.getByRole('navigation', { name: 'Map location' })).toHaveText('Azeroth')

  // Back to the dashboard, whose sidebar is its navigation again.
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Dashboard', exact: true }).click()
  await rail(page).getByRole('link', { name: /^My gathering/ }).click()
  await expect(page.getByRole('region', { name: 'Your farming summary' })).toContainText('1')

  await page.getByLabel('Server').selectOption({ label: 'Shadowmoon (1)' })
  await expect(page.getByText('No farming on this server yet.')).toBeVisible()

  // A fresh visit remembers the server; a server the player lacks falls back
  // to the remembered one, and All servers clears the memory.
  await page.goto('/dashboard/characters')
  await expect(page).toHaveURL(/server=us%3Ashadowmoon/)
  await expect(page.locator('.gw-char')).toHaveCount(1)
  await page.goto('/dashboard/characters?server=eu%3Asomewhere-else')
  await expect(page).toHaveURL(/server=us%3Ashadowmoon/)
  await page.getByLabel('Server').selectOption({ label: 'All servers' })
  await expect(page).toHaveURL((url) => !url.search.includes('server='))
  await expect(page.locator('.gw-char')).toHaveCount(3)
  await page.reload()
  await expect(page.locator('.gw-char')).toHaveCount(3)

  // The armory opens in place from the player's own data.
  await page.locator('.gw-char').filter({ hasText: 'Fern' }).click()
  await expect(page).toHaveURL(/character=/)
  await expect(page.getByRole('dialog', { name: 'Fern' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('another player cannot list, open or disconnect this player\'s things, even with direct links', async ({ page, context, browser }) => {
  await authenticate(context, 'player')
  await page.goto('/dashboard/characters')
  await expect(page.locator('.gw-char').first()).toBeVisible()
  const ownCharacter = await page.evaluate(async () => (await (await fetch('/api/player/characters')).json()).characters[0].id)
  const ownDevice = await page.evaluate(async () => (await (await fetch('/api/player/devices')).json()).devices[0].id)

  const rivalContext = await browser.newContext()
  await authenticate(rivalContext, 'rival')
  const rival = await rivalContext.newPage()
  await rival.goto(`/dashboard/characters?character=${encodeURIComponent(ownCharacter)}`)
  await expect(account(rival, 'Rex Rival')).toBeVisible()
  await expect(rival.locator('.gw-char')).toHaveCount(0)
  await expect(rival.getByRole('heading', { name: 'Character not found.' })).toBeVisible()
  const probes = await rival.evaluate(async ({ ownCharacter, ownDevice }) => ({
    armory: (await fetch(`/api/player/characters/${encodeURIComponent(ownCharacter)}`)).status,
    recipes: (await fetch(`/api/player/characters/${encodeURIComponent(ownCharacter)}/recipes`)).status,
    guildArmory: (await fetch(`/api/intelligence/characters/${encodeURIComponent(ownCharacter)}`)).status,
    disconnect: (await fetch(`/api/player/devices/${ownDevice}/disconnect`, { method: 'POST' })).status,
    devices: (await (await fetch('/api/player/devices')).json()).devices.length,
    admin: (await fetch('/api/admin/guildweaver/summary')).status,
  }), { ownCharacter, ownDevice })
  expect(probes).toEqual({ armory: 404, recipes: 404, guildArmory: 404, disconnect: 404, devices: 0, admin: 403 })
  await rivalContext.close()

  // The player's computer still works.
  const devices = await page.evaluate(async () => (await (await fetch('/api/player/devices')).json()).devices)
  expect(devices.map((device) => device.status)).toEqual(['connected'])
})

test('the avatar menu reaches every personal view and signing out leaves nothing behind', async ({ page, context }) => {
  await authenticate(context, 'player')
  await page.goto('/dashboard/characters')
  await expect(page.locator('.gw-char').first()).toBeVisible()

  await account(page).focus()
  await page.keyboard.press('Enter')
  const menu = page.getByRole('menu', { name: 'Account' })
  await expect(menu.getByRole('menuitem')).toHaveText(['My Overview', 'My Characters', 'My Devices & Sync', 'Account & Privacy', 'Sign out'])
  await expect(menu.getByRole('menuitem', { name: 'My Overview' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'My Characters' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(account(page)).toBeFocused()
  await expect(account(page)).toHaveAttribute('aria-expanded', 'false')

  await account(page).click()
  await menu.getByRole('menuitem', { name: 'Account & Privacy' }).click()
  await expect(page).toHaveURL(/\/account$/)
  await expect(account(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('heading', { name: 'Signed in with Discord' })).toBeVisible()
  await expect(page.locator('main').getByText('@e2e-player')).toBeVisible()
  await expect(page.locator('main')).not.toContainText(/Holdfast|rank|guild nickname/i)

  await account(page).click()
  await menu.getByRole('menuitem', { name: 'My Devices & Sync' }).click()
  await expect(heading(page)).toHaveText('Sync')
  await expect(page.locator('.gw-device')).toHaveCount(1)

  await account(page).click()
  await menu.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page.locator('.navbar').getByRole('button', { name: 'Sign in with Discord' })).toBeVisible()
  await expect(page.locator('.gw-device')).toHaveCount(0)
  await page.locator('.navbar').getByRole('link', { name: 'Dashboard' }).click()
  await expect(page.getByRole('heading', { name: 'Your dashboard' })).toBeVisible()
  await expect(page.locator('.gw-char')).toHaveCount(0)
})

test('on a phone the site menu, the dashboard drawer and the avatar menu all work', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await authenticate(context, 'player')
  await page.goto('/dashboard')
  await expect(account(page)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)

  const siteMenu = page.getByRole('button', { name: 'Toggle navigation' })
  await siteMenu.click()
  const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' })
  await expect(mobileNav.getByRole('link', { name: 'Download' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(siteMenu).toHaveAttribute('aria-expanded', 'false')
  await expect(siteMenu).toBeFocused()

  await page.getByRole('button', { name: 'Open dashboard navigation' }).click()
  await rail(page).getByRole('link', { name: /^Characters/ }).click()
  await expect(heading(page)).toHaveText('Characters')
  await expect(page.locator('.gw--mobile-open')).toHaveCount(0)

  await account(page).click()
  await page.getByRole('menu', { name: 'Account' }).getByRole('menuitem', { name: 'My Overview' }).click()
  await expect(heading(page)).toHaveText('Home')
})

test('disconnecting a computer asks first, then stops it uploading', async ({ page, context }) => {
  await authenticate(context, 'player')
  await page.goto('/dashboard/sync')
  await expect(page.locator('.gw-device')).toHaveCount(1)
  await connectAndSync(page, { deviceName: 'Old laptop' })
  await expect(page.locator('.gw-device')).toHaveCount(2)
  const laptop = page.locator('.gw-device').filter({ hasText: 'Old laptop' })
  await laptop.getByRole('button', { name: 'Disconnect' }).click()
  const dialog = page.getByRole('dialog', { name: 'Disconnect Old laptop?' })
  await expect(dialog).toContainText('stops working at once')
  await dialog.getByRole('button', { name: 'Keep connected' }).click()
  await expect(laptop.locator('.gw-tag')).toHaveText('Connected')

  await laptop.getByRole('button', { name: 'Disconnect' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(laptop.locator('.gw-tag')).toHaveText('Disconnected')
  await expect(page.locator('.gw-device').filter({ hasText: 'Pip desktop' }).locator('.gw-tag')).toHaveText('Connected')
})
