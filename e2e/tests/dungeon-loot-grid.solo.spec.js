import { expect, test } from '@playwright/test'

import { authenticate } from '../helpers/auth.js'
import { connectAndSync } from '../helpers/player.js'

// Dungeon loot as an inventory against the real backend and the checked-in
// atlas: item slots in quality borders, the game's tooltip on hover and on
// keyboard focus, an item's details on press, and the wishlist only from there.

const CHARACTER = { id: 'Player-loot-browser-1', name: 'Lootine', realm: 'E2E Loot Realm', level: 20 }
let paired = false

async function signIn(page, context) {
  await authenticate(context, 'lootBrowser')
  await page.goto('/dashboard/dungeons')
  if (!paired) {
    await connectAndSync(page, { deviceName: 'Loot browser PC', characters: [CHARACTER] })
    paired = true
  }
}

const fitsViewport = async (locator, page) => {
  const box = await locator.boundingBox()
  const size = page.viewportSize()
  return box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height
}

test('Deadmines loot: slots per source, tooltip on hover and focus, details on press', async ({ page, context }) => {
  await signIn(page, context)
  await page.goto('/dashboard/dungeons?open=36&section=loot')
  const edwin = page.getByRole('region', { name: 'Edwin VanCleef loot', exact: true })
  const slots = edwin.getByRole('list', { name: 'Edwin VanCleef loot' }).getByRole('button')
  await expect(slots.first()).toBeVisible()
  // No item metadata printed under the slots.
  await expect(edwin.locator('.gw-atlas-loot__rates')).toHaveCount(0)
  const box = await slots.first().boundingBox()
  expect(box.width).toBeGreaterThanOrEqual(40)
  expect(box.width).toBeLessThanOrEqual(64)

  // Hover: the game's tooltip, inside the viewport.
  await slots.first().hover()
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip).toBeVisible()
  expect(await fitsViewport(tooltip, page)).toBe(true)
  await page.mouse.move(0, 0)
  await expect(tooltip).toHaveCount(0)

  // Keyboard: focus shows it, Enter opens the details, Escape closes them and returns focus.
  await slots.first().focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.keyboard.press('Enter')
  const details = page.getByRole('dialog', { name: /details$/ })
  await expect(details).toBeVisible()
  await expect(details.locator('.game-tooltip--card')).toBeVisible()
  await expect(details.getByRole('button', { name: /wishlist/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(details).toHaveCount(0)
  await expect(slots.first()).toBeFocused()
})

test('a tooltip near the right edge flips inside the window', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await signIn(page, context)
  await page.goto('/dashboard/dungeons?open=36&section=loot')
  const panels = page.locator('.gw-atlas-lootgroup__sources').first().locator('.gw-atlas-source')
  await expect(panels.first()).toBeVisible()
  // The right-most slot of the right-most panel in the first row.
  const rightmost = await panels.evaluateAll((elements) => {
    const slots = elements.flatMap((element) => [...element.querySelectorAll('button.gw-slot')])
    return slots.reduce((best, slot, index) => (slot.getBoundingClientRect().right > best.right ? { index, right: slot.getBoundingClientRect().right } : best), { index: 0, right: 0 }).index
  })
  const slot = panels.locator('button.gw-slot').nth(rightmost)
  await slot.scrollIntoViewIfNeeded()
  await slot.hover()
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip).toBeVisible()
  expect(await fitsViewport(tooltip, page)).toBe(true)
})

test('The Hall of Thanes: a boss\'s drops as slots, the pending tooltip, the wishlist from the details', async ({ page, context }) => {
  await signIn(page, context)
  await page.goto('/dashboard/dungeons?open=3065')
  await page.getByRole('navigation', { name: 'Bosses' }).getByRole('button', { name: /Faldrim Anvilmar/ }).click()
  const loot = page.getByRole('article', { name: 'Faldrim Anvilmar' }).getByRole('region', { name: 'Faldrim Anvilmar loot' })
  const slot = loot.getByRole('list', { name: 'Faldrim Anvilmar loot' }).getByRole('button').first()
  await expect(slot).toBeVisible()
  const name = (await slot.getAttribute('aria-label')).split(',')[0]
  await slot.hover()
  // No captured tooltip for these Forever items: their known facts, labelled, or the pending note; never invented lines.
  await expect(page.getByRole('tooltip')).toContainText(name)
  await expect(page.getByRole('tooltip')).toContainText(/WoW Forever reference|Classic reference|Full tooltip arrives once a Guildweaver player sees this item in game/)
  await expect(page.getByRole('tooltip')).not.toContainText(/Drops from|Click for|ForeverDB/)
  await slot.click()
  const details = page.getByRole('dialog', { name: `${name} details` })
  const add = details.getByRole('button', { name: `Add ${name} to Lootine's wishlist` })
  const put = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().includes('/wishlists/'))
  await add.click()
  const response = await put
  if (response.ok()) {
    await expect(details.getByRole('button', { name: `Remove ${name} from Lootine's wishlist` })).toHaveAttribute('aria-pressed', 'true')
    await expect(loot.getByRole('button', { name: `${name}, on the wishlist` })).toBeVisible()
  } else {
    expect(response.status()).toBe(422)
    await expect(page.getByRole('alert')).toContainText(`does not know ${name} yet`)
  }
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('a tap opens the item; the grid wraps without overflow', async ({ page, context }) => {
    await signIn(page, context)
    await page.goto('/dashboard/dungeons?open=36&section=loot')
    const edwin = page.getByRole('region', { name: 'Edwin VanCleef loot', exact: true })
    const slot = edwin.getByRole('list', { name: 'Edwin VanCleef loot' }).getByRole('button').first()
    await slot.scrollIntoViewIfNeeded()
    const box = await slot.boundingBox()
    expect(box.width).toBeGreaterThanOrEqual(44)
    await slot.tap()
    await expect(page.getByRole('dialog', { name: /details$/ })).toBeVisible()
    // The floating tooltip does not open on a tap: the details already show it.
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  })
})
