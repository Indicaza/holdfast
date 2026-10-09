import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

async function submitTelemetry(page) {
  await page.goto('/')
  return page.evaluate(async () => {
    async function json(url, options = {}) {
      const { headers = {}, ...requestOptions } = options
      const response = await fetch(url, {
        ...requestOptions,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      })
      const body = await response.json()
      if (!response.ok) throw new Error(`${url}: ${response.status} ${JSON.stringify(body)}`)
      return body
    }

    const pairing = await json('/api/bridge/pairing/start', {
      method: 'POST',
      body: JSON.stringify({ deviceName: 'Live Feed E2E' }),
    })
    await json('/api/bridge/pairing/approve', {
      method: 'POST',
      body: JSON.stringify({ userCode: pairing.userCode }),
    })
    const token = await json('/api/bridge/pairing/token', {
      method: 'POST',
      body: JSON.stringify({ deviceCode: pairing.deviceCode }),
    })
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8)
    const name = `Live${suffix}`

    const result = await json('/api/bridge/characters/snapshot', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.deviceToken}` },
      body: JSON.stringify({
        revision: 9,
        snapshot: {
          schemaVersion: 2,
          capturedAt: Math.floor(Date.now() / 1000),
          characterId: `live-feed-e2e-${suffix}`,
          characterKey: `classic beta pve 2:${name.toLowerCase()}`,
          name,
          realm: 'Classic Beta PvE 2',
          region: 'US',
          level: 31,
          race: { id: 1, name: 'Human' },
          class: { id: 8, name: 'Mage' },
          specialization: { id: 63, name: 'Fire' },
          guild: { name: 'Holdfast' },
          equipment: [],
          talents: { trees: [] },
          professions: [],
        },
      }),
    })

    return { ...result, fixtureName: name }
  })
}

test('Guildweaver telemetry refreshes an open Intelligence dashboard without navigation', async ({ browser }) => {
  const viewer = await browser.newContext()
  const sender = await browser.newContext()
  await authenticate(viewer, 'member')
  await authenticate(sender, 'member')
  const page = await viewer.newPage()
  const senderPage = await sender.newPage()
  let intelligenceReads = 0

  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/intelligence') intelligenceReads += 1
  })

  try {
    await page.goto('/intelligence')
    await expect(page.getByRole('status', { name: 'Live updates: Live' })).toBeVisible()
    await expect(page.locator('.intelligence-app__topbar').getByRole('heading', { name: 'Overview' })).toBeVisible()
    const initialReads = intelligenceReads
    const urlBefore = page.url()

    const result = await submitTelemetry(senderPage)
    expect(result.status).toBe('created')

    await expect.poll(() => intelligenceReads).toBeGreaterThan(initialReads)
    await expect(page.getByText(result.fixtureName, { exact: true }).first()).toBeVisible()
    expect(page.url()).toBe(urlBefore)
    await expect(page.getByRole('status', { name: 'Live updates: Live' })).toBeVisible()
  } finally {
    await sender.close()
    await viewer.close()
  }
})

test('Guildweaver telemetry refreshes an open Armory in place instead of closing it', async ({ browser }) => {
  const viewer = await browser.newContext()
  const sender = await browser.newContext()
  await authenticate(viewer, 'member')
  await authenticate(sender, 'member')
  const page = await viewer.newPage()
  const senderPage = await sender.newPage()
  let armoryReads = 0

  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/intelligence/characters/')) armoryReads += 1
  })

  try {
    await page.goto('/intelligence#characters')
    await expect(page.getByRole('status', { name: 'Live updates: Live' })).toBeVisible()

    const character = await submitTelemetry(senderPage)
    expect(character.status).toBe('created')
    const card = page.locator('.character-card').filter({ hasText: character.fixtureName })
    await expect(card).toBeVisible()
    await card.click()

    const profile = page.getByRole('dialog')
    await expect(profile).toHaveAttribute('aria-label', character.fixtureName)
    await profile.getByRole('tab', { name: /^Professions/ }).click()
    await expect(profile.getByRole('tab', { name: /^Professions/ })).toHaveAttribute('aria-selected', 'true')
    const initialArmoryReads = armoryReads

    const unrelated = await submitTelemetry(senderPage)
    expect(unrelated.status).toBe('created')

    await expect.poll(() => armoryReads).toBeGreaterThan(initialArmoryReads)
    await expect(profile).toHaveAttribute('aria-label', character.fixtureName)
    await expect(profile.getByRole('tab', { name: /^Professions/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('dialog')).toHaveCount(1)
  } finally {
    await sender.close()
    await viewer.close()
  }
})
