import { expect, test } from '@playwright/test'

test('public shell renders core pages', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Holdfast/i)
  await expect(page.locator('body')).toContainText('Holdfast')

  await page.goto('/charter')
  await expect(page).toHaveTitle(/Charter.*Holdfast/i)
  await expect(page.locator('body')).toContainText('Charter')

  await page.goto('/ranks')
  await expect(page).toHaveTitle(/Ranks.*Holdfast/i)
  await expect(page.locator('body')).toContainText(/Ranks|Rep/i)
})

test('anonymous visitors are gated from the quest board', async ({ page }) => {
  await page.goto('/quests')

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Member sign in' })).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Sign in with Discord' }),
  ).toBeVisible()
})

test('mobile public shell does not overflow horizontally', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page).toHaveTitle(/Holdfast/i)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )

  expect(overflow).toBeLessThanOrEqual(2)
})
