import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

test('recruitment preserves the public page, scroll position, and keyboard focus', async ({ page }) => {
  await page.goto('/ranks')
  const join = page.locator('.public-join-callout').getByRole('link', { name: 'Join Holdfast' })
  await join.scrollIntoViewIfNeeded()
  const before = await page.evaluate(() => window.scrollY)
  const fallback = new URL(await join.getAttribute('href'), 'https://holdfast.invalid')
  expect(fallback.searchParams.get('returnTo')).toBe('/ranks')
  await join.click()
  await expect(page).toHaveURL(/\/ranks$/)
  await expect(page.getByRole('dialog')).toContainText('Come play with us.')
  await expect(page.getByRole('button', { name: 'Continue with Discord' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(join).toBeFocused()
  expect(Math.abs(await page.evaluate(() => window.scrollY) - before)).toBeLessThanOrEqual(2)
})

test('footer exposes utility links and direct join links return to their source', async ({ page }) => {
  await page.goto('/privacy')
  const footer = page.locator('footer')
  const guildweaver = footer.getByRole('link', { name: 'Guildweaver' })
  const privacy = footer.getByRole('link', { name: 'Privacy' })
  const source = footer.getByRole('link', { name: 'Source' })
  await expect(guildweaver).toBeVisible()
  await expect(privacy).toBeVisible()
  await expect(source).toBeVisible()
  expect(await guildweaver.getAttribute('href')).toBe('/guildweaver')
  expect(await privacy.getAttribute('href')).toBe('/privacy')
  expect(await source.getAttribute('href')).toBe('https://github.com/Indicaza/holdfast')

  await page.goto('/join?returnTo=%2Franks')
  await expect(page.getByRole('dialog')).toContainText('Come play with us.')
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/ranks$/)
  await page.goto('/join?returnTo=%2F%5Cexample.com')
  await expect(page.getByRole('dialog')).toContainText('Come play with us.')
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/$/)
})

test('joining from the member gate closes only recruitment and restores the gate', async ({ page }) => {
  await page.goto('/quests')
  await expect(page.getByRole('dialog')).toContainText('Member sign in')
  await page.getByRole('link', { name: 'New to Holdfast? Join the guild' }).click()
  await expect(page.getByRole('button', { name: 'Continue with Discord' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toContainText('Member sign in')
  await expect(page).toHaveURL(/\/quests$/)
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
})

test('public quest signup recruits with the selected objective preserved', async ({ page }) => {
  let authTarget
  await page.route('**/api/auth/discord?*', (route) => {
    authTarget = new URL(route.request().url())
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Discord handoff captured</p>' })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign up for Scout the roads' }).click()
  await expect(page.getByRole('dialog')).toContainText('Join first, then lend a hand.')
  await expect(page).toHaveURL(/\/$/)
  await page.getByRole('button', { name: 'Continue with Discord' }).click()
  await expect(page.locator('body')).toContainText('Discord handoff captured')
  expect(authTarget.searchParams.get('mode')).toBe('recruit')
  const destination = new URL(authTarget.searchParams.get('returnTo'), 'https://holdfast.invalid')
  expect(destination.pathname).toBe('/')
  expect(destination.searchParams.get('signupQuest')).toBe('e2e-supply-run')
  expect(destination.searchParams.get('signupObjective')).toBe('e2e-patrol')
})

test('Discord onboarding returns a member to the intended objective without auto-signup', async ({ page, context }) => {
  await authenticate(context, 'member')
  const destination = '/?signupQuest=e2e-supply-run&signupObjective=e2e-patrol&questAction=signup'
  let mutations = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/quests/member/signup') mutations += 1
  })
  await page.goto(`/join?${new URLSearchParams({ auth: 'connected', returnTo: destination })}`)
  await expect(page.getByRole('dialog')).toContainText('Bring Holdfast into WoW.')
  await page.getByRole('button', { name: 'Continue to objective' }).click()
  await expect(page.getByRole('dialog')).toContainText('Scout the roads')
  await expect(page.getByRole('button', { name: 'Sign me up' })).toBeVisible()
  expect(mutations).toBe(0)
  await page.getByRole('button', { name: 'Not yet' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(new URL(page.url()).searchParams.has('signupQuest')).toBe(false)
})
