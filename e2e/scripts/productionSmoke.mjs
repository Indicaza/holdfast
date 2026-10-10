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
  assert.equal((await api('/api/me', 200)).authenticated, false)
  await api('/api/admin/audit?details=true', 401)
  await api('/api/quests/manage', 401)
  await api('/api/quests', 200)
  for (const [route, title] of [['/', /Holdfast/i], ['/charter', /Holdfast Charter/i], ['/ranks', /Ranks & Roles/i]]) {
    const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    assert.equal(response.status(), 200)
    await expect(page).toHaveTitle(title)
    await page.getByRole('navigation', { name: 'Primary navigation' }).waitFor()
    // The navbar stays mounted while a lazy page loads, so wait for the page itself.
    await page.locator('main h1').first().waitFor({ state: 'attached' })
    assert.ok((await page.locator('main').innerText()).trim().length > 100, `Empty application page: ${route}`)
  }
  await page.goto('/quests')
  await page.getByRole('heading', { name: 'Member sign in', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Sign in with Discord', exact: true }).waitFor()
  assert.deepEqual(errors, [], 'Production browser errors')
  console.log(`Production smoke passed; release ${live.release || 'unreported'}, backups ${ready.offsiteBackup?.enabled ? 'verified' : 'disabled'}.`)
} catch (error) {
  await page.screenshot({ path: 'production-smoke-failure.png', fullPage: true }).catch(() => {})
  throw error
} finally {
  await context.close()
  await browser.close()
}
