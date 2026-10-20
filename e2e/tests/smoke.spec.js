import { expect, test } from '@playwright/test'

test('public shell renders core pages', async ({ page }) => {
  await page.goto('/holdfast')
  await expect(page).toHaveTitle(/Holdfast/i)
  await expect(page.locator('body')).toContainText('Holdfast')

  await page.goto('/holdfast/charter')
  await expect(page).toHaveTitle(/Holdfast Charter/i)
  await expect(page.locator('body')).toContainText('Charter')

  await page.goto('/holdfast/ranks')
  await expect(page).toHaveTitle(/Ranks & Roles \| Holdfast/i)
  await expect(page.locator('body')).toContainText(/Ranks|Rep/i)
})

test('the guild directory is the front page and every guild drills down from its slug', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Guildweaver/i)
  const navbar = page.locator('.navbar')
  await expect(navbar.getByRole('link', { name: 'Guildweaver home' })).toBeVisible()
  await expect(navbar.getByRole('link', { name: 'Find guilds' })).toHaveAttribute('aria-current', 'page')
  await expect(navbar.getByRole('link', { name: 'Item catalog' })).toHaveAttribute('href', '/items')
  await expect(navbar.getByRole('link', { name: 'Addon' })).toHaveAttribute('href', '/guildweaver')

  await page.getByRole('option', { name: /Holdfast/ }).click()
  await expect(page).toHaveURL(/[?&]guild=holdfast/)
  await page.getByRole('complementary', { name: 'Guild details' }).getByRole('link', { name: 'Visit guild' }).click()
  await expect(page).toHaveURL(/\/holdfast$/)
  await expect(page.getByRole('heading', { name: 'Holdfast', level: 1 })).toBeVisible()
  await expect(navbar.getByRole('link', { name: 'Holdfast home' })).toBeVisible()
  await expect(navbar.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(navbar.getByRole('link', { name: 'Back to Guildweaver' })).toHaveAttribute('href', '/')
  await expect(page.locator('html')).toHaveAttribute('data-faction', 'alliance')
})

test('the guild finder is a fixed workspace: panes scroll, the window does not', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('listbox', { name: 'Guilds' })).toBeVisible()
  const windowScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
  expect(windowScroll).toBeLessThanOrEqual(1)

  await page.keyboard.press('ArrowDown')
  await expect(page).toHaveURL(/[?&]guild=/)
  await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/[?&]guild=/)

  await page.keyboard.press('/')
  await expect(page.getByRole('searchbox', { name: 'Search guilds' })).toBeFocused()
})

test('old single-guild paths land on their new home with the query kept', async ({ page }) => {
  for (const [from, to] of [['/charter', '/holdfast/charter'], ['/quests?q=linen', '/holdfast/quests?q=linen'], ['/guilds', '/'], ['/guilds/holdfast', '/holdfast']]) {
    await page.goto(from)
    await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === to)
  }
})

test('anonymous visitors are gated from the quest board', async ({ page }) => {
  await page.goto('/holdfast/quests')

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Member sign in' })).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Sign in with Discord' }),
  ).toBeVisible()
})

test('mobile public shell does not overflow horizontally', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/holdfast')
  await expect(page).toHaveTitle(/Holdfast/i)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )

  expect(overflow).toBeLessThanOrEqual(2)
})
