import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

// Syncs a character snapshot through a freshly paired bridge device. Pass a
// previous result as `again` to sync the same character a second time (one
// level higher, a second later).
async function submitTelemetry(page, again = null) {
  await page.goto('/')
  return page.evaluate(async (again) => {
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

    let token = again?.token
    if (!token) {
      const pairing = await json('/api/bridge/pairing/start', {
        method: 'POST',
        body: JSON.stringify({ deviceName: 'Live Feed E2E' }),
      })
      await json('/api/bridge/pairing/approve', {
        method: 'POST',
        body: JSON.stringify({ userCode: pairing.userCode }),
      })
      token = await json('/api/bridge/pairing/token', {
        method: 'POST',
        body: JSON.stringify({ deviceCode: pairing.deviceCode }),
      })
    }
    const suffix = again?.suffix || crypto.randomUUID().replaceAll('-', '').slice(0, 8)
    const name = `Live${suffix}`
    const level = again ? again.level + 1 : 31

    const result = await json('/api/bridge/characters/snapshot', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.deviceToken}` },
      body: JSON.stringify({
        revision: again ? 10 : 9,
        snapshot: {
          schemaVersion: 2,
          capturedAt: Math.floor(Date.now() / 1000) + (again ? 1 : 0),
          characterId: `live-feed-e2e-${suffix}`,
          characterKey: `classic beta pve 2:${name.toLowerCase()}`,
          name,
          realm: 'Classic Beta PvE 2',
          region: 'US',
          level,
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

    return { ...result, fixtureName: name, token, suffix, level }
  }, again)
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

test('an open Armory refreshes in place for its own character and ignores the rest', async ({ browser }) => {
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
    expect(new URL(page.url()).searchParams.get('character')).toBe(character.character.id)
    // Recipe books load when the professions tab first opens.
    const recipeBook = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/recipes'))
    await profile.getByRole('tab', { name: /^Professions/ }).click()
    await expect(profile.getByRole('tab', { name: /^Professions/ })).toHaveAttribute('aria-selected', 'true')
    expect((await recipeBook).status()).toBe(200)

    // The character's own creation is announced once its read model settles
    // (the server coalesces a burst for 750 ms), which can land after the
    // modal opened and refresh it. Count only what happens after that.
    await page.waitForTimeout(1200)

    // Someone else's character changing leaves the open modal alone.
    const readsBeforeUnrelated = armoryReads
    const unrelated = await submitTelemetry(senderPage)
    expect(unrelated.status).toBe('created')
    await expect(page.locator('.character-card').filter({ hasText: unrelated.fixtureName })).toBeVisible()
    await page.waitForTimeout(1000)
    expect(armoryReads).toBe(readsBeforeUnrelated)
    await expect(page.getByRole('dialog')).toHaveCount(1)

    // Its own character changing refreshes it in place: same tab, new data.
    const update = await submitTelemetry(senderPage, character)
    expect(update.status).toBe('updated')
    await expect.poll(() => armoryReads).toBeGreaterThan(readsBeforeUnrelated)
    await expect(profile.getByText(`${character.level + 1}`, { exact: true }).first()).toBeVisible()
    await expect(profile.getByRole('tab', { name: /^Professions/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('dialog')).toHaveCount(1)

    // The open character is in the URL, so a reload reopens it.
    await page.reload()
    await expect(page.getByRole('dialog')).toHaveAttribute('aria-label', character.fixtureName)
  } finally {
    await sender.close()
    await viewer.close()
  }
})

test('another member\'s change refreshes the directory in place without remounting the app', async ({ browser }) => {
  const viewer = await browser.newContext()
  const sender = await browser.newContext()
  await authenticate(viewer, 'member')
  await authenticate(sender, 'officer')
  const page = await viewer.newPage()
  const senderPage = await sender.newPage()

  try {
    const liveStream = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/notifications/live')
    await page.goto('/members')
    await liveStream
    const search = page.locator('main input[type="search"]')
    await search.fill('Owen')
    // Tag the navbar node: a remount would replace it.
    await page.locator('.navbar').evaluate((navbar) => { navbar.dataset.probe = 'kept' })

    await senderPage.goto('/')
    const directoryRefresh = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/guild/members')
    const saved = await senderPage.evaluate(async () => {
      const response = await fetch('/api/guild/members/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: { bio: `Live refresh ${Date.now()}` } }),
      })
      return response.status
    })
    expect(saved).toBe(200)
    await directoryRefresh

    await expect(page.locator('.navbar')).toHaveAttribute('data-probe', 'kept')
    await expect(search).toHaveValue('Owen')
  } finally {
    await sender.close()
    await viewer.close()
  }
})
