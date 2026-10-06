import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

test('member GuildOS keeps the Holdfast navbar and hides privileged operations', async ({ page, context }) => {
  await authenticate(context, 'member')
  await page.goto('/intelligence')

  await expect(page.locator('.navbar')).toBeVisible()
  await expect(page.locator('.navbar').getByRole('link', { name: 'Holdfast home' })).toBeVisible()
  await expect(page.locator('.navbar__links a[href="/intelligence"]')).toHaveCount(0)
  await expect(page.getByText('GuildOS', { exact: true }).first()).toBeVisible()

  const rail = page.locator('.intelligence-rail__nav')
  await expect(rail.getByText('Guild', { exact: true })).toBeVisible()
  await expect(rail.getByRole('button', { name: /^Overview\b/ })).toBeVisible()
  await expect(rail.getByRole('button', { name: /^Audit Log\b/ })).toHaveCount(0)
  await expect(rail.getByRole('button', { name: /^Guildweaver\b/ })).toHaveCount(0)

  await page.locator('.navbar__account-button').click()
  const accountLinks = page.locator('.navbar__account-links')
  await expect(accountLinks.getByRole('link', { name: 'GuildOS', exact: true })).toHaveAttribute('href', '/intelligence')
  await expect(accountLinks.locator('a[href^="/intelligence"]')).toHaveCount(1)

  await page.goto('/intelligence#audit')
  await expect(page.locator('.intelligence-app__topbar').getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.locator('.admin-audit')).toHaveCount(0)
})

test('commander can use audit and Guildweaver consoles inside GuildOS', async ({ page, context }) => {
  await authenticate(context, 'commander')
  await page.goto('/intelligence')

  const rail = page.locator('.intelligence-rail__nav')
  const topbar = page.locator('.intelligence-app__topbar')

  await expect(page.locator('.navbar')).toBeVisible()
  await expect(rail.getByText('Operations', { exact: true })).toBeVisible()

  await rail.getByRole('button', { name: /^Audit Log\b/ }).click()
  await expect(page).toHaveURL(/#audit$/)
  await expect(topbar.getByRole('heading', { name: 'Audit Log' })).toBeVisible()
  await expect(page.locator('.admin-audit')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible()

  await rail.getByRole('button', { name: /^Guildweaver\b/ }).click()
  await expect(page).toHaveURL(/#guildweaver$/)
  await expect(topbar.getByRole('heading', { name: 'Guildweaver' })).toBeVisible()
  await expect(page.getByLabel('Guildweaver telemetry workspace')).toBeVisible()
  await expect(page.getByLabel('Search Guildweaver telemetry')).toBeVisible()

  await page.getByText(/^Filters/).click()
  await expect(page.getByLabel('Filter telemetry domain')).toBeVisible()
  await expect(page.getByLabel('Filter telemetry kind')).toBeVisible()

  await page.locator('.navbar__account-button').click()
  const accountLinks = page.locator('.navbar__account-links')
  await expect(accountLinks.getByRole('link', { name: 'GuildOS', exact: true })).toHaveAttribute('href', '/intelligence')
  await expect(accountLinks.locator('a[href^="/intelligence"]')).toHaveCount(1)
})

test('standalone Guildweaver admin route remains available for compatibility', async ({ page, context }) => {
  await authenticate(context, 'commander')
  await page.goto('/admin/guildweaver')

  await expect(page.getByRole('heading', { name: 'Sync Console' })).toBeVisible()
  await expect(page.getByLabel('Guildweaver telemetry workspace')).toBeVisible()
})
