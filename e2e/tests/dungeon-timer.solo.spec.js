import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'
import { connectAndSync } from '../helpers/player.js'

test('a timed dungeon upload shows the clock and split from the addon', async ({ page, context }) => {
  const transport = JSON.parse(readFileSync(new URL('../../backend/test/fixtures/dungeon-timer-transport.json', import.meta.url)))
  await authenticate(context, 'dungeonRunner')
  await page.goto('/dashboard/dungeons')
  await connectAndSync(page, { deviceName: 'Dungeon timer', telemetry: [transport] })
  await page.reload()
  await page.getByRole('link', { name: /Scarlet Monastery/ }).first().click()
  const summary = page.getByRole('region', { name: 'Run summary' })
  await expect(summary).toContainText('Run timer')
  await expect(summary).toContainText('3:00')
  await expect(page.locator('#player-dungeon-checkpoints tr').filter({ hasText: 'Audit' })).toContainText('3:00')
})
