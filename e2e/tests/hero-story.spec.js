import { expect, test } from '@playwright/test'

const scenes = ['gnome', 'dwarf', 'smith', 'tank', 'dungeon', 'mount', 'pvp', 'death', 'rag', 'home', 'aftermath']
const artwork = (page) => page.locator('.hero-slideshow__slide--active')
const caption = (page) => page.locator('.hero-content__story')

async function ready(page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Next scene' })).toBeEnabled()
}

async function stopClock(page) {
  await page.clock.install()
  await page.clock.pauseAt(new Date())
}

function expectTransformClose(actual, expected) {
  const values = (transform) => transform.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || []
  const actualValues = values(actual)
  const expectedValues = values(expected)
  expect(actualValues).toHaveLength(expectedValues.length)
  actualValues.forEach((value, index) => expect(value).toBeCloseTo(expectedValues[index], 5))
}

test('all eleven scenes stay in story order and manual playback wraps', async ({ page }) => {
  await ready(page)
  for (const [index, scene] of scenes.entries()) {
    await expect(artwork(page)).toHaveAttribute('data-scene', scene)
    await expect(caption(page)).toHaveAttribute('data-caption', scene)
    await expect(page.getByLabel(`Scene ${index + 1} of 11`, { exact: true })).toBeVisible()
    await expect(page.locator('.hero-content__description')).toBeVisible()
    await page.getByRole('button', { name: 'Next scene' }).click()
  }
  await expect(caption(page)).toHaveAttribute('data-caption', 'gnome')
  await expect(page.getByRole('button', { name: 'Play story' })).toBeVisible()
  await page.getByRole('button', { name: 'Previous scene' }).click()
  await expect(caption(page)).toHaveAttribute('data-caption', 'aftermath')
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
  const before = await art.evaluate((element) => getComputedStyle(element).transform)
  await page.clock.runFor(30000)
  await expect(caption(page)).toHaveAttribute('data-caption', 'gnome')
  expectTransformClose(await art.evaluate((element) => getComputedStyle(element).transform), before)
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
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.hero-slideshow')).not.toHaveClass(/paused/)
  await page.locator('footer').scrollIntoViewIfNeeded()
  await expect(page.locator('.hero-slideshow')).toHaveClass(/paused/)
  await page.clock.runFor(30000)
  await expect(caption(page)).toHaveAttribute('data-caption', 'gnome')
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page.locator('.hero-slideshow')).not.toHaveClass(/paused/)
  await page.clock.runFor(18000)
  await expect(artwork(page)).toHaveAttribute('data-scene', 'dwarf')
})

test('reduced motion starts paused and mobile captions sit below the artwork', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await stopClock(page)
  await ready(page)
  await expect(page.getByRole('button', { name: 'Play story' })).toBeVisible()
  await page.clock.runFor(60000)
  await expect(caption(page)).toHaveAttribute('data-caption', 'gnome')
  for (const scene of scenes) {
    await expect(caption(page)).toHaveAttribute('data-caption', scene)
    const imageBox = await page.locator('.hero-slideshow').boundingBox()
    const contentBox = await page.locator('.hero-content').boundingBox()
    expect(contentBox.y).toBeGreaterThanOrEqual(imageBox.y + imageBox.height)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2)
    await page.getByRole('button', { name: 'Next scene' }).click()
  }
  await page.setViewportSize({ width: 320, height: 568 })
  await expect(page.locator('.hero-content__description')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2)
})

test('changing the motion preference during a fade keeps artwork and caption aligned', async ({ page }) => {
  await stopClock(page)
  await ready(page)
  await page.clock.runFor(18500)
  await expect(artwork(page)).toHaveAttribute('data-scene', 'dwarf')
  await expect(caption(page)).toHaveAttribute('data-caption', 'gnome')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(caption(page)).toHaveAttribute('data-caption', 'dwarf')
  await expect(page.getByRole('button', { name: 'Play story' })).toBeVisible()
  await expect(page.locator('.hero-slideshow__slide')).toHaveCount(1)
  await page.clock.runFor(30000)
  await expect(caption(page)).toHaveAttribute('data-caption', 'dwarf')
})

test('failed artwork keeps the current scene and offers a working retry', async ({ page }) => {
  await page.route('**/assets/dwarf-*.webp', (route) => route.abort())
  await ready(page)
  await page.getByRole('button', { name: 'Next scene' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Artwork could not load' })).toBeVisible()
  await expect(artwork(page)).toHaveAttribute('data-scene', 'gnome')
  await expect(caption(page)).toHaveAttribute('data-caption', 'gnome')
  await page.unroute('**/assets/dwarf-*.webp')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(caption(page)).toHaveAttribute('data-caption', 'dwarf')
  await expect(page.getByRole('button', { name: 'Play story' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
})
