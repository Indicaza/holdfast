import { expect, test } from '@playwright/test'
import { seedArmory } from '../helpers/armory.js'
import { authenticate } from '../helpers/auth.js'

test('signed-in members can browse the directory and profiles', async ({ browser }) => {
  const context = await browser.newContext()
  await authenticate(context, 'member')
  const page = await context.newPage()

  await page.goto('/holdfast/members')
  await expect(page.locator('body')).toContainText('Mira Member')
  await expect(page.locator('body')).toContainText('Owen Officer')

  await page.goto('/holdfast/members/e2e-member')
  await expect(page.locator('body')).toContainText('Mira Member')
  await expect(page.locator('body')).toContainText('Private')
  await expect(page.locator('body')).toContainText('Browser-test guild member.')

  await context.close()
})

test('member cards show rank and billets as one title, Rep progress and synced characters that open the armory', async ({ page, context }) => {
  await seedArmory(page, context)
  await page.goto('/holdfast/members')

  const card = page.locator('.member-card').filter({ hasText: 'Mira Member' })
  await expect(card.locator('.rank-plate')).toContainText('Private')
  await expect(card.getByRole('progressbar', { name: /^Reputation/ })).toBeAttached()

  const character = card.locator('.character-line').filter({ hasText: 'Armorytest' })
  await expect(character).toBeVisible()
  await character.click()
  const armory = page.getByRole('dialog')
  await expect(armory).toHaveAttribute('aria-label', 'Armorytest')
  await expect(page).toHaveURL(/\/members\?character=/)
  await page.keyboard.press('Escape')
  await expect(armory).toHaveCount(0)

  // Anywhere else on the card opens the profile.
  await card.click({ position: { x: 30, y: 30 } })
  await expect(page).toHaveURL(/\/members\/e2e-member$/)
  await expect(page.locator('.member-profile__hero .rank-plate')).toContainText('Private')
  await expect(page.locator('.member-profile__rep').getByRole('progressbar', { name: /^Reputation/ })).toBeVisible()

  const profileCharacter = page.locator('.member-profile__character-grid .character-card').filter({ hasText: 'Armorytest' })
  await profileCharacter.click()
  await expect(page.getByRole('dialog')).toHaveAttribute('aria-label', 'Armorytest')
  // Page heading styles never reach the modal (it renders on <body>).
  const nameSize = await page.locator('.armory-header .unit-frame__name').evaluate((name) => parseFloat(getComputedStyle(name).fontSize))
  expect(nameSize).toBeLessThan(16)
})

test('the billet menu closes on a click elsewhere or Escape', async ({ browser }) => {
  const context = await browser.newContext()
  await authenticate(context, 'commander')
  const page = await context.newPage()
  await page.goto('/holdfast/members/e2e-member')
  const menu = page.locator('.member-billet-control')
  await menu.locator('summary').click()
  await expect(menu).toHaveAttribute('open', '')
  await page.locator('.member-profile__crumbs').click()
  await expect(menu).not.toHaveAttribute('open', '')
  await menu.locator('summary').click()
  await page.keyboard.press('Escape')
  await expect(menu).not.toHaveAttribute('open', '')
  await context.close()
})

test('sorting by rank groups officers, NCOs and enlisted members', async ({ browser }) => {
  const context = await browser.newContext()
  await authenticate(context, 'member')
  const page = await context.newPage()
  await page.goto('/holdfast/members')
  await page.locator('.members-page__sort select').selectOption('rank')
  const headings = page.locator('.members-page__group-heading h2')
  await expect(headings.first()).toHaveText('Officers')
  await expect(page.locator('.members-page__group').filter({ hasText: 'Officers' })).toContainText('Owen Officer')
  await expect(page.locator('.members-page__group').filter({ hasText: 'Enlisted' })).toContainText('Mira Member')
  await context.close()
})
