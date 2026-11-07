import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { apiJson } from '../../Api/apiClient.js'
import { disciplineLabel, formatCount } from '../../Intelligence/Farming/farmingModel.js'
import { useLiveRefresh } from '../../Live/liveUpdatesContext.js'
import WowIcon from '../../WowAssets/WowIcon.jsx'
import { sourceHref } from '../exploreModel.js'
import { DisciplineTag, Icon } from '../ui.jsx'
import { AZEROTH_MAP_ID, AZEROTH_RECT, WORLD, atlasZone, getAtlas, locateWorldPoint, mapArtUrl } from './atlas.js'
import {
  HOME_VIEW, ZONE_ZOOM, busiestSpots, fitBounds, fitScale, formatCoords, interpolateView,
  legendGroups, mapUrl, panBy, placePoints, sourceColors, toScreen, toWorld, zoneTotals, zoomAt, zoomLevel,
} from './mapModel.js'
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

const clamp01 = (value) => Math.min(1, Math.max(0, value))

function ArtImage({ mapId, rect, opacity, failed, onFail, feather = false }) {
  if (opacity <= 0.01 || failed.has(mapId)) return null
  const image = (
    <image
      href={mapArtUrl(mapId)}
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      preserveAspectRatio="none"
      opacity={opacity}
      onError={() => onFail(mapId)}
      mask={feather ? 'url(#gw-rmap-fade-y)' : undefined}
    />
  )
  // A zone's map shows its neighbours too; feathered, it melts into the
  // continent map beneath instead of ending in a hard edge.
  return feather ? <g mask="url(#gw-rmap-fade-x)">{image}</g> : image
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
  if (!placed.length) return

  const level = zoomLevel(view.k)
  const scale = fitScale(size) * view.k
  const logMax = Math.log1p(maxObservations || 1)
  const margin = 40

  if (display === 'heat') {
    context.globalCompositeOperation = 'lighter'
    const levelAlpha = level === 'world' ? 0.5 : level === 'region' ? 0.65 : 0.38
    for (const point of placed) {
      const screen = toScreen(view, size, point.world)
      if (screen.x < -margin || screen.y < -margin || screen.x > size.width + margin || screen.y > size.height + margin) continue
      const radius = Math.min(46, Math.max(4.5, point.zone.rect.width * scale * (level === 'zone' ? 0.03 : 0.02)))
      const weight = Math.log1p(point.observations) / logMax
      context.globalAlpha = Math.min(1, (0.18 + weight * 0.82) * levelAlpha)
      context.drawImage(glowSprite(colors.get(point.sourceKey) || '#e9c46a'), screen.x - radius, screen.y - radius, radius * 2, radius * 2)
    }
    context.globalCompositeOperation = 'source-over'
    context.globalAlpha = 1
  }

  if (display === 'spots' || view.k >= 16) {
    const dotScale = display === 'spots' ? (level === 'world' ? 0.7 : level === 'region' ? 1 : 1.25) : 1
    for (const point of placed) {
      const screen = toScreen(view, size, point.world)
      if (screen.x < -margin || screen.y < -margin || screen.x > size.width + margin || screen.y > size.height + margin) continue
      const weight = Math.log1p(point.observations) / logMax
      const radius = (1.6 + weight * 3.4) * dotScale
      context.beginPath()
      context.arc(screen.x, screen.y, radius, 0, Math.PI * 2)
      context.fillStyle = colors.get(point.sourceKey) || '#e9c46a'
      context.globalAlpha = display === 'spots' ? 0.95 : 0.85
      context.fill()
      context.globalAlpha = 1
      context.lineWidth = 1
      context.strokeStyle = 'rgba(5, 7, 10, 0.75)'
      context.stroke()
    }
  }

  if (highlight) {
    const screen = toScreen(view, size, highlight.world)
    context.beginPath()
    context.arc(screen.x, screen.y, 11, 0, Math.PI * 2)
    context.lineWidth = 2
    context.strokeStyle = '#fff'
    context.stroke()
    context.beginPath()
    context.arc(screen.x, screen.y, 15, 0, Math.PI * 2)
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

function Legend({
  mode, onMode, groups, colors, hidden, onToggle, onSolo, onGroup, onAll, query, onQuery,
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
                <button
                  type="button"
                  className={on ? undefined : 'is-off'}
                  aria-pressed={on}
                  aria-label={`${on ? 'Hide' : 'Show'} ${source.name}`}
                  title={`${source.name} · ${formatCount(source.observations)}`}
                  style={{ '--swatch': colors.get(source.sourceKey) }}
                  onClick={() => onToggle(source.sourceKey)}
                >
                  <SourceIcon source={source} size={24} />
                </button>
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
          <button
            type="button"
            className="gw-rmap__icon-btn"
            onClick={() => onMode(expanded ? 'compact' : 'expanded')}
            aria-label={expanded ? 'Narrow the legend' : 'Widen the legend'}
            title={expanded ? 'Narrow' : 'Widen'}
          >
            <Icon name={expanded ? 'shrink' : 'expand'} size={15} />
          </button>
          <button type="button" className="gw-rmap__icon-btn" onClick={() => onMode('hidden')} aria-label="Hide the legend" title="Hide legend">
            <Icon name="close" size={15} />
          </button>
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
                      <label>
                        <input type="checkbox" checked={on} onChange={() => onToggle(source.sourceKey)} />
                        <i className="gw-rmap__swatch" style={{ '--swatch': colors.get(source.sourceKey) }} aria-hidden="true" />
                        <SourceIcon source={source} size={expanded ? 20 : 16} />
                        <span className="gw-rmap__source-name">{source.name}</span>
                        {expanded ? <small>{formatCount(source.observations)}</small> : null}
                      </label>
                      <button type="button" className="gw-rmap__solo" onClick={() => onSolo(source.sourceKey)} aria-label={`Show only ${source.name}`}>Only</button>
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
}

// The community resource map: every gather position, on a zoomable atlas of
// Azeroth. "full" fills its container with a docked legend; "card" embeds in
// a panel with a floating legend and an "Open full map" link.
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
  const flightRef = useRef(0)
  useLayoutEffect(() => {
    viewRef.current = view
    sizeRef.current = size
  })

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
  const [cursor, setCursor] = useState(null)
  const [hoverZone, setHoverZone] = useState(null)
  const [hint, setHint] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const art = useMapArt() === true
  const [failedArt, setFailedArt] = useState(() => new Set())
  const failArt = useCallback((mapId) => setFailedArt((current) => new Set(current).add(mapId)), [])

  const sources = useMemo(() => data?.sources || [], [data])
  const sourcesByKey = useMemo(() => new Map(sources.map((source) => [source.sourceKey, source])), [sources])
  const colors = useMemo(() => sourceColors(sources), [sources])
  const visible = useMemo(() => new Set(sources.filter((source) => !hidden.has(source.sourceKey)).map((source) => source.sourceKey)), [sources, hidden])
  const { placed, unplaced } = useMemo(() => placePoints(data?.points || [], data?.zones || [], visible), [data, visible])
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
  const flyTo = useCallback((target, duration = 720) => {
    const from = viewRef.current
    const flight = flightRef.current + 1
    flightRef.current = flight
    if (prefersReducedMotion() || duration <= 0) {
      setView(target)
      return
    }
    const start = performance.now()
    const step = (now) => {
      if (flightRef.current !== flight) return
      const t = (now - start) / duration
      setView(interpolateView(from, target, t))
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [])
  const stopFlight = () => { flightRef.current += 1 }

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
    if (first) setView(target)
    else flyTo(target)
  }, [ready, status, focus, focusKey, focusMapId, totals, placed, size, flyTo])

  useEffect(() => {
    if (!onFocusZone) return undefined
    const timer = window.setTimeout(() => onFocusZone(focusZone?.mapId || null), 300)
    return () => window.clearTimeout(timer)
  }, [focusZone, onFocusZone])

  // ------------------------------------------------------------ Drawing
  const highlight = pinned || hover
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
    if (zoomLevel(viewRef.current.k) === 'world' && display === 'heat') return null
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
    stopFlight()
    stageRef.current.setPointerCapture?.(event.pointerId)
    const at = stagePoint(event)
    pointers.current.set(event.pointerId, at)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = { kind: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y), moved: true }
    } else {
      gesture.current = { kind: 'pan', last: at, start: at, moved: false }
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
        if (g.distance > 0) setView((current) => zoomAt(current, sizeRef.current, distance / g.distance, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }))
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
          setHover(null)
          setView((current) => panBy(current, sizeRef.current, dx, dy))
          return
        }
      }
    }
    const world = toWorld(viewRef.current, sizeRef.current, at)
    const located = locateWorldPoint(world)
    setCursor(located)
    setHoverZone(located?.zone?.mapId || null)
    const point = nearestPoint(at)
    setHover(point ? { ...point, screen: toScreen(viewRef.current, sizeRef.current, point.world) } : null)
  }

  function onPointerUp(event) {
    const g = gesture.current
    pointers.current.delete(event.pointerId)
    if (pointers.current.size === 1 && g?.kind === 'pinch') {
      gesture.current = { kind: 'pan', last: [...pointers.current.values()][0], start: [...pointers.current.values()][0], moved: true }
      return
    }
    gesture.current = null
    setDragging(false)
    if (!g || g.moved || g.kind !== 'pan') return
    const at = stagePoint(event)
    const point = nearestPoint(at)
    if (point) {
      setPinned(point)
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
    setHoverZone(null)
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
      stopFlight()
      const rect = stage.getBoundingClientRect()
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      setView((current) => zoomAt(current, sizeRef.current, Math.exp(-delta * 0.0022), anchor))
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      stage.removeEventListener('wheel', onWheel)
      window.clearTimeout(hintTimer)
    }
  }, [variant])

  function onDoubleClick(event) {
    flyTo(zoomAt(viewRef.current, sizeRef.current, 2.2, stagePoint(event)), 380)
  }

  function onKeyDown(event) {
    const step = 90
    const actions = {
      '+': () => flyTo(zoomAt(view, size, 1.8), 260),
      '=': () => flyTo(zoomAt(view, size, 1.8), 260),
      '-': () => flyTo(zoomAt(view, size, 1 / 1.8), 260),
      _: () => flyTo(zoomAt(view, size, 1 / 1.8), 260),
      ArrowLeft: () => setView(panBy(view, size, step, 0)),
      ArrowRight: () => setView(panBy(view, size, -step, 0)),
      ArrowUp: () => setView(panBy(view, size, 0, step)),
      ArrowDown: () => setView(panBy(view, size, 0, -step)),
      0: () => flyTo(HOME_VIEW),
      Home: () => flyTo(HOME_VIEW),
      Escape: () => setPinned(null),
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
  function toggleSource(key) {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  function soloSource(key) {
    setHidden(new Set(sources.map((source) => source.sourceKey).filter((entry) => entry !== key)))
  }
  function setGroup(group, on) {
    setHidden((current) => {
      const next = new Set(current)
      for (const source of group.sources) {
        if (on) next.delete(source.sourceKey)
        else next.add(source.sourceKey)
      }
      return next
    })
  }
  function setAll(on) {
    setHidden(on ? new Set() : new Set(sources.map((source) => source.sourceKey)))
  }
  function goToSpot(spot) {
    const target = { x: spot.world.x, y: spot.world.y, k: Math.max(viewRef.current.k, Math.min(28, ZONE_ZOOM * 2.4)) }
    flyTo(target, 520)
    const point = placed.find((entry) => entry.sourceKey === spot.sourceKey && entry.zone.mapId === spot.mapId && Math.hypot(entry.x - spot.x, entry.y - spot.y) < 0.02)
    setPinned(point ? { ...point, x: spot.x, y: spot.y, observations: spot.observations, world: spot.world } : null)
  }

  // ------------------------------------------------------------ Layers
  const scale = fitScale(size) * view.k
  const transform = `translate(${size.width / 2 - view.x * scale} ${size.height / 2 - view.y * scale}) scale(${scale})`
  const onScreen = (point, margin = 60) => point.x > -margin && point.y > -margin && point.x < size.width + margin && point.y < size.height + margin

  const zoneLabels = (level === 'world' && view.k < 1.45) || (art && level === 'zone')
    ? []
    : atlas.zones
      .filter((zone) => !zone.city || view.k >= 6)
      .map((zone) => ({ zone, at: toScreen(view, size, zone.label) }))
      .filter((entry) => onScreen(entry.at, 20))

  const bubbles = level === 'world'
    ? totals.map((entry) => ({ ...entry, at: toScreen(view, size, entry.zone.label) })).filter((entry) => onScreen(entry.at))
    : []

  const spotMarkers = level === 'zone' ? spots.map((spot, index) => ({ spot, index, at: toScreen(view, size, spot.world) })).filter((entry) => onScreen(entry.at)) : []
  const pinnedAt = pinned ? toScreen(view, size, pinned.world) : null
  const hoverAt = !pinned && hover ? toScreen(view, size, hover.world) : null
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
      className={`gw-rmap gw-rmap--${variant} gw-rmap--legend-${legendHost ? 'external' : legend}${fullscreen ? ' is-fullscreen' : ''}`}
      data-level={level}
    >
      {legendHost ? createPortal(legendNode, legendHost) : legendNode}

      <div className="gw-rmap__viewport">
      <div
        ref={stageRef}
        className={`gw-rmap__stage${dragging ? ' is-dragging' : ''}${hover ? ' is-pointing' : ''}`}
        role="application"
        aria-roledescription="map"
        aria-label={`${label}. ${shownSources} resource${shownSources === 1 ? '' : 's'} shown${centre?.zone ? `, centred on ${centre.zone.name}` : ''}. Use plus and minus to zoom, arrow keys to pan, 0 to show the whole world.`}
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
                <stop offset="0%" stopColor="#0f1722" />
                <stop offset="100%" stopColor="#06080c" />
              </radialGradient>
              <pattern id="gw-rmap-grid" width="25" height="25" patternUnits="userSpaceOnUse">
                <path d="M25 0H0V25" fill="none" stroke="rgba(124,179,255,0.05)" strokeWidth="0.4" />
              </pattern>
              <linearGradient id="gw-rmap-fade-x-gradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#fff" stopOpacity="0" />
                <stop offset="0.07" stopColor="#fff" stopOpacity="1" />
                <stop offset="0.93" stopColor="#fff" stopOpacity="1" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="gw-rmap-fade-y-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fff" stopOpacity="0" />
                <stop offset="0.1" stopColor="#fff" stopOpacity="1" />
                <stop offset="0.9" stopColor="#fff" stopOpacity="1" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
              <mask id="gw-rmap-fade-x" maskContentUnits="objectBoundingBox">
                <rect width="1" height="1" fill="url(#gw-rmap-fade-x-gradient)" />
              </mask>
              <mask id="gw-rmap-fade-y" maskContentUnits="objectBoundingBox">
                <rect width="1" height="1" fill="url(#gw-rmap-fade-y-gradient)" />
              </mask>
              <linearGradient id="gw-rmap-land" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1b222b" />
                <stop offset="100%" stopColor="#141920" />
              </linearGradient>
            </defs>
            <rect width={size.width} height={size.height} fill="url(#gw-rmap-ocean)" />
            <g transform={transform}>
              <rect x={-WORLD.width} y={-WORLD.height} width={WORLD.width * 3} height={WORLD.height * 3} fill="url(#gw-rmap-grid)" />
              {art ? (
                // The game's maps, crossfading as the camera descends: the
                // world, then each continent, then the zones in view.
                <g className="gw-rmap__art">
                  <ArtImage mapId={AZEROTH_MAP_ID} rect={AZEROTH_RECT} opacity={clamp01((1.9 - view.k) / 0.7)} failed={failedArt} onFail={failArt} />
                  {atlas.continents.map((continent) => (
                    <ArtImage key={continent.mapId} mapId={continent.mapId} rect={continent.rect} opacity={clamp01((view.k - 1.2) / 0.7)} failed={failedArt} onFail={failArt} />
                  ))}
                  {view.k >= 2.4 && centre?.zone ? (
                    <ArtImage key={centre.zone.mapId} mapId={centre.zone.mapId} rect={centre.zone.rect} opacity={clamp01((view.k - 2.4) / 1.6)} failed={failedArt} onFail={failArt} feather />
                  ) : null}
                </g>
              ) : atlas.continents.map((continent) => (
                <g key={continent.mapId} className="gw-rmap__continent">
                  <path d={continent.path} className="gw-rmap__shore" />
                  <path d={continent.path} className="gw-rmap__land" />
                </g>
              ))}
              {atlas.zones.filter((zone) => !zone.city).map((zone) => (
                <path
                  key={zone.mapId}
                  d={zone.path}
                  className={`gw-rmap__zone${art ? ' gw-rmap__zone--art' : ''}${hoverZone === zone.mapId ? ' is-hover' : ''}${focusZone?.mapId === zone.mapId ? ' is-focus' : ''}`}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {view.k >= 3 && !art ? atlas.zones.filter((zone) => zone.city).map((zone) => (
                <rect
                  key={zone.mapId}
                  x={zone.rect.x}
                  y={zone.rect.y}
                  width={zone.rect.width}
                  height={zone.rect.height}
                  rx={Math.min(zone.rect.width, zone.rect.height) * 0.18}
                  className="gw-rmap__city"
                  vectorEffect="non-scaling-stroke"
                />
              )) : null}
            </g>
            {level === 'world' && !art ? atlas.continents.map((continent) => {
              const at = toScreen(view, size, continent.label)
              return (
                <text key={continent.mapId} x={at.x} y={at.y} className="gw-rmap__continent-label" textAnchor={continent.label.anchor}>
                  {continent.name}
                </text>
              )
            }) : null}
            {zoneLabels.map(({ zone, at }) => (
              <text
                key={zone.mapId}
                x={at.x}
                y={at.y}
                textAnchor="middle"
                className={`gw-rmap__zone-label${zone.city ? ' gw-rmap__zone-label--city' : ''}${focusZone?.mapId === zone.mapId ? ' is-focus' : ''}`}
              >
                {zone.name}
              </text>
            ))}
          </svg>
        ) : null}
        <canvas ref={canvasRef} className="gw-rmap__canvas" style={{ width: size.width, height: size.height }} aria-hidden="true" />

        {bubbles.length ? (
          <div className="gw-rmap__overlay" aria-hidden="true">
            {bubbles.map((entry) => {
              const radius = 9 + Math.sqrt(entry.observations / maxZone) * 17
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
                  title={`${entry.zone.name}: ${formatCount(entry.observations)} gathers`}
                >
                  {entry.observations >= 1000 ? `${(entry.observations / 1000).toFixed(entry.observations >= 10000 ? 0 : 1)}k` : entry.observations}
                </span>
              )
            })}
          </div>
        ) : null}

        {spotMarkers.length ? (
          <div className="gw-rmap__overlay" aria-hidden="true">
            {spotMarkers.map(({ spot, index, at }) => (
              <span key={`${spot.sourceKey}-${index}`} className="gw-rmap__marker" style={{ left: at.x, top: at.y, '--marker': colors.get(spot.sourceKey) }}>
                {index + 1}
              </span>
            ))}
          </div>
        ) : null}

        {hoverAt && hover ? (
          <div className="gw-rmap__tip" style={{ left: hoverAt.x, top: hoverAt.y }} role="presentation">
            <strong><i className="gw-rmap__swatch" style={{ '--swatch': colors.get(hover.sourceKey) }} />{sourcesByKey.get(hover.sourceKey)?.name}</strong>
            <span>{hover.zone.name} · <code>{formatCoords(hover.x, hover.y)}</code></span>
            <small>{formatCount(hover.observations)} gather{hover.observations === 1 ? '' : 's'} here · click for more</small>
          </div>
        ) : null}

        {pinned && pinnedAt ? (
          <div className="gw-rmap__pop" style={{ left: pinnedAt.x, top: pinnedAt.y }} role="dialog" aria-label={`${sourcesByKey.get(pinned.sourceKey)?.name || 'Spot'} details`} onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
            <header>
              {sourcesByKey.get(pinned.sourceKey) ? <SourceIcon source={sourcesByKey.get(pinned.sourceKey)} size={28} /> : null}
              <div>
                <strong>{sourcesByKey.get(pinned.sourceKey)?.name}</strong>
                <DisciplineTag discipline={sourcesByKey.get(pinned.sourceKey)?.discipline} />
              </div>
              <button type="button" className="gw-rmap__icon-btn" onClick={() => setPinned(null)} aria-label="Close"><Icon name="close" size={14} /></button>
            </header>
            <dl>
              <div><dt>Zone</dt><dd>{pinned.zone.name}</dd></div>
              <div><dt>Map position</dt><dd><code>{formatCoords(pinned.x, pinned.y)}</code></dd></div>
              <div><dt>Gathers here</dt><dd>{formatCount(pinned.observations)}</dd></div>
            </dl>
            <div className="gw-rmap__pop-actions">
              <a className="gw-btn gw-btn--sm gw-btn--primary" href={sourceHref(pinned.sourceKey)}>Drop table</a>
              {level !== 'zone' ? <button type="button" className="gw-btn gw-btn--sm" onClick={() => flyToZone(pinned.zone)}>Zoom to zone</button> : null}
            </div>
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
          <button type="button" onClick={() => flyTo(zoomAt(view, size, 1.8), 260)} aria-label="Zoom in" title="Zoom in (+)"><Icon name="plus" size={16} /></button>
          <button type="button" onClick={() => flyTo(zoomAt(view, size, 1 / 1.8), 260)} aria-label="Zoom out" title="Zoom out (−)"><Icon name="minus" size={16} /></button>
        </div>
        <div className="gw-rmap__control-group">
          <button type="button" onClick={() => flyTo(HOME_VIEW)} aria-label="Show the whole world" title="Whole world (0)"><Icon name="globe" size={16} /></button>
          <button type="button" onClick={toggleFullscreen} aria-label={fullscreenLabel} title={fullscreenLabel}><Icon name={fullscreen ? 'exitFullscreen' : 'fullscreen'} size={16} /></button>
        </div>
        {fullHref && !fullscreen ? (
          <a className="gw-rmap__control-link" href={fullHref} title="Open the full resource map" aria-label="Open the full resource map"><Icon name="external" size={15} /></a>
        ) : null}
      </div>

      <div className="gw-rmap__display" role="group" aria-label="Display">
        <button type="button" aria-pressed={display === 'heat'} onClick={() => setDisplay('heat')}>Heat</button>
        <button type="button" aria-pressed={display === 'spots'} onClick={() => setDisplay('spots')}>Spots</button>
      </div>

      <div className="gw-rmap__readout" aria-live="off">
        {cursor ? (
          <>
            <strong>{cursor.zone.name}</strong>
            <code>{formatCoords(cursor.x, cursor.y)}</code>
          </>
        ) : (
          <span>{level === 'world' ? 'Click a zone to zoom in' : level === 'region' ? 'Scroll or click a zone to zoom' : 'Click a spot for details'}</span>
        )}
        <span className="gw-rmap__zoom">×{view.k.toFixed(view.k < 10 ? 1 : 0)}</span>
      </div>
      </div>

    </div>
  )
}
