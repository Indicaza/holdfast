import { expect, test } from '@playwright/test'

import { ready, stopClock } from './helpers/hero.js'

const artwork = (page) => page.locator('.hero-slideshow__slide--active')
const caption = (page) => page.locator('.hero-slideshow__caption')

async function transformMatrix(locator) {
  return locator.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
    return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
  })
}

function expectSameTransform(actual, expected) {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index], 5)
  })
}

test('all eleven scenes stay in story order and manual playback wraps', async ({ page }) => {
  await stopClock(page)
  await ready(page)
  const next = page.getByRole('button', { name: 'Next story' })
  const previous = page.getByRole('button', { name: 'Previous story' })
  const scenes = ['home', 'gnome', 'dwarf', 'dungeon', 'tank', 'death', 'aftermath', 'smith', 'mount', 'pvp', 'rag']

  for (const scene of scenes) {
    await expect(artwork(page)).toHaveAttribute('data-scene', scene)
    await next.click()
  }

  await expect(artwork(page)).toHaveAttribute('data-scene', 'home')
  await previous.click()
  await expect(artwork(page)).toHaveAttribute('data-scene', 'rag')
})

test('autoplay crossfade, caption, and drift pause together', async ({ page }) => {
  await stopClock(page)
  await ready(page)
  await page.clock.runFor(18000)
  await expect(artwork(page)).toHaveAttribute('data-scene', 'dwarf')
  await expect(caption(page)).toHaveAttribute('data-caption', 'gnome')
  await page.clock.runFor(500)
  await page.getByRole('button', { name: 'Pause story' }).click()
  await expect(page.locator('.hero-slideshow')).toHaveClass(/paused/)
  const art = page.locator('.hero-slideshow__slide--active .hero-slideshow__art')
  const before = await transformMatrix(art)
  await page.clock.runFor(30000)
  await expect(caption(page)).toHaveAttribute('data-caption', 'gnome')
  expectSameTransform(await transformMatrix(art), before)
  await page.getByRole('button', { name: 'Play story' }).click()
  await page.clock.runFor(800)
  await expect(caption(page)).toHaveAttribute('data-caption', 'dwarf')
  await page.clock.runFor(1300)
  await expect(page.locator('.hero-slideshow__slide')).toHaveCount(1)
})

test('recruitment overlays and scrolling away suspend playback', async ({ page }) => {
  await stopClock(page)
  await ready(page)
  await page.getByRole('button', { name: 'Join Holdfast', exact: true }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('.hero-slideshow')).toHaveClass(/paused/)
  await page.clock.runFor(30000)
  await expect(caption(page)).toHaveAttribute('data-caption', 'gnome')
  await page.getByRole('button', { name: 'Close' }).click()
  await page.locator('#values').scrollIntoViewIfNeeded()
  await expect(page.locator('.hero-slideshow')).toHaveClass(/paused/)
})

test('reduced motion starts paused and mobile captions sit below the artwork', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await stopClock(page)
  await ready(page)
  await expect(page.locator('.hero-slideshow')).toHaveClass(/paused/)

  const artBox = await page.locator('.hero-slideshow__stage').boundingBox()
  const captionBox = await caption(page).boundingBox()
  expect(artBox).not.toBeNull()
  expect(captionBox).not.toBeNull()
  expect(captionBox.y).toBeGreaterThanOrEqual(artBox.y + artBox.height - 1)
})

test('changing the motion preference during a fade keeps artwork and caption aligned', async ({ page }) => {
  await stopClock(page)
  await ready(page)
  await page.clock.runFor(18000)
  await expect(artwork(page)).toHaveAttribute('data-scene', 'dwarf')
  await expect(caption(page)).toHaveAttribute('data-caption', 'gnome')
  await page.clock.runFor(500)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.runFor(2000)
  await expect(page.locator('.hero-slideshow')).toHaveClass(/paused/)
  await expect(artwork(page)).toHaveAttribute('data-scene', 'dwarf')
  await expect(caption(page)).toHaveAttribute('data-caption', 'dwarf')
})

test('failed artwork keeps the current scene and offers a working retry', async ({ page }) => {
  await stopClock(page)
  await page.route('**/gnome-*.webp', (route) => route.abort())
  await ready(page)
  await page.getByRole('button', { name: 'Next story' }).click()
  await expect(artwork(page)).toHaveAttribute('data-scene', 'gnome')
  await expect(page.getByText('Scene unavailable')).toBeVisible()

  await page.unroute('**/gnome-*.webp')
  await page.getByRole('button', { name: 'Retry scene' }).click()
  await expect(page.getByText('Scene unavailable')).toHaveCount(0)
  await expect(artwork(page).locator('img')).toBeVisible()
})
