import { expect, test } from '@playwright/test'

import { FIXTURE_DEADMINES_DETAIL } from '../../frontend/src/Player/Dungeons/__fixtures__/atlas.js'
import { authenticate } from '../helpers/auth.js'
import { connectAndSync } from '../helpers/player.js'

// The Dungeon Atlas planner against the real backend: atlas data from
// backend/src/Atlas/data/atlas.json (Deadmines, instance 36), a character
// synced through the bridge, the real wishlist and AI import endpoints.
// Sprint-2 reference loot is not required: one journey adds it to the
// real detail response with fixture data (route interception) to cover
// the wishlist toggle on Classic reference items.

const CHARACTER = { id: 'Player-planner-1', name: 'Plannerine', realm: 'E2E Realm', level: 20 }

// Pairs a computer and syncs the character once; later journeys reuse it.
async function signIn(page, context) {
  await authenticate(context, 'planner')
  await page.goto('/dashboard/dungeons')
  const synced = await page.evaluate(async (name) => {
    const response = await fetch('/api/player/characters')
    const body = response.ok ? await response.json() : null
    return Boolean(body?.characters?.some((character) => character.name === name))
  }, CHARACTER.name)
  if (!synced) await connectAndSync(page, { deviceName: 'Dungeon planner', characters: [CHARACTER] })
}

// Adds the fixture's sprint-2 fields (reference loot by boss name, quest
// details) to the real Deadmines detail.
async function withReferenceLoot(page) {
  const byName = new Map(FIXTURE_DEADMINES_DETAIL.atlas.bosses.map((boss) => [boss.name.toLowerCase(), boss.referenceLoot || []]))
  await page.route(/\/api\/player\/loot\/dungeons\/36$/, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    for (const boss of body.atlas?.bosses || []) boss.referenceLoot = byName.get(String(boss.name).toLowerCase()) || []
    await route.fulfill({ response, json: body })
  })
}

test('explore recommends dungeons for the character and says why', async ({ page, context }) => {
  await signIn(page, context)
  await page.goto('/dashboard/dungeons')
  const deadmines = page.getByRole('link', { name: /^Deadmines/ })
  const card = page.locator('li', { has: deadmines })
  // Wait for the character's facts (runs, wishlist) before filtering.
  await expect(card).toContainText('Not run yet')
  const recommended = page.getByRole('checkbox', { name: /Recommended for Plannerine/ })
  await recommended.click()
  await expect(page).toHaveURL(/rec=1/)
  await expect(recommended).toBeChecked()
  // ?character= is the page's character here: it never opens the armory.
  await expect(page).toHaveURL(/character=/)
  await expect(page.locator('.modal--armory')).toHaveCount(0)
  // Every card left is recommended and lists its reasons; level 20 suits Deadmines (15–28).
  await expect(card.getByText(/^Why:/)).toContainText('suits Plannerine (level 20)')
  for (const label of await page.locator('.gw-atlas-grid a').evaluateAll((links) => links.map((link) => link.getAttribute('aria-label')))) {
    expect(label).toMatch(/recommended$/)
  }
})

const dungeonPage = (page, name) => page.getByRole('region', { name, exact: true })

test('the dungeon page: deep link, quick guide, quests, keyboard', async ({ page, context }) => {
  await signIn(page, context)
  await page.goto('/dashboard/dungeons')
  const opener = page.getByRole('link', { name: /^Deadmines/ })
  await opener.focus()
  await page.keyboard.press('Enter')
  const dungeon = dungeonPage(page, 'Deadmines')
  await expect(dungeon).toBeVisible()
  await expect(page).toHaveURL(/open=36/)
  // A page, not a dialog: the grid is replaced and keyboard focus lands on its heading.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.gw-atlas-grid')).toHaveCount(0)
  await expect(dungeon.getByRole('heading', { name: 'Deadmines', exact: true })).toBeFocused()
  // Level 20 suits Deadmines (15–28).
  await expect(dungeon).toContainText('Good for Plannerine')
  // The overview's practical guide.
  await dungeon.getByRole('button', { name: 'Dungeon overview' }).click()
  await expect(dungeon.getByRole('region', { name: 'Dangerous trash' })).toContainText('Defias Wizard')
  await expect(dungeon.getByRole('navigation', { name: 'Bosses' })).toContainText('Edwin VanCleef')

  await dungeon.getByRole('button', { name: 'Quests', exact: true }).click()
  await expect(page).toHaveURL(/section=quests/)
  await expect(dungeon).toContainText('The Defias Brotherhood')

  // An old deep link straight to a boss still opens it, on the Overview.
  await page.goto('/dashboard/dungeons?open=36&section=bosses&boss=2746')
  const cookie = page.getByRole('article', { name: 'Cookie' })
  // A character whose role is not known: no role is assumed until one is picked.
  await cookie.locator('.gw-jw-mechanics > summary').click()
  await expect(cookie.getByRole('button', { name: 'All roles' })).toHaveAttribute('aria-pressed', 'true')
  await cookie.getByRole('button', { name: 'Healer' }).click()
  const guide = cookie.getByRole('region', { name: 'Quick guide for healer' })
  await expect(guide.getByRole('listitem').first()).toContainText('Healer danger')
  await expect(cookie.getByText(/^All abilities/)).toBeVisible()
  await expect(cookie.getByRole('region', { name: 'Cookie loot' })).toBeVisible()
  // Escape does not dismiss a page.
  await page.keyboard.press('Escape')
  await expect(dungeonPage(page, 'Deadmines')).toBeVisible()
})

test('Back returns to the grid, with focus on the card that opened the page', async ({ page, context }) => {
  await signIn(page, context)
  await page.goto('/dashboard/dungeons?kind=dungeon')
  const opener = page.getByRole('link', { name: /^Deadmines/ })
  await opener.focus()
  await page.keyboard.press('Enter')
  const dungeon = dungeonPage(page, 'Deadmines')
  await expect(dungeon).toBeVisible()
  await dungeon.getByRole('link', { name: 'All dungeons' }).click()
  await expect(dungeon).toHaveCount(0)
  await expect(page).toHaveURL(/kind=dungeon/)
  await expect(page).not.toHaveURL(/open=/)
  await expect(opener).toBeFocused()
  // The browser's Back works the same way.
  await opener.click()
  await expect(dungeon).toBeVisible()
  await page.goBack()
  await expect(dungeon).toHaveCount(0)
  await expect(page.getByRole('link', { name: /^Deadmines/ })).toBeVisible()
})

test('The Hall of Thanes: known boss names, level fit and loot by source', async ({ page, context }) => {
  await signIn(page, context)
  await page.goto('/dashboard/dungeons?open=3065')
  const thanes = dungeonPage(page, 'The Hall of Thanes')
  await expect(thanes).toContainText('Levels 13–20')
  await expect(thanes).toContainText('Good for Plannerine')
  const rail = thanes.getByRole('navigation', { name: 'Bosses' })
  for (const name of ['Faldrim Anvilmar', 'Infurnus', 'Plunder', 'Durgen Dirgehammer']) await expect(rail).toContainText(name)
  await expect(thanes).not.toContainText(/Creature \d+/)
  await thanes.getByRole('button', { name: 'All loot' }).click()
  const bosses = thanes.getByRole('region', { name: 'Bosses', exact: true })
  await expect(bosses.getByRole('region', { name: 'Faldrim Anvilmar loot' })).toBeVisible()
  // The boss's name opens its guide.
  await bosses.getByRole('region', { name: 'Faldrim Anvilmar loot' }).getByRole('button', { name: 'Faldrim Anvilmar' }).click()
  await expect(page).toHaveURL(/boss=261306/)
  await expect(thanes.locator('[data-source="boss:261306"]')).toHaveClass(/is-active/)
  await thanes.getByRole('button', { name: /Show Map/ }).click()
  await expect(page.getByRole('article', { name: 'Faldrim Anvilmar' })).toBeVisible()
})

test('the world map still opens a dungeon over the map', async ({ page, context }) => {
  await signIn(page, context)
  await page.goto('/map?open=36')
  const dialog = page.getByRole('dialog', { name: 'Deadmines' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).not.toHaveURL(/open=/)
})

test('one-click wishlist on Classic reference boss loot', async ({ page, context }) => {
  await signIn(page, context)
  await withReferenceLoot(page)
  await page.goto('/dashboard/dungeons?open=36&section=bosses&boss=2747')
  const boss = page.getByRole('article', { name: 'Edwin VanCleef' })
  const slot = boss.getByRole('button', { name: /^Corsair's Overshirt/ })
  // Hover shows the tooltip: no captured lines, so the reference facts, labelled as such.
  await slot.hover()
  await expect(page.getByRole('tooltip')).toContainText('Binds when picked up')
  await expect(page.getByRole('tooltip')).toContainText('Classic reference')
  // Where it drops belongs to the inspector, not the game's tooltip.
  await expect(page.getByRole('tooltip')).not.toContainText('Drops from')
  await slot.click()
  const shirt = page.getByRole('dialog', { name: "Corsair's Overshirt details" })
  await expect(shirt.locator('.gw-itempop__source').getByText('Classic reference', { exact: true })).toBeVisible()
  await expect(shirt).toContainText('From Edwin VanCleef')
  await shirt.getByText('Item facts').click()
  await expect(shirt).toContainText('Binds when picked up')
  await expect(shirt).toContainText('not verified for Forever')
  const toggle = shirt.getByRole('button', { name: 'Add Corsair\'s Overshirt to Plannerine\'s wishlist' })
  const put = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().includes('/items/i:5202'))
  await toggle.click()
  const response = await put
  expect(JSON.parse(response.request().postData())).toEqual({ sourceDungeon: 'Deadmines', sourceInstanceId: 36 })
  if (response.ok()) {
    // A backend with the sprint-2 reference catalog accepts it.
    await expect(shirt.getByRole('button', { name: /Remove Corsair's Overshirt/ })).toHaveAttribute('aria-pressed', 'true')
  } else {
    // Today's backend only knows observed items: it says so instead of failing silently.
    expect(response.status()).toBe(422)
    await expect(page.getByRole('alert')).toContainText('does not know Corsair\'s Overshirt yet')
  }
})

test('Plan my gear checks pasted JSON before anything is saved', async ({ page, context }) => {
  await signIn(page, context)
  await page.goto('/dashboard/dungeons?open=36&section=loot')
  const dungeon = dungeonPage(page, 'Deadmines')
  // One Plan my gear on the page, with the loot it plans from.
  await expect(dungeon.getByRole('button', { name: 'Plan my gear' })).toHaveCount(1)
  await dungeon.getByRole('button', { name: 'Plan my gear' }).click()
  await dungeon.getByRole('radio', { name: 'Choose dungeons' }).click()
  await expect(dungeon.getByRole('list', { name: 'Dungeons to plan' }).getByRole('checkbox', { name: /Deadmines/ })).toBeChecked()
  const prompt = page.waitForRequest((request) => request.url().includes('/ai-prompt'))
  await dungeon.getByRole('button', { name: 'Copy AI planning prompt' }).click()
  expect(new URL((await prompt).url()).searchParams.get('dungeons')).toBe('36')
  await dungeon.getByRole('textbox', { name: 'AI wishlist JSON' }).fill(JSON.stringify({ schemaVersion: 1, character: 'Plannerine', items: [{ itemId: 999999, name: 'Imaginary Blade', priority: 'high' }] }))
  await dungeon.getByRole('button', { name: 'Check the JSON' }).click()
  await expect(dungeon.getByText(/Not imported: \d+ problems? found/)).toBeVisible()
  await expect(dungeon.getByRole('button', { name: 'Copy repair prompt' })).toBeVisible()
})

test('on a phone the dungeon page fits the screen', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, context)
  await page.goto('/dashboard/dungeons?open=36&boss=2747')
  const dungeon = dungeonPage(page, 'Deadmines')
  await expect(dungeon).toBeVisible()
  await expect(page.getByRole('article', { name: 'Edwin VanCleef' })).toBeVisible()
  // Nothing on the page is wider than the screen.
  expect(await dungeon.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  await dungeon.getByRole('button', { name: 'All loot' }).click()
  await expect(dungeon.getByRole('region', { name: 'Edwin VanCleef loot' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
})
