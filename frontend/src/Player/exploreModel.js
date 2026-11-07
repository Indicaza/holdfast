// The explore views' pure logic: where each drop is best farmed, and the
// shared scale for rate bars. Tested without a browser.

import { disciplineLabel, formatCount, formatRate, observationLabel } from '../Intelligence/Farming/farmingModel.js'

const CONFIDENCE_RANK = Object.freeze({ low: 0, medium: 1, high: 2, very_high: 3 })

export function confidenceRank(confidence) {
  return CONFIDENCE_RANK[confidence] ?? 0
}

// Every notable drop across the sources, each with the source that gives it
// most often. A low-sample rate never beats a trustworthy one: a 7% from 14
// gathers is a hint, a 4.7% from 900 is a finding. Sorted rarest-quality
// first, then by chance.
export function bestPlacesToFarm(sources = []) {
  const byItem = new Map()
  for (const source of sources) {
    for (const drop of source.drops || []) {
      if (!drop?.itemKey) continue
      const entry = byItem.get(drop.itemKey) || { item: drop, places: [] }
      entry.places.push({ source, drop })
      byItem.set(drop.itemKey, entry)
    }
  }
  const trusted = (place) => confidenceRank(place.drop.confidence) >= 1
  return [...byItem.values()]
    .map((entry) => {
      const places = [...entry.places].sort((a, b) => (
        Number(trusted(b)) - Number(trusted(a))
        || (Number(b.drop.rate) || 0) - (Number(a.drop.rate) || 0)
        || (Number(b.drop.observations) || 0) - (Number(a.drop.observations) || 0)
      ))
      return { item: entry.item, best: places[0], places }
    })
    .sort((a, b) => (
      (Number(b.item.qualityId) || 0) - (Number(a.item.qualityId) || 0)
      || (Number(b.best.drop.rate) || 0) - (Number(a.best.drop.rate) || 0)
    ))
}

// The scale a table of rate bars shares: the largest likely-range top, so
// every bar and its range fit. Never zero.
export function rateScale(entries = []) {
  const max = entries.reduce((best, entry) => Math.max(best, Number(entry?.high) || 0, Number(entry?.rate) || 0), 0)
  return max > 0 ? Math.min(1, max) : 1
}

// Grid cells for a hotspot map: points binned into a size×size grid, each
// cell's weight its share of the busiest cell. Coordinates are normalized
// map positions (0–1).
export function hotspotCells(points = [], size = 24) {
  const cells = new Map()
  for (const point of points) {
    if (point?.x === null || point?.x === undefined || point?.y === null || point?.y === undefined) continue
    const x = Number(point.x)
    const y = Number(point.y)
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) continue
    const col = Math.min(size - 1, Math.floor(x * size))
    const row = Math.min(size - 1, Math.floor(y * size))
    const key = `${col}:${row}`
    const cell = cells.get(key) || { col, row, observations: 0 }
    cell.observations += Number(point.observations) || 1
    cells.set(key, cell)
  }
  const peak = Math.max(0, ...[...cells.values()].map((cell) => cell.observations))
  return [...cells.values()]
    .map((cell) => ({ ...cell, weight: peak ? cell.observations / peak : 0 }))
    .sort((a, b) => a.weight - b.weight)
}

// Points grouped by map, busiest map first. `maps` (from the server) names
// each map and counts all of its observations, so a map whose points fell
// past the server's cap still gets a tab.
export function hotspotMaps(points = [], maps = []) {
  const grouped = new Map(maps.map((map) => [map.mapId, { mapId: map.mapId, zone: map.zone || null, observations: Number(map.observations) || 0, points: [] }]))
  for (const point of points) {
    const group = grouped.get(point.mapId) || { mapId: point.mapId, zone: null, observations: 0, points: [], counted: true }
    group.points.push(point)
    grouped.set(point.mapId, group)
  }
  return [...grouped.values()]
    .map(({ counted, ...group }) => ({
      ...group,
      observations: counted || !group.observations
        ? group.points.reduce((sum, point) => sum + (Number(point.observations) || 1), 0)
        : group.observations,
    }))
    .sort((a, b) => b.observations - a.observations || a.mapId - b.mapId)
}

// Client-side ordering for the source table's columns the server does not
// sort by.
export function sortSources(sources = [], { key = 'observations', direction = 'desc' } = {}) {
  const sign = direction === 'asc' ? 1 : -1
  const value = (source) => {
    switch (key) {
      case 'name': return String(source.name || '').toLowerCase()
      case 'zone': return String(source.primaryZone || '').toLowerCase()
      case 'chance': return Math.max(0, ...(source.matches?.length ? source.matches : source.drops || []).map((drop) => Number(drop.rate) || 0))
      case 'recent': return Date.parse(source.lastObservedAt) || 0
      default: return Number(source.observations) || 0
    }
  }
  return [...sources].sort((a, b) => {
    const left = value(a)
    const right = value(b)
    if (left < right) return -1 * sign
    if (left > right) return 1 * sign
    return String(a.name || '').localeCompare(String(b.name || ''))
  })
}

// Opens a source's page in place (the href keeps it a real link).
export function sourceHref(sourceKey, { item = '' } = {}) {
  const params = new URLSearchParams()
  params.set('source', sourceKey)
  if (item) params.set('item', item)
  const server = new URLSearchParams(globalThis.location?.search || '').get('server')
  if (server) params.set('server', server)
  return `/dashboard/farming?${params}`
}

// Everything the palette can jump to, in the order it lists them: drops that
// match the search, the sources that produce them, the player's characters
// and the app's pages.
export function paletteEntries({ query = '', sources = [], characters = [], views = [] } = {}) {
  const needle = query.trim().toLowerCase()
  const matches = (value) => !needle || String(value || '').toLowerCase().includes(needle)
  const entries = []

  if (needle) {
    const drops = []
    for (const source of sources) {
      for (const match of source.matches || []) {
        drops.push({ source, match })
      }
    }
    drops.sort((a, b) => (Number(b.match.rate) || 0) - (Number(a.match.rate) || 0))
    for (const { source, match } of drops.slice(0, 6)) {
      entries.push({
        id: `drop:${source.sourceKey}:${match.itemKey}`,
        group: 'Drops',
        kind: 'drop',
        label: match.name,
        detail: `${formatRate(match.rate)} from ${source.name}${source.primaryZone ? ` · ${source.primaryZone}` : ''}`,
        item: match,
        href: sourceHref(source.sourceKey, { item: match.itemKey }),
      })
    }
  }

  for (const source of sources.slice(0, needle ? 8 : 5)) {
    entries.push({
      id: `source:${source.sourceKey}`,
      group: needle ? 'Sources' : 'Most observed sources',
      kind: 'source',
      label: source.name,
      detail: `${disciplineLabel(source.discipline)} · ${source.primaryZone || 'Zone unknown'} · ${formatCount(source.observations)} ${observationLabel(source.discipline, source.observations)}`,
      item: source.icon,
      href: sourceHref(source.sourceKey),
    })
  }

  for (const character of characters.filter((entry) => matches(entry.name) || matches(entry.className) || matches(entry.realm)).slice(0, needle ? 5 : 3)) {
    entries.push({
      id: `character:${character.id}`,
      group: 'Your characters',
      kind: 'character',
      label: character.name,
      detail: [character.level ? `Level ${character.level}` : '', character.race, character.className, character.realm].filter(Boolean).join(' · '),
      character,
    })
  }

  for (const view of views.filter((entry) => matches(entry.label) || matches(entry.description))) {
    entries.push({ id: `view:${view.id}`, group: 'Go to', kind: 'view', label: view.label, detail: view.description, icon: view.icon, href: view.href })
  }

  return entries
}
