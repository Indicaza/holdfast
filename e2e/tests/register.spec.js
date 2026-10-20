import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

const windowScroll = (page) => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)

// The seeded personas all belong to Holdfast. For the wizard, the browser is
// told it has no guild, and registration requests are answered here, so the
// disposable database is never written to.
async function asFounder(page, context) {
  await authenticate(context, 'member')
  await page.route('**/api/guilds/mine', (route) => route.fulfill({ json: { guild: null } }))
}

test('signed-out leaders get a compact pitch, members get the one-guild gate', async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/register')
  const pitch = page.getByRole('dialog', { name: 'List your guild in a few minutes.' })
  await expect(pitch.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible()
  await expect(pitch.getByRole('link', { name: 'Browse guilds' })).toHaveAttribute('href', '/')
  expect(await windowScroll(page)).toBeLessThanOrEqual(1)

  await authenticate(context, 'member')
  await page.reload()
  const gate = page.getByRole('dialog', { name: 'One guild at a time.' })
  await expect(gate).toContainText('member of Holdfast')
  await expect(gate.getByRole('link', { name: 'View Holdfast' })).toHaveAttribute('href', '/holdfast')
  await expect(gate.getByRole('button', { name: 'Leave Holdfast' })).toBeVisible()
})

test('registering is a fixed workspace: steps, form and the finder’s own preview', async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await asFounder(page, context)
  await page.goto('/register')

  const steps = page.getByRole('complementary', { name: 'Registration steps' })
  const preview = page.getByRole('complementary', { name: 'Preview' })
  await expect(page.getByRole('heading', { name: 'Identity', level: 2 })).toBeVisible()
  await expect(preview).toBeVisible()
  expect(await windowScroll(page)).toBeLessThanOrEqual(1)

  // Skipping ahead validates every step on the way.
  await steps.getByRole('button', { name: /^Step 3/ }).click()
  await expect(page.getByRole('heading', { name: 'Identity', level: 2 })).toBeVisible()
  await expect(steps.getByRole('button', { name: 'Step 1: Identity, needs attention' })).toBeVisible()
  await expect(page.getByText('Give your guild a name of at least two characters.')).toBeVisible()

  await page.getByLabel('Guild name').fill('Holdfast')
  await page.getByLabel('Motto').fill('We hold the line at dawn.')
  await page.getByRole('button', { name: 'Horde' }).click()
  await page.getByLabel('Realm', { exact: true }).fill('Doomhowl')
  await page.getByRole('button', { name: /^Hardcore:/ }).click()
  await expect(steps.getByRole('progressbar', { name: 'Required fields complete' })).toHaveAttribute('aria-valuenow', '4')

  // The preview is the finder's row and detail, updated as the leader types.
  const row = preview.getByRole('option', { name: /Holdfast/ })
  await expect(row).toContainText('Horde')
  await expect(row).toContainText('Hardcore')
  await expect(preview.getByRole('article', { name: 'Holdfast' })).toContainText('We hold the line at dawn.')

  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'How you play', level: 2 })).toBeFocused()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Pick at least one play style.')).toBeVisible()
  await page.getByRole('button', { name: 'Raiding', exact: true }).click()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Recruiting & Discord', level: 2 })).toBeVisible()
  await page.getByRole('button', { name: 'Priest', exact: true }).click()
  await expect(row).toContainText('Pri')

  // A server rejection opens the step that owns the field.
  let attempts = 0
  await page.route('**/api/guilds', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    attempts += 1
    return attempts === 1
      ? route.fulfill({ status: 409, json: { error: 'guild_slug_taken' } })
      : route.fulfill({ status: 201, json: { slug: 'holdfast' } })
  })
  await page.getByRole('button', { name: 'Register guild' }).click()
  await expect(page.getByRole('heading', { name: 'Identity', level: 2 })).toBeVisible()
  await expect(page.getByText('Another guild already has this name. Try a variation.')).toBeVisible()
  await expect(steps.getByRole('button', { name: 'Step 3: Recruiting & Discord, done' })).toBeVisible()

  await steps.getByRole('button', { name: /^Step 3/ }).click()
  await page.getByRole('button', { name: 'Register guild' }).click()
  await expect(page).toHaveURL(/\/holdfast$/)
})

test('the register preview is a drawer on laptops and a sheet behind a sticky action bar on phones', async ({ page, context }) => {
  await asFounder(page, context)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/register')
  const preview = page.getByRole('complementary', { name: 'Preview' })
  await expect(page.getByRole('heading', { name: 'Identity', level: 2 })).toBeVisible()
  await expect(preview).toBeHidden()
  await page.getByRole('button', { name: 'Show preview' }).click()
  await expect(preview).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(preview).toBeHidden()
  expect(await windowScroll(page)).toBeLessThanOrEqual(1)

  await page.setViewportSize({ width: 375, height: 812 })
  const continueButton = page.getByRole('button', { name: 'Continue' })
  await expect(continueButton).toBeInViewport()
  await page.getByLabel('Guild name').fill('Ashen Vanguard')
  await expect(continueButton).toBeInViewport()
  expect(await windowScroll(page)).toBeLessThanOrEqual(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)

  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(preview.getByRole('option', { name: /Ashen Vanguard/ })).toBeVisible()
  await preview.getByRole('button', { name: 'Close preview' }).click()
  await expect(preview).toBeHidden()
})
