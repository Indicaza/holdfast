import { expect, test } from '@playwright/test'

// The solo site: no guild discovery, no Holdfast, sign-in goes to the player's
// own dashboard.

test('the front page explains Guildweaver and offers download and sign-in, with no guild surfaces', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Guildweaver \| Your WoW Forever characters, synced/)
  await expect(page.getByRole('heading', { name: 'Guildweaver', level: 1 })).toBeVisible()
  await expect(page.getByText('no guild required', { exact: false }).first()).toBeVisible()

  const navbar = page.locator('.navbar')
  await expect(navbar.getByRole('link', { name: 'Guildweaver home' })).toHaveAttribute('href', '/')
  await expect(navbar.locator('.navbar__links a')).toHaveText(['Dashboard', 'Download'])
  await expect(navbar.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible()

  const main = page.locator('main')
  await expect(main.getByRole('link', { name: 'Download Guildweaver' })).toHaveAttribute('href', '/download')
  await expect(main.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible()
  await expect(page.locator('.footer__links a')).toHaveText(['Dashboard', 'Download', 'Privacy', 'Source'])

  const text = await page.locator('body').innerText()
  expect(text).not.toMatch(/Holdfast|Find guilds|Register|recruit|charter/i)
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /private dashboard/)
})

test('old guild and Holdfast links lead to the landing page or the dashboard', async ({ page, request }) => {
  for (const [from, to] of [
    ['/holdfast', '/'],
    ['/holdfast/charter', '/'],
    ['/holdfast/members/me', '/'],
    ['/register', '/'],
    ['/join', '/'],
    ['/guilds/holdfast', '/'],
    ['/quests?q=linen', '/'],
    ['/holdfast/intelligence', '/dashboard'],
    ['/guildos', '/dashboard'],
  ]) {
    await page.goto(from)
    await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === to)
    await expect(page.locator('body')).not.toContainText('Holdfast')
  }

  await page.goto('/iron-vanguard')
  await expect(page.getByRole('heading', { name: 'Nothing is waiting here.' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('Join Holdfast')

  expect((await request.get('/api/guilds')).status()).toBe(404)
  expect((await request.get('/api/g/holdfast/me')).status()).toBe(404)
  expect(await (await request.get('/api/site')).json()).toEqual({ guildFeatures: false })
})

test('signing in from the front page goes to My Overview; the bridge pairing page keeps its code', async ({ page }) => {
  const started = []
  await page.route('**/api/auth/discord?**', (route) => {
    started.push(new URL(route.request().url()))
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Discord</p>' })
  })

  await page.goto('/')
  await page.locator('.navbar').getByRole('button', { name: 'Sign in with Discord' }).click()
  await expect.poll(() => started.length).toBe(1)
  expect(started[0].searchParams.get('returnTo')).toBe('/dashboard')
  expect(started[0].searchParams.get('mode')).toBe('member')

  await page.goto('/guildweaver/connect?code=ABCD-EFGH')
  await page.getByRole('button', { name: 'Sign in with Discord' }).click()
  await expect.poll(() => started.length).toBe(2)
  expect(started[1].searchParams.get('returnTo')).toBe('/guildweaver/connect?code=ABCD-EFGH')
  expect(started[1].searchParams.get('mode'), 'sign-in never asks to join a server').toBe('member')
})

test('a successful sign-in lands without a confirmation step; problems say what happened', async ({ page, context }) => {
  const { authenticate } = await import('../helpers/auth.js')
  await page.goto('/?auth=cancelled')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Sign-in cancelled.' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Not now' }).click()
  await expect(page).toHaveURL((url) => url.search === '')

  await page.goto('/?auth=invalid-state')
  await expect(page.getByRole('heading', { name: 'That sign-in link expired.' })).toBeVisible()

  await authenticate(context, 'player')
  await page.goto('/dashboard?auth=connected')
  await expect(page.getByRole('button', { name: 'Account menu for Pip Player' })).toBeVisible()
  await expect(page).toHaveURL((url) => url.pathname === '/dashboard' && url.search === '')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(/Continue|Holdfast member session/)
})
