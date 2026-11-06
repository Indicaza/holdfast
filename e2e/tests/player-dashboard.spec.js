import { expect, test } from '@playwright/test'

test('players can download without registering and reach a neutral sign-in page', async ({ page }) => {
  await page.route('**/api/me', route => route.fulfill({ json: { authenticated: false } }))
  await page.goto('/download')
  await expect(page.getByText('No guild required.', { exact: false })).toBeVisible()
  await expect(page.locator('.guildweaver-download__primary')).toHaveAttribute('href', /\/guildweaver\/download\//)
  await page.getByRole('link', { name: 'Open telemetry dashboard' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: 'Telemetry dashboard' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible()
  await expect(page.getByText('New to Holdfast?', { exact: false })).toHaveCount(0)
})

test('guildless players can browse the dashboard without guild or admin controls', async ({ page }) => {
  await page.route('**/api/me', route => route.fulfill({ json: {
    authenticated: true, user: { id: 'solo', username: 'solo' }, permissions: [], guild: null,
  } }))
  await page.route('**/api/intelligence', route => route.fulfill({ json: { characters: [], summary: {} } }))
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Telemetry workspaces' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Audit Log', exact: false })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Roster', exact: false })).toHaveCount(0)
  await page.getByRole('button', { name: 'Characters Browse synced armories' }).click()
  await expect(page.getByRole('heading', { name: 'Characters', exact: true })).toBeVisible()
  await expect(page.getByText('No characters synced yet.', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open intelligence navigation' }).click()
  await expect(page.getByRole('button', { name: 'Craft Finder Find recipes and crafters' })).toBeVisible()
})
