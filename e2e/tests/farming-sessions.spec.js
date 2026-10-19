import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

test('farming runs show timing confidence, suppress partial rates and filter measured runs', async ({ page, context }) => {
  await authenticate(context, 'member')
  const automatic = { id: 2, mode: 'automatic', timing: 'estimated', quality: 'short_sample', durationSeconds: 60,
    observedGathers: 2, afkSeconds: null, zone: 'Duskwood', realm: 'Timer Realm', build: '70338',
    outputs: [{ itemKey: 'item:2447', name: 'Peacebloom', quantity: 4, perHour: null, perNonAfkHour: null }] }
  const measured = { ...automatic, id: 1, mode: 'manual', timing: 'measured', quality: 'awaiting_observations',
    durationSeconds: 1800, observedGathers: 9, afkSeconds: 300, classToken: 'DRUID' }
  let synced = false
  await page.route('**/api/intelligence/farming/sessions?**', async (route) => {
    const mode = new URL(route.request().url()).searchParams.get('mode')
    const ready = synced ? { ...measured, quality: 'sustained', observedGathers: 10,
      outputs: [{ ...measured.outputs[0], quantity: 20, perHour: 40, perNonAfkHour: 48 }] } : measured
    await route.fulfill({ json: { sessions: mode === 'manual' ? [ready] : mode === 'automatic' ? [automatic] : [ready, automatic] } })
  })
  await page.goto('/holdfast/intelligence#farming')
  const panel = page.locator('.farm-sessions')
  await panel.locator('summary').click()
  await expect(panel.getByText('Waiting for harvest sync', { exact: true })).toBeVisible()
  await expect(panel.getByText('Short sample', { exact: true })).toBeVisible()
  await expect(panel.getByText('40.0/hour', { exact: true })).toHaveCount(0)
  synced = true
  await panel.getByLabel('Timing', { exact: true }).selectOption('manual')
  await expect(panel.getByText('Measured run', { exact: true })).toBeVisible()
  await expect(panel.getByText('40.0/hour', { exact: true })).toBeVisible()
  await expect(panel).toContainText('48.0/hour excluding AFK')
  await expect(panel).toContainText('30m · 10 harvests')
  await expect(panel.getByText('Short sample', { exact: true })).toHaveCount(0)
  await panel.getByLabel('Timing', { exact: true }).selectOption('automatic')
  await expect(panel.getByText('Short sample', { exact: true })).toBeVisible()
  await expect(panel.getByText('Measured run', { exact: true })).toHaveCount(0)
})
