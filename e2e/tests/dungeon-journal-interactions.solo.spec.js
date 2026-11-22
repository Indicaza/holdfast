import { expect, test } from '@playwright/test'

import { authenticate } from '../helpers/auth.js'
import { connectAndSync } from '../helpers/player.js'

// The Dungeon Journal's item interactions measured in a real browser: slots
// that never move, a tooltip that mounts once per hover and stays inside the
// window, an item popover that never reshapes its card, keyboard and touch.

const CHARACTER = { id: 'Player-journal-1', name: 'Jornal', realm: 'E2E Journal Realm', level: 20 }
let paired = false

async function signIn(page, context) {
  await authenticate(context, 'journalTester')
  await page.goto('/dashboard/dungeons')
  if (!paired) {
    await connectAndSync(page, { deviceName: 'Journal PC', characters: [CHARACTER] })
    paired = true
  }
}

// Counts floating tooltips added and removed from now on.
async function watchTooltips(page) {
  await page.evaluate(() => {
    window.__tips = { mounts: 0, unmounts: 0 }
    window.__tipObserver?.disconnect()
    window.__tipObserver = new MutationObserver((list) => {
      for (const change of list) {
        for (const node of change.addedNodes) if (node.nodeType === 1 && node.matches('[role=tooltip]')) window.__tips.mounts += 1
        for (const node of change.removedNodes) if (node.nodeType === 1 && node.matches('[role=tooltip]')) window.__tips.unmounts += 1
      }
    })
    window.__tipObserver.observe(document.body, { childList: true })
  })
}
const tips = (page) => page.evaluate(() => ({ ...window.__tips, shown: document.querySelectorAll('[role=tooltip]').length }))

// Waits until the page has stopped scrolling (smooth scrolling included).
async function settle(page) {
  await page.waitForFunction(() => new Promise((resolve) => {
    const start = window.scrollY
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.scrollY === start)))
  }))
}

const inside = (box, size) => box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width + 0.5 && box.y + box.height <= size.height + 0.5
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

async function openLoot(page) {
  await page.goto('/dashboard/dungeons?open=36&section=loot')
  const slots = page.locator('.gw-atlas-source button.gw-slot')
  await expect(slots.first()).toBeVisible()
  return slots
}

test('moving across every edge of a slot mounts its tooltip once; the slot never moves', async ({ page, context }) => {
  await signIn(page, context)
  const slots = await openLoot(page)
  const slot = slots.nth(3)
  await slot.scrollIntoViewIfNeeded()
  await settle(page)
  const box = await slot.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByRole('tooltip')).toBeVisible()
  await watchTooltips(page)
  // Trace the inside of each edge, 1px in, slowly; then the corners.
  const edge = 1
  for (let x = box.x + edge; x <= box.x + box.width - edge; x += 1) await page.mouse.move(x, box.y + edge)
  for (let y = box.y + edge; y <= box.y + box.height - edge; y += 1) await page.mouse.move(box.x + box.width - edge, y)
  for (let x = box.x + box.width - edge; x >= box.x + edge; x -= 1) await page.mouse.move(x, box.y + box.height - edge)
  for (let y = box.y + box.height - edge; y >= box.y + edge; y -= 1) await page.mouse.move(box.x + edge, y)
  expect(await tips(page)).toEqual({ mounts: 0, unmounts: 0, shown: 1 })
  expect(await slot.boundingBox()).toEqual(box)
  // Pressing does not move it either.
  await page.mouse.down()
  expect(await slot.boundingBox()).toEqual(box)
  await page.mouse.up()
})

test('rapid moves between neighbouring slots leave one tooltip, for the slot under the pointer', async ({ page, context }) => {
  await signIn(page, context)
  const slots = await openLoot(page)
  const first = slots.nth(0)
  await first.scrollIntoViewIfNeeded()
  const panel = page.locator('.gw-atlas-source').first()
  const row = panel.locator('button.gw-slot')
  const count = await row.count()
  const boxes = []
  for (let index = 0; index < count; index += 1) boxes.push(await row.nth(index).boundingBox())
  await watchTooltips(page)
  for (let pass = 0; pass < 3; pass += 1) {
    for (const box of boxes) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 })
  }
  const state = await tips(page)
  expect(state.shown).toBe(1)
  expect(state.mounts - state.unmounts).toBe(1)
  const last = (await row.nth(count - 1).getAttribute('aria-label')).split(',')[0]
  await expect(page.getByRole('tooltip')).toContainText(last)
})

test('tooltips stay inside the window and off their slot near every edge', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await signIn(page, context)
  const slots = await openLoot(page)
  const size = page.viewportSize()
  const all = await slots.count()
  // The right-most slot, a slot near the bottom of the window, one near the top.
  const rightmost = await slots.evaluateAll((elements) => elements.reduce((best, el, index) => (el.getBoundingClientRect().right > best.right ? { index, right: el.getBoundingClientRect().right } : best), { index: 0, right: 0 }).index)
  for (const [label, index, place] of [['right', rightmost, 'center'], ['bottom', Math.min(all - 1, 12), 'end'], ['top', 0, 'start'], ['left', 0, 'center']]) {
    const slot = slots.nth(index)
    await slot.evaluate((element, block) => {
      element.scrollIntoView({ block, behavior: 'instant' })
      // "Top": just under the app's sticky bars, as near the top as a slot can be seen.
      if (block === 'start') window.scrollBy({ top: -(document.querySelector('.gw-atlas-tabs')?.getBoundingClientRect().bottom || 0) - 8, behavior: 'instant' })
    }, place)
    await settle(page)
    await page.mouse.move(0, 0)
    const box = await slot.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const tooltip = page.getByRole('tooltip')
    await expect(tooltip, label).toBeVisible()
    const tip = await tooltip.boundingBox()
    expect(inside(tip, size), `${label}: ${JSON.stringify(tip)}`).toBe(true)
    expect(overlaps(tip, box), `${label}: covers its slot`).toBe(false)
  }
})

test('scrolling hides the tooltip; the next move brings it back beside the slot', async ({ page, context }) => {
  await signIn(page, context)
  const slots = await openLoot(page)
  const slot = slots.nth(2)
  await slot.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await settle(page)
  let box = await slot.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.mouse.wheel(0, 30)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  box = await slot.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2)
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip).toBeVisible()
  const tip = await tooltip.boundingBox()
  expect(Math.abs(tip.x - (box.x + box.width + 10)) < 2 || Math.abs(tip.x + tip.width - (box.x - 10)) < 2).toBe(true)
})

test('opening and closing an item never reshapes its card or the page', async ({ page, context }) => {
  await signIn(page, context)
  const slots = await openLoot(page)
  const card = page.locator('.gw-atlas-source').nth(4)
  const slot = card.locator('button.gw-slot').first()
  await slot.scrollIntoViewIfNeeded()
  await settle(page)
  const cardBox = await card.boundingBox()
  const neighbours = await page.locator('.gw-atlas-source').evaluateAll((elements) => elements.map((element) => JSON.stringify(element.getBoundingClientRect())))
  const size = page.viewportSize()
  for (let round = 0; round < 4; round += 1) {
    await page.mouse.move(0, 0)
    await slot.click()
    const dialog = page.getByRole('dialog', { name: /details$/ })
    await expect(dialog).toBeVisible()
    expect(await card.boundingBox()).toEqual(cardBox)
    expect(await page.locator('.gw-atlas-source').evaluateAll((elements) => elements.map((element) => JSON.stringify(element.getBoundingClientRect())))).toEqual(neighbours)
    expect(inside(await dialog.boundingBox(), size)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
    if (round % 2) await page.keyboard.press('Escape')
    else await page.mouse.click(size.width - 5, 5)
    await expect(dialog, `round ${round}`).toHaveCount(0)
  }
  expect(await slots.count()).toBeGreaterThan(0)
})

test('keyboard: focus shows the tooltip, Enter opens the item, Tab stays usable, Escape returns to the slot', async ({ page, context }) => {
  await signIn(page, context)
  const slots = await openLoot(page)
  await slots.nth(1).focus()
  await page.keyboard.press('Shift+Tab')
  await expect(slots.nth(0)).toBeFocused()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(slots.nth(1)).toBeFocused()
  const name = (await slots.nth(1).getAttribute('aria-label')).split(',')[0]
  await expect(page.getByRole('tooltip')).toContainText(name)
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: `${name} details` })
  await expect(dialog).toBeFocused()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.keyboard.press('Tab')
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(slots.nth(1)).toBeFocused()
})

test('switching bosses while a tooltip is shown leaves none behind', async ({ page, context }) => {
  await signIn(page, context)
  await page.goto('/dashboard/dungeons?open=36&boss=2747')
  const slots = page.getByRole('region', { name: 'Edwin VanCleef loot' }).locator('button.gw-slot')
  await slots.first().focus()
  await page.keyboard.press('Tab')
  await expect(slots.nth(1)).toBeFocused()
  await expect(page.getByRole('tooltip')).toBeVisible()
  // The next boss, without moving the pointer.
  await page.getByRole('navigation', { name: 'Bosses' }).getByRole('button', { name: /Rhahk'Zor/ }).evaluate((button) => button.click())
  await expect(page.getByRole('article', { name: 'Rhahk\'Zor' })).toBeVisible()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
})

test('The Hall of Thanes shows its bosses by name, never as creature ids', async ({ page, context }) => {
  await signIn(page, context)
  await page.goto('/dashboard/dungeons?open=3065&section=loot')
  const bosses = page.getByRole('region', { name: 'Bosses', exact: true })
  await expect(bosses.getByRole('region', { name: 'Faldrim Anvilmar loot' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/Creature 2613\d\d/)
  const response = await page.request.get('/api/player/loot/dungeons/3065')
  const detail = await response.json()
  expect(detail.atlas.bosses.find((boss) => boss.npcId === 261306).name).toBe('Faldrim Anvilmar')
  expect(detail.atlas.bosses.find((boss) => boss.npcId === 261319).name).toBe('Durgen Dirgehammer')
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('tap opens the item as a sheet, tap outside dismisses it', async ({ page, context }) => {
    await signIn(page, context)
    const slots = await openLoot(page)
    const slot = slots.nth(2)
    await slot.scrollIntoViewIfNeeded()
    const card = slot.locator('xpath=ancestor::section[contains(@class,"gw-atlas-source")]')
    const cardBox = await card.boundingBox()
    await slot.tap()
    const sheet = page.getByRole('dialog', { name: /details$/ })
    await expect(sheet).toBeVisible()
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    const box = await sheet.boundingBox()
    expect(inside(box, page.viewportSize())).toBe(true)
    expect(await card.boundingBox()).toEqual(cardBox)
    await page.touchscreen.tap(195, 40)
    await expect(sheet).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
  })
})
