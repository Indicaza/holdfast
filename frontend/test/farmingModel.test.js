import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OTHER_COLOR,
  activeFilterCount,
  arcPath,
  confidenceLabel,
  disciplineLabel,
  donutSegments,
  formatCount,
  formatRate,
  rankLabel,
  rateLinePoints,
  rateRangeText,
  sourceDetailUrl,
  sourceKindLabel,
  sourcesUrl,
} from '../src/Intelligence/Farming/farmingModel.js'

test('rates keep rare drops visible without overstating precision', () => {
  assert.equal(formatRate(1), '100%')
  assert.equal(formatRate(0.99999), '100%')
  assert.equal(formatRate(0.25), '25.0%')
  assert.equal(formatRate(0.028), '2.80%')
  assert.equal(formatRate(0.005), '0.50%')
  assert.equal(formatRate(0.00012), '0.012%')
  assert.equal(formatRate(0), '0%')
  assert.equal(formatRate('nope'), '0%')
  assert.equal(formatCount(8143), '8,143')
})

test('labels name disciplines, kinds, ranks and confidence', () => {
  assert.equal(disciplineLabel('herbalism'), 'Herbalism')
  assert.equal(disciplineLabel('archaeology'), 'Archaeology')
  assert.equal(sourceKindLabel('herb-node'), 'Herb')
  assert.equal(sourceKindLabel('giant-clam'), 'Giant Clam')
  assert.equal(rankLabel(3), 'Rank 3')
  assert.equal(rankLabel('unknown'), 'Unknown')
  assert.equal(confidenceLabel('very_high'), 'Very High')
  assert.equal(confidenceLabel('anything else'), 'Low')
})

test('every rate carries its sample size', () => {
  assert.equal(rateRangeText({ successes: 3, observations: 12, low: 0.089, high: 0.53 }), '3 of 12 · likely 8.90%–53.0%')
  assert.equal(rateRangeText({ drops: 284, observations: 11300, low: 0.0224, high: 0.0282 }), '284 of 11,300 · likely 2.24%–2.82%')
  assert.equal(rateRangeText({ observations: 0 }), 'No observations')
})

test('filters become query parameters; empty ones are left out', () => {
  assert.equal(activeFilterCount({ zone: 'Duskwood', skillMin: '51', rank: '' }), 2)
  assert.equal(
    sourceDetailUrl('herbalism:herb-node:peacebloom', { filters: { zone: 'Duskwood', rank: '0', skillMin: ' ' }, item: 'item:249399' }),
    '/api/intelligence/farming/sources/herbalism%3Aherb-node%3Apeacebloom?zone=Duskwood&rank=0&item=item%3A249399',
  )
  assert.equal(sourceDetailUrl('mining:ore-vein:copper-vein'), '/api/intelligence/farming/sources/mining%3Aore-vein%3Acopper-vein')
  assert.equal(sourcesUrl({ query: ' Frilled Lichen ', discipline: 'herbalism' }), '/api/intelligence/farming/sources?q=Frilled+Lichen&discipline=herbalism')
  assert.equal(sourcesUrl(), '/api/intelligence/farming/sources')
})

test('the donut folds the long tail into Other and covers the whole circle', () => {
  const outputs = [
    { itemKey: 'a', name: 'Peacebloom', quantity: 900 },
    { itemKey: 'b', name: 'Frilled Lichen', quantity: 50 },
    { itemKey: 'c', name: 'C', quantity: 20 },
    { itemKey: 'd', name: 'D', quantity: 15 },
    { itemKey: 'e', name: 'E', quantity: 10 },
    { itemKey: 'f', name: 'F', quantity: 5 },
  ]
  const segments = donutSegments(outputs)
  assert.equal(segments.length, 5)
  assert.deepEqual(segments.map((segment) => segment.name), ['Peacebloom', 'Frilled Lichen', 'C', 'D', '2 others'])
  assert.equal(segments.at(-1).color, OTHER_COLOR)
  assert.equal(segments.at(-1).quantity, 15)
  assert.equal(segments[0].start, 0)
  assert.ok(Math.abs(segments.at(-1).end - 1) < 1e-9)
  assert.equal(new Set(segments.slice(0, 4).map((segment) => segment.color)).size, 4)
  assert.deepEqual(donutSegments([]), [])
  assert.equal(donutSegments(outputs.slice(0, 2)).length, 2)
  assert.match(arcPath(0, 1), /^M50 6A44 44 0 1 1 /)
  assert.match(arcPath(0, 0.25), /A44 44 0 0 1 94 50L80 50A30 30 0 0 0 50 20Z$/)
})

test('the skill line plots known buckets only, scales to the rates and clips likely ranges', () => {
  const rows = [
    { bucket: '1-25', rate: 0.01, low: 0.005, high: 0.02, observations: 100 },
    { bucket: '26-50', rate: 0.03, low: 0.02, high: 0.04, observations: 300 },
    { bucket: '51-75', rate: 0, low: 0, high: 0, observations: 0 },
    { bucket: 'unknown', rate: 0.5, low: 0.1, high: 0.9, observations: 2 },
  ]
  const { points, maxRate } = rateLinePoints(rows, { width: 100, height: 100, padX: 10, padY: 10 })
  assert.ok(Math.abs(maxRate - 0.0375) < 1e-12, 'the highest rate plus headroom')
  assert.deepEqual(points.map((point) => point.bucket), ['1-25', '26-50'])
  assert.deepEqual(points.map((point) => point.x), [10, 90])
  assert.equal(points[1].y, 26)
  assert.equal(points[1].yHigh, 10, 'a range above the plot is clipped to its top')
  assert.deepEqual(rateLinePoints([]).points, [])
  assert.equal(rateLinePoints([rows[0]], { width: 100 }).points[0].x, 50)
})
