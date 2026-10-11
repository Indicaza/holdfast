import { expect, test } from '@playwright/test'
import { seedArmory } from '../helpers/armory.js'
import { authenticate } from '../helpers/auth.js'

test('signed-in members can browse the directory and profiles', async ({ browser }) => {
  const context = await browser.newContext()
  await authenticate(context, 'member')
  const page = await context.newPage()

  await page.goto('/members')
  await expect(page.locator('body')).toContainText('Mira Member')
  await expect(page.locator('body')).toContainText('Owen Officer')

  await page.goto('/members/e2e-member')
  await expect(page.locator('body')).toContainText('Mira Member')
  await expect(page.locator('body')).toContainText('Private')
  await expect(page.locator('body')).toContainText('Browser-test guild member.')

  await context.close()
})

test('member cards show rank and billets as one title, Rep progress and synced characters that open the armory', async ({ page, context }) => {
  await seedArmory(page, context)
  await page.goto('/members')

  const card = page.locator('.member-card').filter({ hasText: 'Mira Member' })
  await expect(card.locator('.rank-plate')).toContainText('Private')
  await expect(card.getByRole('progressbar', { name: /^Reputation/ })).toBeAttached()

  const character = card.locator('.character-card').filter({ hasText: 'Armorytest' })
  await expect(character).toBeVisible()
  await character.click()
  const armory = page.getByRole('dialog')
  await expect(armory).toHaveAttribute('aria-label', 'Armorytest')
  await expect(page).toHaveURL(/\/members\?character=/)
  await page.keyboard.press('Escape')
  await expect(armory).toHaveCount(0)

  // Anywhere else on the card opens the profile.
  await card.click({ position: { x: 24, y: 120 } })
  await expect(page).toHaveURL(/\/members\/e2e-member$/)
  await expect(page.locator('.member-profile__hero .rank-plate')).toContainText('Private')
  await expect(page.locator('.member-profile__rep').getByRole('progressbar', { name: /^Reputation/ })).toBeVisible()

  const profileCharacter = page.locator('.member-profile__character-grid .character-card').filter({ hasText: 'Armorytest' })
  await profileCharacter.click()
  await expect(page.getByRole('dialog')).toHaveAttribute('aria-label', 'Armorytest')
})

test('sorting by rank groups officers, NCOs and enlisted members', async ({ browser }) => {
  const context = await browser.newContext()
  await authenticate(context, 'member')
  const page = await context.newPage()
  await page.goto('/members')
  await page.locator('.members-page__sort select').selectOption('rank')
  const headings = page.locator('.members-page__group-heading h2')
  await expect(headings.first()).toHaveText('Officers')
  await expect(page.locator('.members-page__group').filter({ hasText: 'Officers' })).toContainText('Owen Officer')
  await expect(page.locator('.members-page__group').filter({ hasText: 'Enlisted' })).toContainText('Mira Member')
  await context.close()
})
