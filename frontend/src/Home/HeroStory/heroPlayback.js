const imageLoads = new Map()

export function loadHeroImage(src) {
  if (!imageLoads.has(src)) {
    const image = new Image()
    image.decoding = 'async'
    const loaded = new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => reject(new Error('Artwork timed out')), 12000)
      image.onload = () => {
        globalThis.clearTimeout(timeout)
        resolve()
      }
      image.onerror = () => {
        globalThis.clearTimeout(timeout)
        reject(new Error('Artwork unavailable'))
      }
      image.src = src
    }).then(() => image.decode()).catch((error) => {
      imageLoads.delete(src)
      throw error
    })
    imageLoads.set(src, loaded)
  }
  return imageLoads.get(src)
}

export class HeroPlayback {
  constructor({ slides, loadImage, initialDuration, duration, transitionDuration, clock = globalThis, now = () => performance.now() }) {
    this.slides = slides
    this.loadImage = loadImage
    this.initialDuration = initialDuration
    this.duration = duration
    this.transitionDuration = transitionDuration
    this.clock = clock
    this.now = now
    this.listeners = new Set()
    this.reasons = new Set()
    this.running = false
    this.request = 0
    this.timer = null
    this.task = null
    this.remaining = 0
    this.ready = false
    this.state = {
      imageIndex: 0,
      previousIndex: null,
      captionIndex: 0,
      visit: 0,
      previousVisit: null,
      phase: 'holding',
      isPaused: false,
      userPaused: false,
      reducedMotion: false,
      isLoading: true,
      loadError: '',
    }
  }

  subscribe = (listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.state

  update(values) {
    this.state = { ...this.state, ...values }
    this.listeners.forEach((listener) => listener())
  }

  suspend() {
    if (this.timer !== null) {
      this.remaining = Math.max(0, this.deadline - this.now())
      this.clock.clearTimeout(this.timer)
      this.timer = null
    }
  }

  resume() {
    if (!this.running || this.reasons.size || !this.task || this.timer !== null) return
    this.deadline = this.now() + this.remaining
    this.timer = this.clock.setTimeout(() => {
      this.timer = null
      const task = this.task
      this.task = null
      task()
    }, this.remaining)
  }

  schedule(task, duration) {
    this.suspend()
    this.task = task
    this.remaining = duration
    this.resume()
  }

  setPauseReason(reason, paused) {
    if (this.reasons.has(reason) === paused) return
    this.suspend()
    if (paused) this.reasons.add(reason)
    else this.reasons.delete(reason)
    this.update({ isPaused: this.reasons.size > 0, userPaused: this.reasons.has('user') })
    this.resume()
  }

  setReducedMotion(reducedMotion) {
    this.update({ reducedMotion })
    if (reducedMotion) this.setPauseReason('user', true)
  }

  toggle = () => this.setPauseReason('user', !this.state.userPaused)

  start() {
    this.running = true
    if (this.ready) {
      this.resume()
      return
    }
    this.prepare(0, true)
  }

  stop() {
    this.suspend()
    this.running = false
    this.request += 1
  }

  preload() {
    const nextIndex = (this.state.imageIndex + 1) % this.slides.length
    this.loadImage(this.slides[nextIndex].src).catch(() => {})
  }

  hold() {
    this.update({ previousIndex: null, previousVisit: null, phase: 'holding' })
    this.preload()
    this.schedule(() => this.prepare((this.state.imageIndex + 1) % this.slides.length),
      this.state.visit === 0 ? this.initialDuration : this.duration)
  }

  async prepare(index, initial = false) {
    const request = ++this.request
    this.setPauseReason('loading', true)
    this.update({ isLoading: true, loadError: '' })
    try {
      await this.loadImage(this.slides[index].src)
      if (!this.running || request !== this.request) return
      this.ready = true
      this.setPauseReason('error', false)
      if (initial) {
        this.hold()
      } else {
        const transition = this.state.reducedMotion || this.state.userPaused ? 0 : this.transitionDuration
        this.update({
          previousIndex: this.state.imageIndex,
          previousVisit: this.state.visit,
          imageIndex: index,
          visit: this.state.visit + 1,
          phase: 'out',
        })
        if (transition === 0) {
          this.update({ captionIndex: index })
          this.hold()
        } else {
          this.schedule(() => {
            this.update({ captionIndex: index, phase: 'in' })
            this.schedule(() => this.hold(), transition / 2)
          }, transition / 2)
        }
      }
    } catch {
      if (!this.running || request !== this.request) return
      this.failedIndex = index
      this.failedInitial = initial
      this.setPauseReason('error', true)
      this.update({ loadError: 'Artwork could not load. Try again or choose another scene.' })
    } finally {
      if (this.running && request === this.request) {
        this.update({ isLoading: false })
        this.setPauseReason('loading', false)
      }
    }
  }

  navigate = (direction) => {
    if (this.state.isLoading) return
    this.setPauseReason('user', true)
    this.task = null
    this.update({ captionIndex: this.state.imageIndex, previousIndex: null, previousVisit: null, phase: 'holding' })
    const index = (this.state.imageIndex + direction + this.slides.length) % this.slides.length
    this.prepare(index)
  }

  retry = () => {
    if (this.state.isLoading || !this.state.loadError) return
    this.prepare(this.failedIndex, this.failedInitial)
  }
}
