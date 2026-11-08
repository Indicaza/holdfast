import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { apiJson } from '../../Api/apiClient.js'
import { disciplineLabel, formatCount } from '../../Intelligence/Farming/farmingModel.js'
import { useLiveRefresh } from '../../Live/liveUpdatesContext.js'
import WowIcon from '../../WowAssets/WowIcon.jsx'
import { DisciplineTag, Icon, Tip } from '../ui.jsx'
import { AZEROTH_MAP_ID, AZEROTH_RECT, atlasZone, getAtlas, locateWorldPoint, mapArtUrl } from './atlas.js'
import {
  HOME_VIEW, MAX_ZOOM, MIN_ZOOM, ZONE_ZOOM, busiestSpots, clampView, fitBounds, fitScale, flightPath, formatCoords,
  layerWeights, legendGroups, mapUrl, panBy, placeLabels, placePoints, smoothstep, sourceColors, toScreen, toWorld, viewAnchored,
  worldArtOpacity, zoneArtOpacity, zoneLabelOpacity, zoneTotals, zoomAt, zoomLevel,
} from './mapModel.js'
import ResourceDetails from './ResourceDetails.jsx'
import './ResourceMap.css'

const MAP_TOPICS = ['farming']

function prefersReducedMotion() {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

function useMapData(url) {
  const [state, setState] = useState({ status: 'loading', data: null, url })
  const [version, setVersion] = useState(0)
  useLiveRefresh(MAP_TOPICS, () => setVersion((value) => value + 1), { debounceMs: 1500 })
  useEffect(() => {
    const controller = new AbortController()
    apiJson(url, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setState({ status: 'ready', data, url }) })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return
        setState((current) => ({ ...current, status: 'error' }))
      })
    return () => controller.abort()
  }, [url, version])
  const retry = useCallback(() => setVersion((value) => value + 1), [])
  return { ...state, status: state.url === url || state.status === 'error' ? state.status : 'loading', retry }
}

// Whether the site has the game's map art: one probe of the world map. Without
// it the map draws its own atlas.
function useMapArt() {
  const [available, setAvailable] = useState(null)
  useEffect(() => {
    let live = true
    const image = new Image()
    image.onload = () => { if (live) setAvailable(true) }
    image.onerror = () => { if (live) setAvailable(false) }
    image.src = mapArtUrl(AZEROTH_MAP_ID)
    return () => { live = false }
  }, [])
  return available
}

// Zones in their drawing order: big ones first, so a small zone's map sits
// on top where neighbours' feathered edges meet.
const ART_ZONES = getAtlas().zones.filter((zone) => !zone.city).sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)

// Zone maps load and decode off screen before they are drawn, so one never
// pops in half-painted or stalls a frame mid-zoom. Decoded images stay
// cached for the session; every map on the page redraws as one lands.
const artCache = new Map()
const artListeners = new Set()

function loadArt(mapId) {
  if (artCache.has(mapId)) return artCache.get(mapId).done
  const image = new Image()
  image.decoding = 'async'
  image.src = mapArtUrl(mapId)
  const entry = { status: 'loading', image }
  const settle = (status) => {
    entry.status = status
    for (const listener of artListeners) listener()
  }
  entry.done = (image.decode ? image.decode() : new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject }))
    .then(() => settle('ready'), () => settle('failed'))
  artCache.set(mapId, entry)
  return entry.done
}

function isArtReady(mapId) {
  return artCache.get(mapId)?.status === 'ready'
}

function useZoneArt(wanted) {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const listener = () => setVersion((value) => value + 1)
    artListeners.add(listener)
    return () => artListeners.delete(listener)
  }, [])
  const key = wanted.join(',')
  useEffect(() => {
    for (const mapId of key ? key.split(',').map(Number) : []) loadArt(mapId)
  }, [key])
}

// Once the map is up, the rest of the zone maps load one at a time while the
// browser is idle, so later zooms find them ready. Not on a data saver.
function usePreloadArt(enabled) {
  useEffect(() => {
    if (!enabled || globalThis.navigator?.connection?.saveData) return undefined
    let cancelled = false
    const queue = ART_ZONES.map((zone) => zone.mapId)
    const idle = (callback) => (globalThis.requestIdleCallback ? globalThis.requestIdleCallback(callback, { timeout: 2000 }) : window.setTimeout(callback, 120))
    const next = () => {
      if (cancelled || !queue.length) return
      loadArt(queue.shift()).finally(() => idle(next))
    }
    const timer = window.setTimeout(() => idle(next), 1500)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [enabled])
}

function useSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const measure = () => {
      const rect = element.getBoundingClientRect()
      setSize((current) => (current.width === rect.width && current.height === rect.height ? current : { width: rect.width, height: rect.height }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}

// A soft round glow per colour, drawn once and stamped for every point.
const glowCache = new Map()
function glowSprite(color) {
  if (glowCache.has(color)) return glowCache.get(color)
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, `${color}dd`)
  gradient.addColorStop(0.3, `${color}80`)
  gradient.addColorStop(1, `${color}00`)
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  glowCache.set(color, canvas)
  return canvas
}

function drawPoints(canvas, { size, view, placed, colors, display, highlight, maxObservations }) {
  const ratio = globalThis.devicePixelRatio || 1
  const width = Math.round(size.width * ratio)
  const height = Math.round(size.height * ratio)
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const context = canvas.getContext('2d')
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, size.width, size.height)
  if (!placed.length && !highlight) return

  const weights = layerWeights(view.k, display)
  const scale = fitScale(size) * view.k
  const logMax = Math.log1p(maxObservations || 1)
  const margin = 40
  const visible = (screen) => screen.x > -margin && screen.y > -margin && screen.x < size.width + margin && screen.y < size.height + margin

  if (weights.heat > 0.01) {
    context.globalCompositeOperation = 'lighter'
    // Glows shrink from a zone-wide wash to a tight halo as the map nears.
    const spread = 0.02 + 0.012 * smoothstep(3, 8, view.k)
    for (const point of placed) {
      const screen = toScreen(view, size, point.world)
      if (!visible(screen)) continue
      const radius = Math.min(46, Math.max(4.5, point.zone.rect.width * scale * spread))
      const weight = Math.log1p(point.observations) / logMax
      context.globalAlpha = Math.min(1, (0.18 + weight * 0.82) * weights.heat)
      context.drawImage(glowSprite(colors.get(point.sourceKey) || '#e9c46a'), screen.x - radius, screen.y - radius, radius * 2, radius * 2)
    }
    context.globalCompositeOperation = 'source-over'
    context.globalAlpha = 1
  }

  if (weights.dots > 0.01) {
    const dotScale = display === 'spots' ? 0.7 + 0.55 * smoothstep(1.5, 6, view.k) : 1
    for (const point of placed) {
      const screen = toScreen(view, size, point.world)
      if (!visible(screen)) continue
      const weight = Math.log1p(point.observations) / logMax
      const radius = (1.6 + weight * 3.4) * dotScale
      context.beginPath()
      context.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
      context.fillStyle = colors.get(point.sourceKey) || '#e9c46a'
      context.globalAlpha = (display === 'spots' ? 0.95 : 0.88) * weights.dots
      context.fill()
      context.lineWidth = 1
      context.strokeStyle = 'rgba(5, 7, 10, 0.8)'
      context.stroke()
    }
    context.globalAlpha = 1
  }

  if (highlight) {
    const screen = toScreen(view, size, highlight.world)
    context.beginPath()
    context.arc(screen.x, screen.y, 11, 0, Math.PI * 2)
    context.lineWidth = 2
    context.strokeStyle = '#fff'
    context.stroke()
    context.beginPath()
    context.arc(screen.x, screen.y, 16, 0, Math.PI * 2)
    context.lineWidth = 1
    context.strokeStyle = 'rgba(255,255,255,0.35)'
    context.stroke()
  }
}

function SourceIcon({ source, size = 18 }) {
  return (
    <WowIcon
      iconFileId={source.icon?.iconFileDataId}
      itemId={source.icon?.itemId}
      label={source.name}
      quality={source.icon?.qualityId}
      size={size}
    />
  )
}

const Legend = memo(function Legend({
  mode, onMode, groups, colors, hidden, onToggle, onSolo, onGroup, onAll, onDetails, query, onQuery,
  totalSources, shownSources, spots, spotZone, onSpot, sourcesByKey, unplaced, variant, art,
}) {
  if (mode === 'hidden') return null
  // The folded sidebar: one icon per resource, each a toggle.
  if (mode === 'rail') {
    return (
      <aside className="gw-rmap__legend gw-rmap__legend--rail" aria-label="Map legend">
        <ul>
          {groups.flatMap((group) => group.sources).map((source) => {
            const on = !hidden.has(source.sourceKey)
            return (
              <li key={source.sourceKey}>
                <Tip label={`${on ? 'Hide' : 'Show'} ${source.name} · ${formatCount(source.observations)}`} side="right">
                  <button
                    type="button"
                    className={on ? undefined : 'is-off'}
                    aria-pressed={on}
                    aria-label={`${on ? 'Hide' : 'Show'} ${source.name}`}
                    style={{ '--swatch': colors.get(source.sourceKey) }}
                    onClick={() => onToggle(source.sourceKey)}
                  >
                    <SourceIcon source={source} size={24} />
                  </button>
                </Tip>
              </li>
            )
          })}
        </ul>
      </aside>
    )
  }
  const docked = mode === 'sidebar'
  const expanded = mode === 'expanded' || docked
  return (
    <aside className={`gw-rmap__legend gw-rmap__legend--${mode}`} aria-label="Map legend">
      <header className="gw-rmap__legend-head">
        <div>
          <strong>Resources</strong>
          <span>{shownSources} of {totalSources} shown</span>
        </div>
        {docked ? null : <div className="gw-rmap__legend-tools">
          <Tip label={expanded ? 'Narrow legend' : 'Widen legend'}>
            <button
              type="button"
              className="gw-rmap__icon-btn"
              onClick={() => onMode(expanded ? 'compact' : 'expanded')}
              aria-label={expanded ? 'Narrow the legend' : 'Widen the legend'}
            >
              <Icon name={expanded ? 'shrink' : 'expand'} size={15} />
            </button>
          </Tip>
          <Tip label="Hide legend">
            <button type="button" className="gw-rmap__icon-btn" onClick={() => onMode('hidden')} aria-label="Hide the legend">
              <Icon name="close" size={15} />
            </button>
          </Tip>
        </div>}
      </header>

      {expanded && totalSources > 6 ? (
        <label className="gw-rmap__legend-search">
          <Icon name="search" size={14} />
          <input type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Filter resources" aria-label="Filter resources" />
        </label>
      ) : null}

      <div className="gw-rmap__legend-actions">
        <button type="button" onClick={() => onAll(true)} disabled={shownSources === totalSources}>Show all</button>
        <button type="button" onClick={() => onAll(false)} disabled={shownSources === 0}>Hide all</button>
      </div>

      <div className="gw-rmap__legend-body">
        {groups.map((group) => {
          const visibleCount = group.sources.filter((source) => !hidden.has(source.sourceKey)).length
          const all = visibleCount === group.sources.length
          return (
            <section key={group.discipline} className="gw-rmap__group">
              <label className="gw-rmap__group-head">
                <input
                  type="checkbox"
                  checked={all}
                  ref={(element) => { if (element) element.indeterminate = visibleCount > 0 && !all }}
                  onChange={() => onGroup(group, !all)}
                />
                <DisciplineTag discipline={group.discipline} compact />
                <span className="gw-rmap__group-name">{disciplineLabel(group.discipline)}</span>
                {expanded ? <small>{formatCount(group.observations)}</small> : null}
              </label>
              <ul>
                {group.sources.map((source) => {
                  const on = !hidden.has(source.sourceKey)
                  return (
                    <li key={source.sourceKey} className={on ? undefined : 'is-off'}>
                      <input type="checkbox" checked={on} onChange={() => onToggle(source.sourceKey)} aria-label={`Show ${source.name} on the map`} />
                      <button type="button" className="gw-rmap__source" onClick={() => onDetails(source.sourceKey)} aria-label={`${source.name} details`}>
                        <i className="gw-rmap__swatch" style={{ '--swatch': colors.get(source.sourceKey) }} aria-hidden="true" />
                        <SourceIcon source={source} size={expanded ? 20 : 16} />
                        <span className="gw-rmap__source-name">{source.name}</span>
                        {expanded ? <small>{formatCount(source.observations)}</small> : null}
                      </button>
                      <span className="gw-rmap__row-tools">
                        <button type="button" className="gw-rmap__solo" onClick={() => onSolo(source.sourceKey)} aria-label={`Show only ${source.name}`}>Only</button>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
        {!groups.length ? <p className="gw-rmap__legend-empty">No resources match.</p> : null}
      </div>

      {expanded && spotZone ? (
        <section className="gw-rmap__spots" aria-label={`Busiest spots in ${spotZone.name}`}>
          <h3>Busiest in {spotZone.name}</h3>
          {spots.length ? (
            <ol>
              {spots.map((spot, index) => {
                const source = sourcesByKey.get(spot.sourceKey)
                return (
                  <li key={`${spot.sourceKey}-${index}`}>
                    <button type="button" onClick={() => onSpot(spot)}>
                      <span className="gw-rmap__spot-rank">{index + 1}</span>
                      <i className="gw-rmap__swatch" style={{ '--swatch': colors.get(spot.sourceKey) }} aria-hidden="true" />
                      <span className="gw-rmap__spot-name">{source?.name || 'Unknown'}</span>
                      <code>{formatCoords(spot.x, spot.y)}</code>
                      <small>{formatCount(spot.observations)}</small>
                    </button>
                  </li>
                )
              })}
            </ol>
          ) : <p className="gw-rmap__legend-empty">Nothing shown here.</p>}
        </section>
      ) : null}

      {expanded && unplaced ? (
        <p className="gw-rmap__legend-note">{formatCount(unplaced)} gathers are in zones the atlas does not draw yet.</p>
      ) : null}
      {variant === 'card' || art ? null : (
        <p className="gw-rmap__legend-note">A drawn atlas in the game&rsquo;s own zone layout. Coordinates match the in-game map.</p>
      )}
    </aside>
  )
})

// The community resource map: every gather position, on a zoomable map of
// Azeroth. "full" fills its container with a docked legend; "card" embeds in
// a panel with a floating legend and an "Open full map" link. Clicking a
// spot, or a resource's details in the legend, opens its details over the
// map.
export default function ResourceMap({
  variant = 'full',
  filter = {},
  focus = null,
  defaultLegend,
  fullHref = '',
  label = 'Resource map',
  onFocusZone,
  legendHost = null,
  legendRail = false,
  openRequest = null,
  onDetailsChange,
}) {
  const discipline = filter.discipline || ''
  const item = filter.item || ''
  const sourceList = filter.sources || []
  const sourceKey = sourceList.join(',')
  const url = useMemo(() => mapUrl({ discipline, item, sources: sourceKey ? sourceKey.split(',') : [] }), [discipline, item, sourceKey])
  const { status, data, retry } = useMapData(url)

  const rootRef = useRef(null)
  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const size = useSize(stageRef)
  const [view, setView] = useState(HOME_VIEW)
  const viewRef = useRef(view)
  const sizeRef = useRef(size)
  useLayoutEffect(() => {
    sizeRef.current = size
  })
  const setViewNow = useCallback((next) => {
    viewRef.current = next
    setView(next)
  }, [])

  // On a phone the legend would cover the map, so it starts tucked away.
  const [legend, setLegend] = useState(() => {
    if (globalThis.matchMedia?.('(max-width: 860px)').matches) return 'hidden'
    return defaultLegend || (variant === 'card' ? 'compact' : 'expanded')
  })
  const [hidden, setHidden] = useState(() => new Set())
  const [query, setQuery] = useState('')
  const [display, setDisplay] = useState('heat')
  const [hover, setHover] = useState(null)
  const [pinned, setPinned] = useState(null)
  const [details, setDetails] = useState(null)
  const [cursor, setCursor] = useState(null)
  const [hint, setHint] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const art = useMapArt() === true

  const sources = useMemo(() => data?.sources || [], [data])
  const sourcesByKey = useMemo(() => new Map(sources.map((source) => [source.sourceKey, source])), [sources])
  const colors = useMemo(() => sourceColors(sources), [sources])
  const visible = useMemo(() => new Set(sources.filter((source) => !hidden.has(source.sourceKey)).map((source) => source.sourceKey)), [sources, hidden])
  const { placed, unplaced } = useMemo(() => placePoints(data?.points || [], data?.zones || [], visible), [data, visible])
  const everywhere = useMemo(() => placePoints(data?.points || [], data?.zones || []).placed, [data])
  const maxObservations = useMemo(() => placed.reduce((max, point) => Math.max(max, point.observations), 1), [placed])
  const totals = useMemo(() => zoneTotals(placed), [placed])
  const maxZone = totals[0]?.observations || 1
  const groups = useMemo(() => legendGroups(sources, query), [sources, query])
  const atlas = getAtlas()

  const level = zoomLevel(view.k)
  const ready = size.width > 0 && size.height > 0
  const centre = useMemo(() => (level === 'world' ? null : locateWorldPoint({ x: view.x, y: view.y })), [level, view.x, view.y])
  const centreContinent = level === 'world' ? null : atlas.continents.find((continent) => continent.mapId === (centre?.zone?.continentId || (view.x < 520 ? 1414 : 1415)))
  const focusZone = level === 'zone' ? centre?.zone || null : null
  const spots = useMemo(() => (focusZone ? busiestSpots(placed, focusZone.mapId, { limit: 5 }) : []), [placed, focusZone])

  // ------------------------------------------------------------ Camera
  // One motion at a time: a flight, a smoothed zoom or a glide after a drag.
  // Any new input cancels whatever is moving.
  const motionRef = useRef(0)
  const zoomTargetRef = useRef(null)
  const stopMotion = useCallback(() => {
    motionRef.current += 1
    zoomTargetRef.current = null
  }, [])

  const flyTo = useCallback((target, { duration } = {}) => {
    stopMotion()
    const token = motionRef.current
    const goal = clampView(target)
    if (prefersReducedMotion()) {
      setViewNow(goal)
      return
    }
    const path = flightPath(viewRef.current, goal, sizeRef.current)
    const total = duration ?? path.duration
    const start = performance.now()
    const step = (now) => {
      if (motionRef.current !== token) return
      const t = Math.min(1, (now - start) / total)
      setViewNow(clampView(path.at(t)))
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [setViewNow, stopMotion])

  // Zooms glide toward their target, keeping the point under the cursor
  // still. Further wheel ticks retarget the glide instead of restarting it.
  const zoomBy = useCallback((factor, anchor) => {
    const current = viewRef.current
    const at = anchor || { x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 }
    const running = zoomTargetRef.current
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (running ? running.k : current.k) * factor))
    const target = { k, anchor: at, world: toWorld(current, sizeRef.current, at) }
    if (prefersReducedMotion()) {
      setViewNow(viewAnchored(target.world, at, k, sizeRef.current))
      return
    }
    if (running) {
      zoomTargetRef.current = target
      return
    }
    motionRef.current += 1
    const token = motionRef.current
    zoomTargetRef.current = target
    let last = performance.now()
    const step = (now) => {
      const goal = zoomTargetRef.current
      if (motionRef.current !== token || !goal) return
      const dt = Math.min(64, now - last)
      last = now
      const from = viewRef.current.k
      const blend = 1 - Math.exp(-dt / 75)
      const nextK = Math.exp(Math.log(from) + (Math.log(goal.k) - Math.log(from)) * blend)
      const done = Math.abs(Math.log(goal.k / nextK)) < 0.002
      setViewNow(viewAnchored(goal.world, goal.anchor, done ? goal.k : nextK, sizeRef.current))
      if (done) {
        zoomTargetRef.current = null
        return
      }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [setViewNow])

  const glide = useCallback((velocity) => {
    if (prefersReducedMotion()) return
    motionRef.current += 1
    const token = motionRef.current
    let v = { ...velocity }
    let last = performance.now()
    const step = (now) => {
      if (motionRef.current !== token) return
      const dt = Math.min(48, now - last)
      last = now
      const decay = Math.exp(-dt / 240)
      v = { x: v.x * decay, y: v.y * decay }
      if (Math.hypot(v.x, v.y) < 0.02) return
      setViewNow(panBy(viewRef.current, sizeRef.current, v.x * dt, v.y * dt))
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [setViewNow])

  const flyToZone = useCallback((zone) => {
    if (!zone) return
    flyTo(fitBounds(zone.rect, sizeRef.current, 0.9))
  }, [flyTo])

  // Where the camera goes: a named zone, the busiest zone, or the extent of
  // the data. It flies again whenever the focus asked for changes.
  const focusKey = focus && typeof focus === 'object' ? `zone:${focus.mapId || ''}` : String(focus || '')
  const focusMapId = focus && typeof focus === 'object' ? focus.mapId : null
  const appliedFocus = useRef(null)
  useEffect(() => {
    if (!ready || status !== 'ready' || appliedFocus.current === focusKey) return
    const first = appliedFocus.current === null
    appliedFocus.current = focusKey
    let target = null
    if (focusMapId) {
      const zone = atlasZone(focusMapId)
      if (zone) target = fitBounds(zone.rect, size, 0.9)
    } else if (focus === 'busiest' && totals[0]) {
      target = fitBounds(totals[0].zone.rect, size, 0.9)
    } else if (focus === 'data' && placed.length) {
      const xs = placed.map((point) => point.world.x)
      const ys = placed.map((point) => point.world.y)
      const bounds = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
      const padded = { x: bounds.x - 30, y: bounds.y - 20, width: Math.max(90, bounds.width + 60), height: Math.max(60, bounds.height + 40) }
      target = fitBounds(padded, size, 0.92)
    } else if (!first) {
      target = HOME_VIEW
    }
    if (!target) return
    if (first) setViewNow(target)
    else flyTo(target)
  }, [ready, status, focus, focusKey, focusMapId, totals, placed, size, flyTo, setViewNow])

  useEffect(() => {
    if (!onFocusZone) return undefined
    const timer = window.setTimeout(() => onFocusZone(focusZone?.mapId || null), 300)
    return () => window.clearTimeout(timer)
  }, [focusZone, onFocusZone])

  // ------------------------------------------------------------ Details
  const openDetails = useCallback((key, spot = null) => {
    setDetails({ sourceKey: key, spot })
  }, [])
  const closeDetails = useCallback(() => setDetails(null), [])

  // A resource asked for from outside (search, a shared link) opens once the
  // map knows its resources; one it has no positions for still opens.
  const handledRequest = useRef(null)
  useEffect(() => {
    if (!openRequest?.sourceKey || status !== 'ready' || handledRequest.current === openRequest) return
    handledRequest.current = openRequest
    setDetails({ sourceKey: openRequest.sourceKey, spot: null, fallback: openRequest })
  }, [openRequest, status])

  const detailsKey = details?.sourceKey || null
  useEffect(() => { onDetailsChange?.(detailsKey) }, [detailsKey, onDetailsChange])

  // ------------------------------------------------------------ Drawing
  const highlight = details?.spot || pinned || hover
  useEffect(() => {
    if (!canvasRef.current || !ready) return
    drawPoints(canvasRef.current, { size, view, placed, colors, display, highlight, maxObservations })
  }, [size, view, placed, colors, display, highlight, maxObservations, ready])

  // ------------------------------------------------------------ Input
  const pointers = useRef(new Map())
  const gesture = useRef(null)

  function stagePoint(event) {
    const rect = stageRef.current.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function nearestPoint(screen) {
    if (layerWeights(viewRef.current.k, display).dots < 0.2 && zoomLevel(viewRef.current.k) === 'world') return null
    let best = null
    let bestDistance = 14
    for (const point of placed) {
      const at = toScreen(viewRef.current, sizeRef.current, point.world)
      const distance = Math.hypot(at.x - screen.x, at.y - screen.y)
      if (distance < bestDistance || (best && distance === bestDistance && point.observations > best.observations)) {
        best = point
        bestDistance = distance
      }
    }
    return best
  }

  function onPointerDown(event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    stopMotion()
    stageRef.current.setPointerCapture?.(event.pointerId)
    const at = stagePoint(event)
    pointers.current.set(event.pointerId, at)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = { kind: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y), moved: true }
    } else {
      gesture.current = { kind: 'pan', last: at, start: at, moved: false, trail: [{ ...at, t: performance.now() }] }
    }
  }

  function onPointerMove(event) {
    const at = stagePoint(event)
    const g = gesture.current
    if (g && pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, at)
      if (g.kind === 'pinch' && pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()]
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        if (g.distance > 0) setViewNow(zoomAt(viewRef.current, sizeRef.current, distance / g.distance, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }))
        g.distance = distance
        return
      }
      if (g.kind === 'pan') {
        if (!g.moved && Math.hypot(at.x - g.start.x, at.y - g.start.y) > 4) {
          g.moved = true
          setDragging(true)
        }
        if (g.moved) {
          const dx = at.x - g.last.x
          const dy = at.y - g.last.y
          g.last = at
          g.trail.push({ ...at, t: performance.now() })
          if (g.trail.length > 6) g.trail.shift()
          setHover(null)
          setViewNow(panBy(viewRef.current, sizeRef.current, dx, dy))
          return
        }
      }
    }
    const world = toWorld(viewRef.current, sizeRef.current, at)
    setCursor(locateWorldPoint(world))
    const point = nearestPoint(at)
    setHover((current) => (point ? (current?.sourceKey === point.sourceKey && current?.world === point.world ? current : point) : null))
  }

  function onPointerUp(event) {
    const g = gesture.current
    pointers.current.delete(event.pointerId)
    if (pointers.current.size === 1 && g?.kind === 'pinch') {
      const rest = [...pointers.current.values()][0]
      gesture.current = { kind: 'pan', last: rest, start: rest, moved: true, trail: [{ ...rest, t: performance.now() }] }
      return
    }
    gesture.current = null
    setDragging(false)
    if (!g || g.kind !== 'pan') return
    if (g.moved) {
      // A flick keeps the map gliding.
      const now = performance.now()
      const recent = g.trail.filter((sample) => now - sample.t < 90)
      if (recent.length >= 2) {
        const first = recent[0]
        const last = recent.at(-1)
        const dt = Math.max(1, last.t - first.t)
        const velocity = { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt }
        if (Math.hypot(velocity.x, velocity.y) > 0.25) glide(velocity)
      }
      return
    }
    const at = stagePoint(event)
    const point = nearestPoint(at)
    if (point) {
      setPinned(point)
      openDetails(point.sourceKey, point)
      return
    }
    if (pinned) {
      setPinned(null)
      return
    }
    const located = locateWorldPoint(toWorld(viewRef.current, sizeRef.current, at))
    if (located && zoomLevel(viewRef.current.k) !== 'zone') flyToZone(located.zone)
  }

  function onPointerLeave() {
    if (gesture.current) return
    setHover(null)
    setCursor(null)
  }

  // Wheel zoom. In a card, a plain scroll scrolls the page; zooming takes
  // ⌘/Ctrl so the map never traps the reader mid-page.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    let hintTimer = 0
    function onWheel(event) {
      if (variant === 'card' && !event.ctrlKey && !event.metaKey && !document.fullscreenElement) {
        setHint(true)
        window.clearTimeout(hintTimer)
        hintTimer = window.setTimeout(() => setHint(false), 1400)
        return
      }
      event.preventDefault()
      const rect = stage.getBoundingClientRect()
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      zoomBy(Math.exp(-Math.max(-160, Math.min(160, delta)) * 0.0024), anchor)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      stage.removeEventListener('wheel', onWheel)
      window.clearTimeout(hintTimer)
    }
  }, [variant, zoomBy])

  function onDoubleClick(event) {
    zoomBy(2.2, stagePoint(event))
  }

  function onKeyDown(event) {
    const step = 90
    const pan = (dx, dy) => {
      stopMotion()
      setViewNow(panBy(viewRef.current, sizeRef.current, dx, dy))
    }
    const actions = {
      '+': () => zoomBy(1.8),
      '=': () => zoomBy(1.8),
      '-': () => zoomBy(1 / 1.8),
      _: () => zoomBy(1 / 1.8),
      ArrowLeft: () => pan(step, 0),
      ArrowRight: () => pan(-step, 0),
      ArrowUp: () => pan(0, step),
      ArrowDown: () => pan(0, -step),
      0: () => flyTo(HOME_VIEW),
      Home: () => flyTo(HOME_VIEW),
      Escape: () => setPinned(null),
      Enter: () => { if (pinned) openDetails(pinned.sourceKey, pinned) },
    }
    const action = actions[event.key]
    if (!action) return
    event.preventDefault()
    action()
  }

  // ------------------------------------------------------------ Fullscreen
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else rootRef.current?.requestFullscreen?.()
  }

  // ------------------------------------------------------------ Legend
  const toggleSource = useCallback((key) => {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const soloSource = useCallback((key) => {
    setHidden(new Set(sources.map((source) => source.sourceKey).filter((entry) => entry !== key)))
  }, [sources])
  const setGroup = useCallback((group, on) => {
    setHidden((current) => {
      const next = new Set(current)
      for (const source of group.sources) {
        if (on) next.delete(source.sourceKey)
        else next.add(source.sourceKey)
      }
      return next
    })
  }, [])
  const setAll = useCallback((on) => {
    setHidden(on ? new Set() : new Set(sources.map((source) => source.sourceKey)))
  }, [sources])
  const goToSpot = useCallback((spot) => {
    flyTo({ x: spot.world.x, y: spot.world.y, k: Math.max(viewRef.current.k, Math.min(MAX_ZOOM, ZONE_ZOOM * 2.4)) })
    const point = everywhere.find((entry) => entry.sourceKey === spot.sourceKey && entry.zone.mapId === (spot.mapId ?? spot.zone?.mapId) && Math.hypot(entry.x - spot.x, entry.y - spot.y) < 0.02)
    setPinned(point ? { ...point, x: spot.x, y: spot.y, observations: spot.observations, world: spot.world } : { ...spot, zone: spot.zone || atlasZone(spot.mapId) })
  }, [everywhere, flyTo])

  // ------------------------------------------------------------ Layers
  const scale = fitScale(size) * view.k
  const transform = `translate(${size.width / 2 - view.x * scale} ${size.height / 2 - view.y * scale}) scale(${scale})`
  const onScreen = (point, margin = 60) => point.x > -margin && point.y > -margin && point.x < size.width + margin && point.y < size.height + margin
  const weights = layerWeights(view.k, display)

  // The world's corners in world units, to find the zones in view.
  const topLeft = toWorld(view, size, { x: 0, y: 0 })
  const bottomRight = toWorld(view, size, { x: size.width, y: size.height })
  const inView = (rect, pad = 0) => rect.x + rect.width > topLeft.x - pad && rect.x < bottomRight.x + pad && rect.y + rect.height > topLeft.y - pad && rect.y < bottomRight.y + pad
  const zoneOpacity = zoneArtOpacity(view.k)
  // Zones in view load a little before they start to show.
  const zoneArt = art && ready && view.k > 1.08
    ? ART_ZONES.filter((zone) => inView(zone.rect, zone.rect.width * 0.25))
    : []
  useZoneArt(zoneArt.map((zone) => zone.mapId))
  usePreloadArt(art && status === 'ready')
  // The world map stays until the zones in view have their maps, so a fast
  // zoom never opens onto empty sea.
  const onScreenZones = zoneArt.filter((zone) => inView(zone.rect))
  const zonesReady = onScreenZones.length ? onScreenZones.filter((zone) => isArtReady(zone.mapId)).length / onScreenZones.length : 1
  const worldOpacity = Math.max(worldArtOpacity(view.k), 1 - zonesReady)
  // The painted maps darken a touch as the map nears, so heat and spots read
  // clearly on top of them.
  const dim = 0.1 + 0.12 * smoothstep(2, 8, view.k)

  const zoneLabels = placeLabels(
    atlas.zones
      .map((zone) => ({ zone, at: toScreen(view, size, zone.label), opacity: zoneLabelOpacity(zone, scale, view.k) }))
      .filter((entry) => entry.opacity > 0.02 && onScreen(entry.at, 20)),
    level === 'zone' ? 15 : level === 'region' ? 13.5 : 12.5,
  )

  const bubbles = weights.bubbles > 0.02
    ? totals.map((entry) => ({ ...entry, at: toScreen(view, size, entry.zone.label) })).filter((entry) => onScreen(entry.at))
    : []

  const spotMarkers = weights.markers > 0.02 ? spots.map((spot, index) => ({ spot, index, at: toScreen(view, size, spot.world) })).filter((entry) => onScreen(entry.at)) : []
  const hoverAt = hover && !dragging ? toScreen(view, size, hover.world) : null
  const shownSources = visible.size
  const fullscreenLabel = fullscreen ? 'Exit full screen' : 'Full screen'

  const crumbs = [{ id: 'world', label: 'Azeroth' }]
  if (centreContinent) crumbs.push({ id: 'continent', label: centreContinent.name })
  if (centre?.zone && level !== 'world') crumbs.push({ id: 'zone', label: centre.zone.name })
  function goToCrumb(id) {
    if (id === 'world') flyTo(HOME_VIEW)
    else if (id === 'continent' && centreContinent) flyTo(fitBounds(centreContinent.bounds, size, 0.94))
    else if (id === 'zone' && centre?.zone) flyToZone(centre.zone)
  }

  const detailsSource = details
    ? sourcesByKey.get(details.sourceKey) || {
      sourceKey: details.sourceKey,
      name: details.fallback?.name || 'Resource',
      discipline: details.fallback?.discipline || '',
      icon: details.fallback?.icon || null,
      observations: 0,
      zones: 0,
    }
    : null

  // On the full map page the legend lives in the dashboard's sidebar: open,
  // it is the whole legend; folded to a rail, one icon per resource.
  const legendMode = legendHost ? (legendRail ? 'rail' : 'sidebar') : legend
  const legendNode = (
    <Legend
      mode={legendMode}
      onMode={setLegend}
      groups={groups}
      colors={colors}
      hidden={hidden}
      onToggle={toggleSource}
      onSolo={soloSource}
      onGroup={setGroup}
      onAll={setAll}
      onDetails={openDetails}
      query={query}
      onQuery={setQuery}
      totalSources={sources.length}
      shownSources={shownSources}
      spots={spots}
      spotZone={focusZone}
      onSpot={goToSpot}
      sourcesByKey={sourcesByKey}
      unplaced={unplaced}
      variant={variant}
      art={art}
    />
  )

  return (
    <div
      ref={rootRef}
      className={`gw-rmap gw-rmap--${variant} gw-rmap--legend-${legendHost ? 'external' : legend}${fullscreen ? ' is-fullscreen' : ''}${art ? ' has-art' : ''}`}
      data-level={level}
    >
      {legendHost ? createPortal(legendNode, legendHost) : legendNode}

      <div className="gw-rmap__viewport">
        <div
          ref={stageRef}
          className={`gw-rmap__stage${dragging ? ' is-dragging' : ''}${hover ? ' is-pointing' : ''}`}
          role="application"
          aria-roledescription="map"
          aria-label={`${label}. ${shownSources} resource${shownSources === 1 ? '' : 's'} shown${centre?.zone ? `, centred on ${centre.zone.name}` : ''}. Use plus and minus to zoom, arrow keys to pan, 0 to show the whole world. Click a spot for its details.`}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          onDoubleClick={onDoubleClick}
          onKeyDown={onKeyDown}
        >
          {ready ? (
            <svg className="gw-rmap__svg" width={size.width} height={size.height} aria-hidden="true">
              <defs>
                <radialGradient id="gw-rmap-ocean" cx="50%" cy="45%" r="75%">
                  <stop offset="0%" stopColor="#141a22" />
                  <stop offset="100%" stopColor="#07090d" />
                </radialGradient>
                <linearGradient id="gw-rmap-land" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1b222b" />
                  <stop offset="100%" stopColor="#141920" />
                </linearGradient>
              </defs>
              {art ? null : <rect width={size.width} height={size.height} fill="url(#gw-rmap-ocean)" />}
              <g transform={transform}>
                {art ? (
                  // The world map is always there; each zone's own map,
                  // fully explored and cut to its land, fades in over it as
                  // the zone grows on screen. Zooming is one continuous
                  // picture, never a swap.
                  <g className="gw-rmap__art">
                    {worldOpacity > 0.005 ? (
                      <image className="gw-rmap__world-art" href={mapArtUrl(AZEROTH_MAP_ID)} x={AZEROTH_RECT.x} y={AZEROTH_RECT.y} width={AZEROTH_RECT.width} height={AZEROTH_RECT.height} preserveAspectRatio="none" style={{ opacity: worldOpacity }} />
                    ) : null}
                    {zoneArt.map((zone) => (
                      <image
                        key={zone.mapId}
                        className="gw-rmap__zone-art"
                        href={mapArtUrl(zone.mapId)}
                        x={zone.rect.x}
                        y={zone.rect.y}
                        width={zone.rect.width}
                        height={zone.rect.height}
                        preserveAspectRatio="none"
                        style={{ opacity: isArtReady(zone.mapId) ? zoneOpacity : 0 }}
                      />
                    ))}
                  </g>
                ) : atlas.continents.map((continent) => (
                  <g key={continent.mapId} className="gw-rmap__continent">
                    <path d={continent.path} className="gw-rmap__shore" />
                    <path d={continent.path} className="gw-rmap__land" />
                  </g>
                ))}
              </g>
              {art ? <rect width={size.width} height={size.height} fill="#05070a" opacity={dim} /> : null}
              {level === 'world' && !art ? atlas.continents.map((continent) => {
                const at = toScreen(view, size, continent.label)
                return (
                  <text key={continent.mapId} x={at.x} y={at.y} className="gw-rmap__continent-label" textAnchor={continent.label.anchor}>
                    {continent.name}
                  </text>
                )
              }) : null}
              {zoneLabels.map(({ zone, at, opacity }) => (
                <text
                  key={zone.mapId}
                  x={at.x}
                  y={at.y}
                  textAnchor="middle"
                  style={{ opacity }}
                  className={`gw-rmap__zone-label${zone.city ? ' gw-rmap__zone-label--city' : ''}${cursor?.zone?.mapId === zone.mapId ? ' is-hover' : ''}`}
                >
                  {zone.name}
                </text>
              ))}
            </svg>
          ) : null}
          <canvas ref={canvasRef} className="gw-rmap__canvas" style={{ width: size.width, height: size.height }} aria-hidden="true" />

          {bubbles.length ? (
            <div className="gw-rmap__overlay" style={{ opacity: weights.bubbles }} aria-hidden="true">
              {bubbles.map((entry) => {
                const radius = 10 + Math.sqrt(entry.observations / maxZone) * 16
                return (
                  <span
                    key={entry.zone.mapId}
                    className="gw-rmap__bubble"
                    style={{
                      left: entry.at.x,
                      top: entry.at.y,
                      width: radius * 2,
                      height: radius * 2,
                      '--bubble': colors.get(entry.topSource) || 'var(--gw-accent)',
                    }}
                  >
                    {entry.observations >= 1000 ? `${(entry.observations / 1000).toFixed(entry.observations >= 10000 ? 0 : 1)}k` : entry.observations}
                  </span>
                )
              })}
            </div>
          ) : null}

          {spotMarkers.length ? (
            <div className="gw-rmap__overlay" style={{ opacity: weights.markers }} aria-hidden="true">
              {spotMarkers.map(({ spot, index, at }) => (
                <span key={`${spot.sourceKey}-${index}`} className="gw-rmap__marker" style={{ left: at.x, top: at.y, '--marker': colors.get(spot.sourceKey) }}>
                  {index + 1}
                </span>
              ))}
            </div>
          ) : null}

          {hoverAt && hover && !details ? (
            <div className="gw-rmap__tip" style={{ left: hoverAt.x, top: hoverAt.y, '--swatch': colors.get(hover.sourceKey) }} role="presentation">
              <span className="gw-rmap__tip-icon">{sourcesByKey.get(hover.sourceKey) ? <SourceIcon source={sourcesByKey.get(hover.sourceKey)} size={30} /> : null}</span>
              <span className="gw-rmap__tip-copy">
                <strong>{sourcesByKey.get(hover.sourceKey)?.name}</strong>
                <span>{hover.zone.name} · <code>{formatCoords(hover.x, hover.y)}</code></span>
                <small>{formatCount(hover.observations)} gather{hover.observations === 1 ? '' : 's'} here · click for details</small>
              </span>
            </div>
          ) : null}

          {hint ? <div className="gw-rmap__hint" role="status">Hold ⌘ or Ctrl and scroll to zoom</div> : null}

          {status === 'loading' && !data ? <div className="gw-rmap__state" role="status"><span className="gw-rmap__spinner" />Charting gather spots…</div> : null}
          {status === 'error' ? (
            <div className="gw-rmap__state" role="alert">
              The map could not load.
              <button type="button" className="gw-btn gw-btn--sm" onClick={retry}>Try again</button>
            </div>
          ) : null}
          {status === 'ready' && !sources.length ? (
            <div className="gw-rmap__state" role="status">No gather positions recorded{filter.item || filter.discipline || sourceKey ? ' for this filter' : ''} yet.</div>
          ) : null}
        </div>

        {/* Chrome over the stage: legend toggle, breadcrumb, controls, readout. */}
        <div className="gw-rmap__topleft">
          {!legendHost && legend === 'hidden' ? (
            <button type="button" className="gw-rmap__legend-toggle" onClick={() => setLegend(variant === 'card' ? 'compact' : 'expanded')}>
              <Icon name="layers" size={15} />
              Legend
              <small>{shownSources}/{sources.length}</small>
            </button>
          ) : null}
          <nav className="gw-rmap__crumbs" aria-label="Map location">
            {crumbs.map((crumb, index) => (
              <span key={crumb.id}>
                {index ? <Icon name="chevron" size={12} /> : null}
                <button type="button" onClick={() => goToCrumb(crumb.id)} aria-current={index === crumbs.length - 1 ? 'location' : undefined}>{crumb.label}</button>
              </span>
            ))}
          </nav>
        </div>

        <div className="gw-rmap__controls">
          <div className="gw-rmap__control-group">
            <Tip label="Zoom in" shortcut="+" side="left">
              <button type="button" onClick={() => zoomBy(1.8)} aria-label="Zoom in" disabled={view.k >= MAX_ZOOM - 1e-6}><Icon name="plus" size={16} /></button>
            </Tip>
            <Tip label="Zoom out" shortcut="−" side="left">
              <button type="button" onClick={() => zoomBy(1 / 1.8)} aria-label="Zoom out" disabled={view.k <= MIN_ZOOM + 1e-6}><Icon name="minus" size={16} /></button>
            </Tip>
          </div>
          <div className="gw-rmap__control-group">
            <Tip label="Whole world" shortcut="0" side="left">
              <button type="button" onClick={() => flyTo(HOME_VIEW)} aria-label="Show the whole world"><Icon name="globe" size={16} /></button>
            </Tip>
            <Tip label={fullscreenLabel} side="left">
              <button type="button" onClick={toggleFullscreen} aria-label={fullscreenLabel}><Icon name={fullscreen ? 'exitFullscreen' : 'fullscreen'} size={16} /></button>
            </Tip>
          </div>
          {fullHref && !fullscreen ? (
            <Tip label="Open the full map" side="left">
              <a className="gw-rmap__control-link" href={fullHref} aria-label="Open the full resource map"><Icon name="external" size={15} /></a>
            </Tip>
          ) : null}
        </div>

        <div className="gw-rmap__display" role="group" aria-label="Display">
          <button type="button" aria-pressed={display === 'heat'} onClick={() => setDisplay('heat')}>Heat</button>
          <button type="button" aria-pressed={display === 'spots'} onClick={() => setDisplay('spots')}>Spots</button>
        </div>

        <div className="gw-rmap__readout" aria-live="off">
          {cursor ? (
            <>
              <Icon name="pin" size={13} />
              <strong>{cursor.zone.name}</strong>
              <code>{formatCoords(cursor.x, cursor.y)}</code>
            </>
          ) : (
            <span>{level === 'zone' ? 'Click a spot for its details' : 'Scroll to zoom · click a zone to fly there'}</span>
          )}
          <span className="gw-rmap__scale" aria-hidden="true"><i style={{ width: `${Math.round((Math.log(view.k / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM)) * 100)}%` }} /></span>
        </div>

        {detailsSource ? (
          <ResourceDetails
            key={`${detailsSource.sourceKey}:${details.spot ? `${details.spot.zone.mapId}:${details.spot.x}:${details.spot.y}` : 'all'}`}
            source={detailsSource}
            spot={details.spot}
            initialItemKey={details.fallback?.itemKey || ''}
            placed={everywhere}
            color={colors.get(detailsSource.sourceKey)}
            shown={!hidden.has(detailsSource.sourceKey)}
            onClose={closeDetails}
            onFlyToZone={(zone) => {
              closeDetails()
              setPinned(null)
              flyToZone(zone)
            }}
            onFlyToSpot={(spot) => {
              closeDetails()
              if (hidden.has(spot.sourceKey)) toggleSource(spot.sourceKey)
              goToSpot(spot)
            }}
            onSolo={() => {
              soloSource(detailsSource.sourceKey)
              closeDetails()
              const zones = everywhere.filter((point) => point.sourceKey === detailsSource.sourceKey)
              if (zones.length) {
                const xs = zones.map((point) => point.world.x)
                const ys = zones.map((point) => point.world.y)
                const bounds = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
                flyTo(fitBounds({ x: bounds.x - 30, y: bounds.y - 20, width: Math.max(90, bounds.width + 60), height: Math.max(60, bounds.height + 40) }, sizeRef.current, 0.92))
              }
            }}
            onToggle={() => toggleSource(detailsSource.sourceKey)}
          />
        ) : null}
      </div>
    </div>
  )
}
