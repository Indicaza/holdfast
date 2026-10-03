import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

test('signed-in members can browse the directory and profiles', async ({ browser }) => {
  const context = await browser.newContext()
  await authenticate(context, 'member')
  const page = await context.newPage()

  await page.goto('/members')
  await expect(page.locator('body')).toContainText('Mira Member')
  await expect(page.locator('body')).toContainText('Owen Officer')

  await page.goto('/members/e2e-member')
  await expect(page.locator('body')).toContainText('Mira Member')
  await expect(page.locator('body')).toContainText('Private')
  await expect(page.locator('body')).toContainText('Browser-test guild member.')

  await context.close()
})
