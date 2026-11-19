import { expect, test } from '@playwright/test'

import { authenticate } from '../helpers/auth.js'

// Dungeon wings against the real backend and the checked-in atlas: Scarlet
// Monastery (instance 189) is four dungeons on one game map. Each wing is a
// card and a deep link of its own; the old numeric link still opens the
// whole dungeon, which lists its wings.

test('each wing of Scarlet Monastery is its own card and opens its own bosses', async ({ page, context }) => {
  await authenticate(context, 'planner')
  await page.goto('/dashboard/dungeons')
  const library = page.getByRole('link', { name: /^Scarlet Monastery — Library/ })
  await expect(library).toBeVisible()
  for (const wing of ['Graveyard', 'Armory', 'Cathedral']) await expect(page.getByRole('link', { name: new RegExp(`^Scarlet Monastery — ${wing}`) })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Scarlet Monastery$/ })).toHaveCount(0)
  for (const name of ['Dire Maul — East', 'Dire Maul — West', 'Dire Maul — North', 'Lower Blackrock Spire', 'Upper Blackrock Spire',
    'Stratholme — Live \\(Main Gate\\)', 'Stratholme — Undead \\(Service Entrance\\)']) {
    await expect(page.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible()
  }
  // A single-instance dungeon is unchanged.
  await expect(page.getByRole('link', { name: /^Deadmines/ })).toBeVisible()

  await library.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Scarlet Monastery — Library' })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/open=scarlet-monastery%3Alibrary/)
  await dialog.getByRole('button', { name: 'Bosses', exact: true }).click()
  const bosses = dialog.getByRole('navigation', { name: 'Bosses' })
  await expect(bosses).toContainText('Arcanist Doan')
  await expect(bosses).toContainText('Houndmaster Loksey')
  await expect(bosses).not.toContainText('Herod')
  await expect(bosses).not.toContainText('Whitemane')
})

test('deep links open one wing; the old numeric link opens the whole dungeon', async ({ page, context }) => {
  await authenticate(context, 'planner')
  await page.goto('/dashboard/dungeons?open=dire-maul%3Anorth&section=bosses')
  const north = page.getByRole('dialog', { name: 'Dire Maul — North' })
  await expect(north.getByRole('navigation', { name: 'Bosses' })).toContainText('King Gordok')
  await expect(north.getByRole('navigation', { name: 'Bosses' })).not.toContainText('Immol\'thar')

  await page.goto('/dashboard/dungeons?open=189')
  const whole = page.getByRole('dialog', { name: 'Scarlet Monastery' })
  await expect(whole).toBeVisible()
  const wings = whole.getByRole('region', { name: 'Wings' })
  await expect(wings.getByRole('link')).toHaveCount(4)
  await wings.getByRole('link', { name: 'Scarlet Monastery — Cathedral' }).click()
  await expect(page).toHaveURL(/open=scarlet-monastery%3Acathedral/)
  await expect(page.getByRole('dialog', { name: 'Scarlet Monastery — Cathedral' })).toBeVisible()
})
