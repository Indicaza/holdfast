import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

const account = (page) => page.getByRole('button', { name: 'Open account menu for Mira Member' })
const signIn = (page) => page.locator('.navbar').getByRole('button', { name: 'Sign In', exact: true })

test('the member session is checked once and survives every page change', async ({ page, context }) => {
  await authenticate(context, 'member')
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let checks = 0
  await page.route('**/api/me', async (route) => {
    checks += 1
    const response = await route.fetch()
    await gate
    await route.fulfill({ response })
  })
  await page.goto('/')
  // While the first check is pending, the navbar never claims "signed out".
  await expect(page.getByRole('status', { name: 'Checking member session' })).toBeVisible()
  await expect(signIn(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Join Holdfast', exact: true })).toHaveCount(0)
  release()
  await expect(account(page)).toBeVisible()

  // Page changes keep the app (and its navbar) mounted: no reload, no
  // re-check, no flash of a loading or signed-out navbar.
  const navbar = await page.locator('.navbar').elementHandle()
  for (const href of ['/charter', '/ranks', '/members', '/quests', '/']) {
    await page.locator(`.navbar a[href="${href}"]`).first().click()
    await expect(page).toHaveURL((url) => url.pathname === href)
    await expect(account(page)).toBeVisible()
    await expect(page.getByRole('status', { name: 'Checking member session' })).toHaveCount(0)
    expect(await navbar.evaluate((element) => element.isConnected)).toBe(true)
  }
  // A page may revalidate in the background (without touching the navbar),
  // but page changes no longer each re-check the session as reloads did.
  expect(checks).toBeLessThanOrEqual(2)
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

test('returning to the tab rechecks the session quietly and reports the timezone once', async ({ page, context }) => {
  await authenticate(context, 'member')
  let timezoneWrites = 0
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/guild/members/me/timezone') timezoneWrites += 1
  })
  await page.goto('/members')
  await expect(account(page)).toBeVisible()
  await page.locator('.navbar').evaluate((navbar) => { navbar.dataset.probe = 'kept' })

  for (let index = 0; index < 3; index += 1) {
    const recheck = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/me')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await recheck
  }
  await page.waitForTimeout(300)

  expect(timezoneWrites).toBeLessThanOrEqual(1)
  await expect(page.locator('.navbar')).toHaveAttribute('data-probe', 'kept')
  await expect(account(page)).toBeVisible()
})

test('a page whose code is still loading keeps the current page on screen', async ({ page, context }) => {
  await authenticate(context, 'member')
  let releaseChunk
  const chunkGate = new Promise((resolve) => { releaseChunk = resolve })
  await page.route(/\/assets\/Ranks-[^/]+\.js$/, async (route) => {
    await chunkGate
    await route.continue()
  })
  await page.goto('/charter')
  await expect(page.getByRole('heading', { name: 'Holdfast Charter', level: 1 }).first()).toBeAttached()

  await page.locator('.navbar a[href="/ranks"]').first().click()
  await expect(page).toHaveURL(/\/ranks$/)
  await expect(page.locator('.route-progress--active')).toBeAttached()
  await expect(page.locator('.page-loading')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Holdfast Charter', level: 1 }).first()).toBeAttached()

  releaseChunk()
  await expect(page.getByRole('heading', { name: 'Ranks & Roles', level: 1 })).toBeVisible()
  await expect(page.locator('.route-progress--active')).toHaveCount(0)
})

test('a members-only page waits for the session check without flashing the home page', async ({ page, context }) => {
  await authenticate(context, 'member')
  let release
  const gate = new Promise((resolve) => { release = resolve })
  await page.route('**/api/me', async (route) => {
    const response = await route.fetch()
    await gate
    await route.fulfill({ response })
  })
  await page.goto('/members')
  await expect(page.getByText('Checking your membership…')).toBeVisible()
  await expect(page.locator('.home')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  release()
  await expect(page.locator('main input[type="search"]')).toBeVisible()
})

test('returning to a page shows its data at once without fetching it again', async ({ page, context }) => {
  await authenticate(context, 'member')
  let directoryReads = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/guild/members') directoryReads += 1
  })
  await page.goto('/members')
  await expect(page.locator('main input[type="search"]')).toBeVisible()
  await expect.poll(() => directoryReads).toBe(1)

  await page.locator('.navbar a[href="/charter"]').first().click()
  await expect(page).toHaveURL(/\/charter$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/members$/)
  await expect(page.locator('.members-page__tools')).toBeVisible()
  await page.waitForTimeout(300)
  expect(directoryReads).toBe(1)
})
