import assert from 'node:assert/strict'
import test from 'node:test'
import { HeroPlayback } from '../src/Home/HeroStory/heroPlayback.js'

function setup(loadImage = async () => {}) {
  let time = 0
  let nextId = 0
  const timers = new Map()
  const clock = {
    setTimeout: (callback, delay) => {
      const id = ++nextId
      timers.set(id, { callback, at: time + delay })
      return id
    },
    clearTimeout: (id) => timers.delete(id),
  }
  const playback = new HeroPlayback({
    slides: [{ src: 'one' }, { src: 'two' }, { src: 'three' }],
    loadImage,
    initialDuration: 18000,
    duration: 16000,
    transitionDuration: 2600,
    clock,
    now: () => time,
  })
  const flush = async () => {
    await Promise.resolve()
    await Promise.resolve()
  }
  const advance = async (duration) => {
    const end = time + duration
    while (true) {
      const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
      if (!entry || entry[1].at > end) break
      time = entry[1].at
      timers.delete(entry[0])
      entry[1].callback()
      await flush()
    }
    time = end
    await flush()
  }
  playback.start()
  return { playback, flush, advance }
}

test('autoplay changes captions at the crossfade midpoint and keeps the full reading interval', async () => {
  const { playback, flush, advance } = setup()
  await flush()
  await advance(17999)
  assert.equal(playback.state.imageIndex, 0)
  await advance(1)
  assert.equal(playback.state.imageIndex, 1)
  assert.equal(playback.state.captionIndex, 0)
  assert.equal(playback.state.previousIndex, 0)
  await advance(1300)
  assert.equal(playback.state.captionIndex, 1)
  await advance(1300)
  assert.equal(playback.state.previousIndex, null)
  await advance(15999)
  assert.equal(playback.state.imageIndex, 1)
  await advance(1)
  assert.equal(playback.state.imageIndex, 2)
})

test('independent pause reasons preserve the exact remaining time', async () => {
  const { playback, flush, advance } = setup()
  await flush()
  await advance(7000)
  playback.setPauseReason('hidden', true)
  playback.setPauseReason('overlay', true)
  await advance(30000)
  playback.setPauseReason('hidden', false)
  await advance(30000)
  assert.equal(playback.state.imageIndex, 0)
  playback.setPauseReason('overlay', false)
  await advance(10999)
  assert.equal(playback.state.imageIndex, 0)
  await advance(1)
  assert.equal(playback.state.imageIndex, 1)
})

test('pausing during a crossfade freezes its caption phase', async () => {
  const { playback, flush, advance } = setup()
  await flush()
  await advance(18500)
  playback.toggle()
  await advance(30000)
  assert.equal(playback.state.captionIndex, 0)
  playback.toggle()
  await advance(799)
  assert.equal(playback.state.captionIndex, 0)
  await advance(1)
  assert.equal(playback.state.captionIndex, 1)
})

test('manual navigation wraps, synchronizes immediately, and stays paused until play', async () => {
  const { playback, flush, advance } = setup()
  await flush()
  playback.navigate(-1)
  await flush()
  assert.equal(playback.state.imageIndex, 2)
  assert.equal(playback.state.captionIndex, 2)
  assert.equal(playback.state.previousIndex, null)
  await advance(30000)
  assert.equal(playback.state.imageIndex, 2)
  playback.navigate(1)
  await flush()
  assert.equal(playback.state.captionIndex, 0)
  playback.toggle()
  await advance(16000)
  assert.equal(playback.state.imageIndex, 1)
})

test('manual navigation can interrupt a crossfade without leaving a stale caption', async () => {
  const { playback, flush, advance } = setup()
  await flush()
  await advance(18500)
  playback.navigate(1)
  await flush()
  assert.equal(playback.state.captionIndex, 2)
  assert.equal(playback.state.phase, 'holding')
  await advance(30000)
  assert.equal(playback.state.captionIndex, 2)
})

test('artwork is decoded before advancing and failures can be retried', async () => {
  let fail = true
  let resolveImage
  const { playback, flush, advance } = setup((src) => {
    if (src !== 'two') return Promise.resolve()
    if (fail) return Promise.reject(new Error('offline'))
    return new Promise((resolve) => { resolveImage = resolve })
  })
  await flush()
  await advance(18000)
  assert.equal(playback.state.imageIndex, 0)
  assert.ok(playback.state.loadError)
  fail = false
  playback.retry()
  await advance(30000)
  assert.equal(playback.state.imageIndex, 0)
  assert.equal(playback.state.isLoading, true)
  resolveImage()
  await flush()
  assert.equal(playback.state.imageIndex, 1)
  assert.equal(playback.state.loadError, '')
  await advance(2600)
  assert.equal(playback.state.captionIndex, 1)
})

test('reduced motion begins paused and optional autoplay swaps scenes without a fade', async () => {
  const { playback, flush, advance } = setup()
  playback.setReducedMotion(true)
  await flush()
  await advance(30000)
  assert.equal(playback.state.imageIndex, 0)
  playback.toggle()
  await advance(18000)
  assert.equal(playback.state.imageIndex, 1)
  assert.equal(playback.state.captionIndex, 1)
  assert.equal(playback.state.phase, 'holding')
})

test('enabling reduced motion during a fade finishes the scene and pauses it', async () => {
  const { playback, flush, advance } = setup()
  await flush()
  await advance(18500)
  playback.setReducedMotion(true)
  assert.equal(playback.state.captionIndex, 1)
  assert.equal(playback.state.imageIndex, 1)
  assert.equal(playback.state.previousIndex, null)
  assert.equal(playback.state.phase, 'holding')
  await advance(30000)
  assert.equal(playback.state.captionIndex, 1)
})

test('stopped controllers ignore a pending image load and can restart safely', async () => {
  let resolveImage
  const { playback, flush, advance } = setup(() => new Promise((resolve) => { resolveImage = resolve }))
  playback.stop()
  resolveImage()
  await flush()
  assert.equal(playback.state.isLoading, true)
  playback.start()
  resolveImage()
  await flush()
  assert.equal(playback.state.isLoading, false)
  playback.stop()
  await advance(30000)
  assert.equal(playback.state.imageIndex, 0)
})
