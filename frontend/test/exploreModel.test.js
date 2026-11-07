import test from 'node:test'
import assert from 'node:assert/strict'

import {
  bestPlacesToFarm,
  confidenceRank,
  hotspotCells,
  hotspotMaps,
  paletteEntries,
  rateScale,
  sortSources,
  sourceHref,
} from '../src/Player/exploreModel.js'

const lichen = { itemKey: 'item:1', itemId: 1, name: 'Frilled Lichen', qualityId: 2 }
const thistle = { itemKey: 'item:2', itemId: 2, name: 'Swiftthistle', qualityId: 1 }

function source(name, drops, extra = {}) {
  return { sourceKey: `herbalism:herb-node:${name.toLowerCase()}`, name, discipline: 'herbalism', observations: 100, primaryZone: 'Elwynn Forest', drops, ...extra }
}

test('confidence ranks low to very high, unknown as low', () => {
  assert.deepEqual(['low', 'medium', 'high', 'very_high', undefined].map(confidenceRank), [0, 1, 2, 3, 0])
})

test('best places to farm: a thin sample never outranks a trustworthy rate', () => {
  const rows = bestPlacesToFarm([
    source('Kingsblood', [{ ...lichen, rate: 0.07, confidence: 'low', observations: 14 }]),
    source('Earthroot', [{ ...lichen, rate: 0.047, confidence: 'high', observations: 900 }]),
    source('Peacebloom', [{ ...lichen, rate: 0.024, confidence: 'very_high', observations: 8000 }, { ...thistle, rate: 0.08, confidence: 'high' }]),
  ])
  assert.deepEqual(rows.map((row) => row.item.name), ['Frilled Lichen', 'Swiftthistle'], 'higher quality first')
  assert.equal(rows[0].best.source.name, 'Earthroot')
  assert.deepEqual(rows[0].places.map((place) => place.source.name), ['Earthroot', 'Peacebloom', 'Kingsblood'])
  assert.deepEqual(bestPlacesToFarm([source('Empty', [])]), [])
})

test('rate scale covers every likely range and is never zero', () => {
  assert.equal(rateScale([{ rate: 0.02, high: 0.03 }, { rate: 0.05, high: 0.04 }]), 0.05)
  assert.equal(rateScale([]), 1)
  assert.equal(rateScale([{ rate: 1, high: 1.2 }]), 1)
})

test('hotspot cells bin points and weight them against the busiest cell', () => {
  const cells = hotspotCells([
    { x: 0.01, y: 0.01, observations: 2 },
    { x: 0.02, y: 0.02, observations: 2 },
    { x: 0.99, y: 1, observations: 1 },
    { x: -1, y: 0.5 },
    { x: null, y: 0.5 },
  ], 10)
  assert.equal(cells.length, 2)
  const busiest = cells.at(-1)
  assert.deepEqual({ col: busiest.col, row: busiest.row, observations: busiest.observations, weight: busiest.weight }, { col: 0, row: 0, observations: 4, weight: 1 })
  assert.deepEqual({ col: cells[0].col, row: cells[0].row, weight: cells[0].weight }, { col: 9, row: 9, weight: 0.25 })
})

test('hotspot maps list every named map, busiest first, even without points', () => {
  const maps = hotspotMaps(
    [{ mapId: 1, x: 0.5, y: 0.5, observations: 3 }, { mapId: 7, x: 0.1, y: 0.1, observations: 2 }],
    [{ mapId: 1, zone: 'Elwynn Forest', observations: 40 }, { mapId: 2, zone: 'Westfall', observations: 90 }],
  )
  assert.deepEqual(maps.map((map) => [map.mapId, map.zone, map.observations, map.points.length]), [
    [2, 'Westfall', 90, 0],
    [1, 'Elwynn Forest', 40, 1],
    [7, null, 2, 1],
  ])
})

test('sources sort by any column, ties by name', () => {
  const sources = [
    source('Silverleaf', [{ rate: 0.02 }], { observations: 50, primaryZone: 'Teldrassil', lastObservedAt: '2026-10-02T00:00:00Z' }),
    source('Briarthorn', [{ rate: 0.07 }], { observations: 50, primaryZone: 'Ashenvale', lastObservedAt: '2026-10-05T00:00:00Z' }),
    source('Peacebloom', [], { observations: 80, primaryZone: 'Durotar', lastObservedAt: '2026-10-01T00:00:00Z', matches: [{ rate: 0.5 }] }),
  ]
  const names = (key, direction) => sortSources(sources, { key, direction }).map((entry) => entry.name)
  assert.deepEqual(names('observations', 'desc'), ['Peacebloom', 'Briarthorn', 'Silverleaf'])
  assert.deepEqual(names('name', 'asc'), ['Briarthorn', 'Peacebloom', 'Silverleaf'])
  assert.deepEqual(names('zone', 'asc'), ['Briarthorn', 'Peacebloom', 'Silverleaf'])
  assert.deepEqual(names('chance', 'desc'), ['Peacebloom', 'Briarthorn', 'Silverleaf'], 'a searched item ranks by its own rate')
  assert.deepEqual(names('recent', 'desc'), ['Briarthorn', 'Silverleaf', 'Peacebloom'])
})

test('a source link opens its page in Drop rates, keeping the item and server', () => {
  const previous = globalThis.location
  globalThis.location = { search: '?server=us%3Adoomhowl' }
  try {
    assert.equal(sourceHref('herbalism:herb-node:peacebloom', { item: 'item:1' }), '/dashboard/farming?source=herbalism%3Aherb-node%3Apeacebloom&item=item%3A1&server=us%3Adoomhowl')
  } finally {
    globalThis.location = previous
  }
  assert.equal(sourceHref('mining:ore-vein:copper'), '/dashboard/farming?source=mining%3Aore-vein%3Acopper')
})

test('the palette lists matching drops by chance, then sources, characters and pages', () => {
  const sources = [
    source('Peacebloom', [], { matches: [{ ...lichen, rate: 0.024 }] }),
    source('Earthroot', [], { matches: [{ ...lichen, rate: 0.047 }] }),
  ]
  const characters = [{ id: 'c1', name: 'Lichenna', className: 'Druid', level: 20 }, { id: 'c2', name: 'Mira', className: 'Rogue' }]
  const views = [{ id: 'farming', label: 'Drop rates', description: 'Every node', href: '/dashboard/farming' }]
  const entries = paletteEntries({ query: 'lichen', sources, characters, views })
  assert.deepEqual(entries.map((entry) => entry.group), ['Drops', 'Drops', 'Sources', 'Sources', 'Your characters'])
  assert.equal(entries[0].detail, '4.70% from Earthroot · Elwynn Forest')
  assert.match(entries[0].href, /source=herbalism%3Aherb-node%3Aearthroot&item=item%3A1/)
  assert.equal(entries[4].character.id, 'c1')

  const idle = paletteEntries({ query: '', sources, characters, views })
  assert.deepEqual(idle.map((entry) => entry.group), ['Most observed sources', 'Most observed sources', 'Your characters', 'Your characters', 'Go to'])
})
