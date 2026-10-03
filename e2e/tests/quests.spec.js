import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

async function openQuest(page) {
  const card = page.getByRole('button', { name: /E2E Supply Run/ })
  await expect(card).toBeVisible()
  await card.click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

test.describe.serial('quest browser regression coverage', () => {
  test('member signs up and requests completion', async ({ browser }) => {
    const context = await browser.newContext()
    await authenticate(context, 'member')
    const page = await context.newPage()

    await page.goto('/quests')
    await expect(
      page.getByRole('button', { name: 'Create quest', exact: true }),
    ).toHaveCount(0)

    await openQuest(page)
    await page.getByRole('button', { name: 'Sign up', exact: true }).first().click()

    const signup = page.getByRole('dialog')
    await expect(signup.getByRole('heading', { name: 'Gather the linen' })).toBeVisible()
    await signup.getByRole('button', { name: 'Sign me up' }).click()
    await expect(page.getByRole('heading', { name: 'You are on it.' })).toBeVisible()
    await page.getByRole('button', { name: 'Back to the quest' }).click()

    await openQuest(page)
    const linen = page.locator('article').filter({ hasText: 'Gather the linen' })
    await expect(linen.getByText('Mira Member')).toBeVisible()
    await linen.getByLabel(/Completion note/).fill('Twenty linen delivered to the bank.')
    await linen.getByRole('button', { name: 'Request completion' }).click()

    await expect(linen.getByText('Completion requested.')).toBeVisible()
    await expect(linen.getByText('Ready for review')).toBeVisible()

    await context.close()
  })

  test('officer reviews work, approves reward, and completes the objective', async ({ browser }) => {
    const context = await browser.newContext()
    await authenticate(context, 'officer')
    const page = await context.newPage()

    await page.goto('/quests')
    await openQuest(page)

    const linen = page.locator('article').filter({ hasText: 'Gather the linen' })
    await expect(linen.getByText('Ready for review')).toBeVisible()
    await linen.getByRole('button', { name: 'Approve work' }).click()
    await expect(linen.getByText('Work approved.')).toBeVisible()

    await linen.getByRole('button', { name: 'Approve reward' }).click()
    await expect(page.getByText(/Reward approved\./)).toBeVisible()

    await linen.getByRole('button', { name: 'Complete & award' }).click()
    await expect(
      page.getByText(/Objective complete\. Issued 100 Rep and 5 Marks across 1 member/),
    ).toBeVisible()
    await expect(linen.getByText('Complete', { exact: true })).toBeVisible()

    await context.close()
  })

  test('member can sign up for and leave another objective', async ({ browser }) => {
    const context = await browser.newContext()
    await authenticate(context, 'member')
    const page = await context.newPage()

    await page.goto('/quests')
    await openQuest(page)

    const scout = page.locator('article').filter({ hasText: 'Scout the roads' })
    await scout.getByRole('button', { name: 'Sign up' }).click()
    await page.getByRole('button', { name: 'Sign me up' }).click()
    await expect(page.getByRole('heading', { name: 'You are on it.' })).toBeVisible()
    await page.getByRole('button', { name: 'Back to the quest' }).click()

    await openQuest(page)
    const assignedScout = page.locator('article').filter({ hasText: 'Scout the roads' })
    await assignedScout.getByRole('button', { name: 'Leave objective' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Leave objective' }).click()

    await openQuest(page)
    const reopenedScout = page.locator('article').filter({ hasText: 'Scout the roads' })
    await expect(reopenedScout.getByRole('button', { name: 'Sign up' })).toBeVisible()

    await context.close()
  })

  test('commander can create a draft quest from the board', async ({ browser }) => {
    const context = await browser.newContext()
    await authenticate(context, 'commander')
    const page = await context.newPage()

    await page.goto('/quests')
    await page.getByRole('button', { name: 'Create quest', exact: true }).first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Create a quest' })).toBeVisible()
    await dialog.getByLabel('Quest title').fill('Browser-created quest')
    await dialog.getByRole('button', { name: 'Create quest', exact: true }).click()

    await expect(page.getByText('Quest created.')).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(
      page.getByRole('button', { name: /Browser-created quest/ }),
    ).toBeVisible()

    await context.close()
  })
})
