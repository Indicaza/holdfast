import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

const account = (page) => page.getByRole('button', { name: 'Open account menu for Mira Member' })
const signIn = (page) => page.locator('.navbar').getByRole('button', { name: 'Sign In', exact: true })

test('page changes never present an unresolved member session as signed out', async ({ page, context }) => {
  await authenticate(context, 'member')
  let release
  let gate = new Promise((resolve) => { release = resolve })
  await page.route('**/api/me', async (route) => {
    const response = await route.fetch()
    await gate
    await route.fulfill({ response })
  })
  await page.goto('/')
  for (const href of ['/charter', '/ranks', '/members', '/quests', '/']) {
    await expect(page.getByRole('status', { name: 'Checking member session' })).toBeVisible()
    await expect(signIn(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Join Holdfast', exact: true })).toHaveCount(0)
    release()
    await expect(account(page)).toBeVisible()
    gate = new Promise((resolve) => { release = resolve })
    await page.locator(`.navbar a[href="${href}"]`).first().click()
    expect(new URL(page.url()).pathname).toBe(href)
  }
  release()
  await expect(account(page)).toBeVisible()
})

test('an anonymous session shows Sign in only after its check completes', async ({ page }) => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  await page.route('**/api/me', async (route) => {
    await gate
    await route.continue()
  })
  await page.goto('/')
  await expect(page.getByRole('status', { name: 'Checking member session' })).toBeVisible()
  await expect(signIn(page)).toHaveCount(0)
  release()
  await expect(signIn(page)).toBeVisible()
})

test('a failed session check offers retry rather than a false signed-out state', async ({ page, context }) => {
  await authenticate(context, 'member')
  await page.route('**/api/me', (route) => route.fulfill({ status: 503, json: { error: 'unavailable' } }))
  await page.goto('/')
  const retry = page.locator('.navbar').getByRole('button', { name: 'Retry connection' })
  await expect(retry).toBeVisible()
  await expect(signIn(page)).toHaveCount(0)
  await page.unroute('**/api/me')
  await retry.click()
  await expect(account(page)).toBeVisible()
})

test('concurrent refreshes are shared and a late response cannot reverse sign-out', async ({ page, context }) => {
  await authenticate(context, 'member')
  await page.goto('/')
  await expect(account(page)).toBeVisible()
  let release
  let fetched
  const gate = new Promise((resolve) => { release = resolve })
  const captured = new Promise((resolve) => { fetched = resolve })
  let requests = 0
  await page.route('**/api/me', async (route) => {
    requests += 1
    const response = await route.fetch()
    fetched()
    await gate
    await route.fulfill({ response })
  })
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('focus'))
  })
  await captured
  await account(page).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(signIn(page)).toBeVisible()
  const response = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/me')
  release()
  await response
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(requests).toBe(1)
  await expect(account(page)).toHaveCount(0)
  await expect(signIn(page)).toBeVisible()
})

test('returning to the tab detects an expired member session', async ({ page, context }) => {
  await authenticate(context, 'member')
  await page.goto('/')
  await expect(account(page)).toBeVisible()
  await context.clearCookies()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(signIn(page)).toBeVisible()
  await expect(account(page)).toHaveCount(0)
  await expect(page.locator('.navbar__links a[href="/quests"]')).toHaveCount(0)
})

test('failed sign-out is visible and leaves the verified account available', async ({ page, context }) => {
  await authenticate(context, 'member')
  await page.goto('/')
  await account(page).click()
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 503 }))
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Could not sign out. Try again.')
  await expect(account(page)).toBeVisible()
  await expect(signIn(page)).toHaveCount(0)
  await page.unroute('**/api/auth/logout')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(signIn(page)).toBeVisible()
})
