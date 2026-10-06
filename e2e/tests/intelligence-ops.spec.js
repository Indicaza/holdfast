import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

test('member Intelligence keeps the Holdfast navbar and hides privileged operations', async ({ page, context }) => {
  await authenticate(context, 'member')
  await page.goto('/intelligence')

  await expect(page.locator('.navbar')).toBeVisible()
  await expect(page.locator('.navbar').getByRole('link', { name: 'Holdfast home' })).toBeVisible()

  const rail = page.locator('.intelligence-rail__nav')
  await expect(rail.getByRole('button', { name: /^Overview\b/ })).toBeVisible()
  await expect(rail.getByRole('button', { name: /^Audit Log\b/ })).toHaveCount(0)
  await expect(rail.getByRole('button', { name: /^Guildweaver\b/ })).toHaveCount(0)

  await page.goto('/intelligence#audit')
  await expect(page.locator('.intelligence-app__topbar').getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.locator('.admin-audit')).toHaveCount(0)
})

test('commander can use audit and Guildweaver consoles inside Intelligence', async ({ page, context }) => {
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
  await expect(page.locator('.gw-admin-console')).toBeVisible()
  await expect(page.getByLabel('Search Guildweaver telemetry')).toBeVisible()

  await page.locator('.navbar__account-button').click()
  await expect(page.locator('.navbar__account-links').getByRole('link', { name: 'Audit Log' })).toHaveAttribute('href', '/intelligence#audit')
  await expect(page.locator('.navbar__account-links').getByRole('link', { name: 'Guildweaver Sync' })).toHaveAttribute('href', '/intelligence#guildweaver')
})

test('standalone Guildweaver admin route remains available for compatibility', async ({ page, context }) => {
  await authenticate(context, 'commander')
  await page.goto('/admin/guildweaver')

  await expect(page.getByRole('heading', { name: 'Telemetry Oscilloscope' })).toBeVisible()
  await expect(page.locator('.gw-admin-console')).toBeVisible()
})