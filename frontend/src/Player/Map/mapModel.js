// The resource map's pure logic: its API URL, the camera (pan and zoom),
// source colours, and what to draw for the sources shown.

import { WORLD, atlasZone, projectPoint } from './atlas.js'

export const MIN_ZOOM = 1
export const MAX_ZOOM = 48
// Zoom thresholds: the world shows zone totals, a region shows heat, a zone
// shows individual spots.
export const REGION_ZOOM = 2.1
export const ZONE_ZOOM = 5.5

export function mapUrl({ discipline = '', sources = [], item = '' } = {}) {
  const params = new URLSearchParams()
  if (discipline) params.set('discipline', discipline)
  if (sources.length) params.set('source', sources.join(','))
  if (item) params.set('item', item)
  const query = params.toString()
  return `/api/intelligence/farming/map${query ? `?${query}` : ''}`
}

// ------------------------------------------------------------------ Camera
// A view is the world point at the centre of the screen and a zoom, where
// zoom 1 fits the whole world in the viewport.

export function fitScale(size) {
  if (!size?.width || !size?.height) return 1
  return Math.min(size.width / WORLD.width, size.height / WORLD.height) * 0.96
}

export const HOME_VIEW = Object.freeze({ x: WORLD.width / 2, y: WORLD.height / 2, k: 1 })

export function clampView(view) {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k))
  return {
    x: Math.min(WORLD.width, Math.max(0, view.x)),
    y: Math.min(WORLD.height, Math.max(0, view.y)),
    k,
  }
}

export function screenScale(view, size) {
  return fitScale(size) * view.k
}

export function toScreen(view, size, point) {
  const scale = screenScale(view, size)
  return { x: (point.x - view.x) * scale + size.width / 2, y: (point.y - view.y) * scale + size.height / 2 }
}

export function toWorld(view, size, point) {
  const scale = screenScale(view, size)
  return { x: (point.x - size.width / 2) / scale + view.x, y: (point.y - size.height / 2) / scale + view.y }
}

// Zoom by `factor` keeping the world point under `anchor` (screen) in place.
export function zoomAt(view, size, factor, anchor = { x: size.width / 2, y: size.height / 2 }) {
  const target = toWorld(view, size, anchor)
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k * factor))
  const scale = fitScale(size) * k
  return clampView({
    x: target.x - (anchor.x - size.width / 2) / scale,
    y: target.y - (anchor.y - size.height / 2) / scale,
    k,
  })
}

export function panBy(view, size, dx, dy) {
  const scale = screenScale(view, size)
  return clampView({ ...view, x: view.x - dx / scale, y: view.y - dy / scale })
}

// The view that frames `bounds` (world units) with some room around it.
export function fitBounds(bounds, size, padding = 0.82) {
  const base = fitScale(size)
  const k = Math.min(size.width / (bounds.width * base), size.height / (bounds.height * base)) * padding
  return clampView({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, k })
}

export function zoomLevel(k) {
  if (k >= ZONE_ZOOM) return 'zone'
  if (k >= REGION_ZOOM) return 'region'
  return 'world'
}

export function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

// A point along a flight between two views: zoom moves in log space so the
// camera feels like it travels at a steady height.
export function interpolateView(from, to, t) {
  const e = easeInOut(Math.min(1, Math.max(0, t)))
  return {
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e,
    k: Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e),
  }
}

// ------------------------------------------------------------------ Colours

const PALETTES = {
  herbalism: ['#6fd38b', '#c8e86b', '#41c9a6', '#e8d46a', '#97e3c2', '#9fcf5a', '#62b9a3', '#dff29a'],
  mining: ['#e0a065', '#f2c14e', '#e0784e', '#cfa77f', '#f59a63', '#b9895c'],
  fishing: ['#5cb8ea', '#8aa2ff', '#4fd8e3', '#a8cbff'],
  skinning: ['#e0876a', '#ec7272', '#d0a07a'],
  loot: ['#b796f0', '#e58ad6', '#9d8cff', '#d6b0ff'],
}

// One colour per source, from its profession's family, busiest source first.
export function sourceColors(sources = []) {
  const used = {}
  const colors = new Map()
  for (const source of [...sources].sort((a, b) => b.observations - a.observations)) {
    const family = PALETTES[source.discipline] ? source.discipline : 'loot'
    const index = used[family] || 0
    used[family] = index + 1
    colors.set(source.sourceKey, PALETTES[family][index % PALETTES[family].length])
  }
  return colors
}

// ------------------------------------------------------------------ Data

// Points placed on the atlas, for the sources shown. Points on maps the atlas
// does not draw (dungeons, new zones) are counted, not placed.
export function placePoints(points = [], zones = [], visible = null) {
  const names = new Map(zones.map((zone) => [zone.mapId, zone.zone]))
  const placed = []
  let unplaced = 0
  for (const point of points) {
    if (visible && !visible.has(point.sourceKey)) continue
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    const zone = atlasZone(point.mapId, names.get(point.mapId))
    if (!zone) {
      unplaced += point.observations || 0
      continue
    }
    placed.push({ ...point, zone, world: projectPoint(zone, point.x, point.y) })
  }
  return { placed, unplaced }
}

// Totals per atlas zone for the sources shown: the world view's bubbles.
export function zoneTotals(placed = []) {
  const totals = new Map()
  for (const point of placed) {
    const entry = totals.get(point.zone.mapId) || { zone: point.zone, observations: 0, bySource: new Map() }
    entry.observations += point.observations
    entry.bySource.set(point.sourceKey, (entry.bySource.get(point.sourceKey) || 0) + point.observations)
    totals.set(point.zone.mapId, entry)
  }
  return [...totals.values()]
    .map((entry) => ({
      zone: entry.zone,
      observations: entry.observations,
      topSource: [...entry.bySource.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      sources: entry.bySource.size,
    }))
    .sort((a, b) => b.observations - a.observations)
}

// The busiest spots in a zone: neighbouring grid cells of the same source
// merge into one spot (within `radius` of the map), busiest first.
export function busiestSpots(placed = [], mapId, { radius = 0.02, limit = 5 } = {}) {
  const spots = []
  const candidates = placed.filter((point) => point.zone.mapId === mapId).sort((a, b) => b.observations - a.observations)
  for (const point of candidates) {
    const near = spots.find((spot) => spot.sourceKey === point.sourceKey && Math.hypot(spot.x - point.x, spot.y - point.y) <= radius)
    if (near) {
      const total = near.observations + point.observations
      near.x = (near.x * near.observations + point.x * point.observations) / total
      near.y = (near.y * near.observations + point.y * point.observations) / total
      near.observations = total
    } else {
      spots.push({ sourceKey: point.sourceKey, mapId, zone: point.zone, x: point.x, y: point.y, observations: point.observations })
    }
  }
  return spots
    .sort((a, b) => b.observations - a.observations)
    .slice(0, limit)
    .map((spot) => ({ ...spot, world: projectPoint(spot.zone, spot.x, spot.y) }))
}

// The in-game way to write a map position: "48.2, 27.5".
export function formatCoords(x, y) {
  const part = (value) => (Math.min(1, Math.max(0, value)) * 100).toFixed(1)
  return `${part(x)}, ${part(y)}`
}

// Sources grouped by profession for the legend, filtered by a search.
export function legendGroups(sources = [], query = '') {
  const needle = query.trim().toLowerCase()
  const groups = new Map()
  for (const source of sources) {
    if (needle && !source.name.toLowerCase().includes(needle) && !String(source.icon?.name || '').toLowerCase().includes(needle)) continue
    const key = source.discipline || 'loot'
    if (!groups.has(key)) groups.set(key, { discipline: key, sources: [], observations: 0 })
    const group = groups.get(key)
    group.sources.push(source)
    group.observations += source.observations
  }
  return [...groups.values()].sort((a, b) => b.observations - a.observations)
}
