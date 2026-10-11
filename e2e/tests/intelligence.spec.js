import { expect, test } from '@playwright/test'
import { seedArmory } from '../helpers/armory.js'

test('member Armory modal renders equipment, talent tree, professions, recipes, and narrow screens', async ({ page, context }) => {
  await seedArmory(page, context)
  let recipeReads = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/recipes')) recipeReads += 1
  })
  await page.goto('/intelligence#characters')

  const characterCard = page.locator('.character-card').filter({ hasText: 'Armorytest' })
  await expect(characterCard).toBeVisible()
  await characterCard.click()

  const profile = page.getByRole('dialog')
  await expect(profile).toHaveAttribute('aria-label', 'Armorytest')
  await expect(profile.locator('.armory-header')).toBeVisible()
  await expect(profile.getByRole('tab', { name: /^Equipment/ })).toBeVisible()
  await expect(profile.getByRole('link', { name: /Open full profile/i })).toHaveCount(0)

  await profile.getByRole('tab', { name: /^Equipment/ }).click()
  await expect(profile.locator('.paper-doll__slot--sheet')).toHaveCount(19)
  const helmSlot = profile.getByRole('button', { name: 'Head: Golem Skull Helm' })
  await expect(helmSlot).toBeVisible()
  await expect(profile.getByTitle('Neck')).toBeVisible()
  await helmSlot.hover()
  const helmTooltip = page.getByRole('tooltip').filter({ hasText: 'Golem Skull Helm' })
  await expect(helmTooltip).toBeVisible()
  await expect(helmTooltip).toContainText('Item Level 35')

  await profile.getByRole('tab', { name: /^Talents/ }).click()
  await expect(profile.locator('.talent-node')).toHaveCount(2)
  await expect(profile.locator('.talent-arrow')).toHaveCount(1)
  await profile.locator('.talent-node').nth(0).hover()
  await expect(page.getByRole('tooltip').filter({ hasText: 'Last Stand' })).toBeVisible()
  await profile.locator('.talent-node').nth(1).hover()
  await expect(page.getByRole('tooltip').filter({ hasText: 'Shield Mastery' })).toBeVisible()

  expect(recipeReads, 'recipe books wait for the professions tab').toBe(0)
  await profile.getByRole('tab', { name: /^Professions/ }).click()
  await expect(profile.getByRole('heading', { name: 'Blacksmithing' })).toBeVisible()
  expect(recipeReads).toBe(1)
  await expect(profile.getByRole('meter', { name: 'Blacksmithing skill' })).toHaveText('225 + 5/225')
  await expect(profile.getByRole('heading', { name: 'Fishing' })).toBeVisible()

  const blacksmithingTab = profile.getByRole('navigation', { name: 'Profession pages' }).getByRole('button', { name: 'Blacksmithing' })
  await blacksmithingTab.hover()
  await expect(page.getByRole('tooltip').filter({ hasText: 'Blacksmithing' })).toBeVisible()
  await blacksmithingTab.click()
  await expect(profile.getByText('Mithril Spurs', { exact: true }).first()).toBeVisible()
  await profile.getByRole('searchbox', { name: 'Search Blacksmithing recipes' }).fill('nothing-here')
  await expect(profile.getByText('No recipes match.')).toBeVisible()

  await page.setViewportSize({ width: 320, height: 700 })
  await profile.getByRole('searchbox', { name: 'Search Blacksmithing recipes' }).fill('')
  await profile.getByRole('tab', { name: /^Talents/ }).click()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  const profileBox = await profile.boundingBox()
  expect(profileBox?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect(profileBox?.width ?? 999).toBeLessThanOrEqual(320)
})

test('guild intelligence behaves like a fixed app with switchable workspaces', async ({ page, context }) => {
  await seedArmory(page, context)
  await page.goto('/intelligence')

  const app = page.locator('.intelligence-app')
  const topbar = page.locator('.intelligence-app__topbar')
  const rail = page.locator('.intelligence-rail__nav')

  await expect(app).toBeVisible()
  await expect(topbar.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.getByText('Fresh in 24h', { exact: true })).toBeVisible()
  await expect(page.getByText('Armorytest', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Collapse intelligence navigation' }).click()
  await expect(app).toHaveClass(/intelligence-app--collapsed/)
  await page.getByRole('button', { name: 'Expand intelligence navigation' }).click()
  await expect(app).not.toHaveClass(/intelligence-app--collapsed/)

  await rail.getByRole('button', { name: /^Roster\b/ }).click()
  await expect(topbar.getByRole('heading', { name: 'Roster' })).toBeVisible()
  await expect(page).toHaveURL(/#roster$/)

  const composition = page.locator('.roster-composition')
  await expect(composition.getByRole('heading', { name: 'See what the guild can field.' })).toBeVisible()
  await expect(composition.getByRole('button', { name: 'Classes' })).toHaveAttribute('aria-pressed', 'true')
  await expect(composition.getByRole('button', { name: /^Warrior\b/ })).toBeVisible()
  await composition.getByRole('button', { name: 'Professions' }).click()
  await expect(composition.getByRole('button', { name: /^Blacksmithing\b/ })).toBeVisible()
  await composition.getByLabel('Slice detail').selectOption('5')
  await expect(composition.getByLabel('Slice detail')).toHaveValue('5')

  await rail.getByRole('button', { name: /^Characters\b/ }).click()
  await expect(topbar.getByRole('heading', { name: 'Characters' })).toBeVisible()
  const characterSearch = page.getByPlaceholder('Name, class, spec, realm…')
  await characterSearch.fill('Protection')
  const characterCard = page.locator('.character-card').filter({ hasText: 'Armorytest' })
  await expect(characterCard).toBeVisible()
  await characterCard.click()

  const profile = page.getByRole('dialog')
  await expect(profile).toHaveAttribute('aria-label', 'Armorytest')
  await expect(profile.locator('.armory-header')).toBeVisible()
  await profile.getByRole('tab', { name: /^Equipment/ }).click()
  await expect(profile.locator('.paper-doll__slot--sheet')).toHaveCount(19)
  await expect(profile.getByRole('button', { name: 'Head: Golem Skull Helm' })).toBeVisible()
  await profile.getByRole('button', { name: 'Close' }).click()
  await expect(profile).toHaveCount(0)

  await characterSearch.fill('Mage')
  await expect(page.getByRole('heading', { name: 'No characters match.' })).toBeVisible()

  await rail.getByRole('button', { name: /^Craft Finder\b/ }).click()
  await expect(topbar.getByRole('heading', { name: 'Craft Finder' })).toBeVisible()
  const craftSearch = page.getByPlaceholder('Mithril Spurs, potion, item ID…')
  await craftSearch.fill('spurs')
  await expect(page.locator('.craft-result').getByText('Mithril Spurs', { exact: true })).toBeVisible()
  await expect(page.getByText('Blacksmithing 225/225')).toBeVisible()
  await expect(page.locator('.craft-result__crafters').getByText('Armorytest', { exact: true })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 780 })
  await expect(page.getByRole('button', { name: 'Open intelligence navigation' })).toBeVisible()
  await page.getByRole('button', { name: 'Open intelligence navigation' }).click()
  await expect(app).toHaveClass(/intelligence-app--mobile-open/)
  await rail.getByRole('button', { name: /^Overview\b/ }).click()
  await expect(topbar.getByRole('heading', { name: 'Overview' })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('guild intelligence remains member-gated', async ({ page }) => {
  await page.goto('/intelligence')
  await expect(page.getByRole('dialog')).toContainText('Member sign in')
  await expect(page.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible()
})