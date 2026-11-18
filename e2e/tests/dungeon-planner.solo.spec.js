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

test('the dungeon modal: deep link, quick guide, prepare view, keyboard', async ({ page, context }) => {
  await signIn(page, context)
  await page.goto('/dashboard/dungeons')
  const opener = page.getByRole('link', { name: /^Deadmines/ })
  await opener.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Deadmines' })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/open=36/)

  await dialog.getByRole('button', { name: 'Prepare', exact: true }).click()
  await expect(page).toHaveURL(/section=prepare/)
  const danger = dialog.locator('[data-block="danger"]')
  await expect(danger).toContainText('Defias Wizard')
  // A Warrior can tank or deal damage: no role is assumed until one is picked.
  await expect(danger.getByRole('button', { name: 'All roles' })).toHaveAttribute('aria-pressed', 'true')
  await expect(danger.getByText('Classic reference — not verified for Forever').first()).toBeVisible()
  await expect(dialog.locator('[data-block="quests"]')).toContainText('The Defias Brotherhood')

  // Deep link straight to a boss.
  await page.goto('/dashboard/dungeons?open=36&section=bosses&boss=2746')
  const cookie = page.getByRole('article', { name: 'Cookie' })
  await cookie.getByRole('button', { name: 'Healer' }).click()
  const guide = cookie.getByRole('region', { name: 'Quick guide for healer' })
  await expect(guide.getByRole('listitem').first()).toContainText('Healer danger')
  await expect(cookie.getByText(/^All abilities/)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).not.toHaveURL(/open=/)
})

test('closing the modal returns focus to the card that opened it', async ({ page, context }) => {
  await signIn(page, context)
  await page.goto('/dashboard/dungeons')
  const opener = page.getByRole('link', { name: /^Deadmines/ })
  await opener.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Deadmines' })
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
  // Tab stays inside the dialog.
  for (let step = 0; step < 40; step += 1) await page.keyboard.press('Tab')
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('one-click wishlist on Classic reference boss loot', async ({ page, context }) => {
  await signIn(page, context)
  await withReferenceLoot(page)
  await page.goto('/dashboard/dungeons?open=36&section=bosses&boss=2747')
  const boss = page.getByRole('article', { name: 'Edwin VanCleef' })
  const shirt = boss.locator('li', { hasText: 'Corsair\'s Overshirt' })
  await expect(shirt.getByText('Classic reference', { exact: true })).toBeVisible()
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
  await page.goto('/dashboard/dungeons?open=36')
  const dialog = page.getByRole('dialog', { name: 'Deadmines' })
  await dialog.getByRole('button', { name: 'Plan my gear' }).click()
  await dialog.getByRole('radio', { name: 'Choose dungeons' }).click()
  await expect(dialog.getByRole('list', { name: 'Dungeons to plan' }).getByRole('checkbox', { name: /Deadmines/ })).toBeChecked()
  const prompt = page.waitForRequest((request) => request.url().includes('/ai-prompt'))
  await dialog.getByRole('button', { name: 'Copy AI planning prompt' }).click()
  expect(new URL((await prompt).url()).searchParams.get('dungeons')).toBe('36')
  await dialog.getByRole('textbox', { name: 'AI wishlist JSON' }).fill(JSON.stringify({ schemaVersion: 1, character: 'Plannerine', items: [{ itemId: 999999, name: 'Imaginary Blade', priority: 'high' }] }))
  await dialog.getByRole('button', { name: 'Check the JSON' }).click()
  await expect(dialog.getByText(/Not imported: \d+ problems? found/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Copy repair prompt' })).toBeVisible()
})

test('on a phone the modal is a full-screen sheet', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, context)
  await page.goto('/dashboard/dungeons?open=36&section=prepare')
  const panel = page.locator('.gw-atlas-modal__panel')
  await expect(panel).toBeVisible()
  const box = await panel.boundingBox()
  expect(box.width).toBeGreaterThanOrEqual(388)
  expect(box.x).toBeLessThanOrEqual(1)
  // Nothing in the sheet is wider than the screen.
  const overflow = await panel.evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
