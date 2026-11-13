import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

const baseURL = process.env.PRODUCTION_URL || 'https://holdfast-tddi.onrender.com'
const expectedRelease = process.env.EXPECTED_RELEASE || ''
const errors = []
const browser = await chromium.launch()
const context = await browser.newContext({ baseURL })
const page = await context.newPage()
page.on('pageerror', (error) => errors.push(error.message))
page.on('response', (response) => {
  if (new URL(response.url()).origin === new URL(baseURL).origin && response.status() >= 500) errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`)
})

async function api(route, status) {
  const response = await context.request.get(route, { timeout: 20_000 })
  assert.equal(response.status(), status, `Unexpected HTTP status for ${route}`)
  return response.json()
}

try {
  const live = await api('/api/health/live', 200)
  assert.equal(live.status, 'ok')
  if (expectedRelease) assert.equal(live.release, expectedRelease, 'Production is not serving the expected release')
  const ready = await api('/api/health/ready', 200)
  assert.equal(ready.status, 'ok')
  if (process.env.REQUIRE_OFFSITE_BACKUP === 'true') assert.equal(ready.offsiteBackup?.enabled, true, 'Off-site backups must be enabled')
  if (ready.offsiteBackup?.enabled) assert.equal(ready.offsiteBackup.healthy, true, 'No verified off-site backup within 24 hours')
  // Disk at 70/85/95%, abnormal growth, or full within two weeks (details:
  // /api/admin/storage/health). Growth alerts need two days of samples.
  // Only against production: CI's disposable app shares the runner's disk.
  if (process.env.CHECK_STORAGE === 'true' && ready.storage) assert.deepEqual(ready.storage.alerts, [], `Storage alerts (${ready.storage.status}): ${ready.storage.alerts.join(', ')}. Details: /api/admin/storage/health`)
  assert.equal((await api('/api/me', 200)).authenticated, false)
  await api('/api/admin/audit?details=true', 401)
  await api('/api/quests/manage', 401)
  await api('/api/quests', 200)
  // A release from before the guild switch has no /api/site and still runs
  // the guild site.
  const siteResponse = await context.request.get('/api/site', { timeout: 20_000 })
  const guildFeatures = siteResponse.status() === 404 ? true : (await siteResponse.json()).guildFeatures === true

  async function rendersPage(route, title) {
    const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    assert.equal(response.status(), 200)
    await expect(page).toHaveTitle(title)
    await page.getByRole('navigation', { name: 'Primary navigation' }).waitFor()
    // The navbar stays mounted while a lazy page loads, so wait for the page itself.
    await page.locator('main h1').first().waitFor({ state: 'attached' })
    assert.ok((await page.locator('main').innerText()).trim().length > 100, `Empty application page: ${route}`)
  }

  if (guildFeatures) {
    for (const [route, title] of [['/holdfast', /Holdfast/i], ['/holdfast/charter', /Holdfast Charter/i], ['/holdfast/ranks', /Ranks & Roles/i]]) {
      await rendersPage(route, title)
    }
    await page.goto('/holdfast/quests')
    await page.getByRole('heading', { name: 'Member sign in', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Sign in with Discord', exact: true }).waitFor()
  } else {
    // The solo site: personal data is private, guild pages are hidden.
    await api('/api/player/overview', 401)
    await api('/api/guilds', 404)
    for (const [route, title] of [['/', /^Guildweaver \| /], ['/download', /Guildweaver Addon/i], ['/privacy', /Privacy/i]]) {
      await rendersPage(route, title)
    }
    await page.goto('/holdfast', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    assert.equal(new URL(page.url()).pathname, '/', 'Hidden guild pages redirect to the front page')
    await page.goto('/dashboard')
    await page.getByRole('heading', { name: 'Your dashboard', exact: true }).waitFor()
    await page.locator('main').getByRole('button', { name: 'Sign in with Discord', exact: true }).waitFor()
  }
  assert.deepEqual(errors, [], 'Production browser errors')
  console.log(`Production smoke passed; release ${live.release || 'unreported'}, backups ${ready.offsiteBackup?.enabled ? 'verified' : 'disabled'}, storage ${ready.storage?.status || 'unreported'}.`)
} catch (error) {
  await page.screenshot({ path: 'production-smoke-failure.png', fullPage: true }).catch(() => {})
  throw error
} finally {
  await context.close()
  await browser.close()
}
