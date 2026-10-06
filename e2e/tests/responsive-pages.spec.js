import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

async function noOverflow(page) {
  const measurements = await page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const headings = [...document.querySelectorAll('main h1, main h2, .charter__maxim, .charter__motto')]
      .filter((element) => getComputedStyle(element).display !== 'none')
      .map((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        const rect = range.getBoundingClientRect()
        return { title: element.textContent.trim(), left: rect.left, right: rect.right }
      })
    return {
      overflow: document.documentElement.scrollWidth - width,
      cropped: headings.filter((rect) => rect.left < -1 || rect.right > width + 1),
    }
  })
  expect(measurements.overflow).toBeLessThanOrEqual(1)
  expect(measurements.cropped).toEqual([])
}

test('public pages and their headings fit narrow phones and tablets', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    for (const route of ['/charter', '/ranks', '/privacy', '/missing-page']) {
      await page.goto(route)
      await page.locator('main h1:visible').first().waitFor()
      await page.evaluate(() => document.fonts.ready)
      await noOverflow(page)
    }
  }
})

test('phone navigation, account, recruitment, and footer controls have usable touch targets', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  const controls = [
    page.locator('.navbar').getByRole('button', { name: 'Sign In', exact: true }),
    page.getByRole('button', { name: 'Toggle navigation' }),
    page.locator('footer').getByRole('link', { name: 'Privacy' }),
  ]
  for (const control of controls) {
    await expect(control).toBeVisible()
    const box = await control.boundingBox()
    expect(box.height).toBeGreaterThanOrEqual(44)
  }
  await page.getByRole('button', { name: 'Join Holdfast', exact: true }).first().click()
  const close = page.getByRole('button', { name: 'Close', exact: true })
  const box = await close.boundingBox()
  expect(box.width).toBeGreaterThanOrEqual(44)
  expect(box.height).toBeGreaterThanOrEqual(44)
  const memberSignIn = page.getByRole('button', { name: 'Sign in', exact: true })
  await memberSignIn.scrollIntoViewIfNeeded()
  expect((await memberSignIn.boundingBox()).height).toBeGreaterThanOrEqual(44)
  await close.scrollIntoViewIfNeeded()
  await close.click()
  await authenticate(context, 'member')
  await page.reload()
  const account = page.getByRole('button', { name: 'Open account menu for Mira Member' })
  await expect(account).toBeVisible()
  const accountBox = await account.boundingBox()
  expect(accountBox.width).toBeGreaterThanOrEqual(44)
  expect(accountBox.height).toBeGreaterThanOrEqual(44)
})

test('short public pages end at the footer without a trailing empty viewport', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/missing-page')
    await page.locator('main h1:visible').waitFor()
    await page.evaluate(() => document.fonts.ready)
    await noOverflow(page)
    const gap = await page.evaluate(() => document.documentElement.scrollHeight - document.querySelector('footer').getBoundingClientRect().bottom - window.scrollY)
    expect(Math.abs(gap)).toBeLessThanOrEqual(1)
  }
})
