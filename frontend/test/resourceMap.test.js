import test from 'node:test'
import assert from 'node:assert/strict'

import { WORLD, atlasZone, getAtlas, locateWorldPoint, pointInPolygon, projectPoint } from '../src/Player/Map/atlas.js'
import {
  HOME_VIEW,
  MAX_ZOOM,
  busiestSpots,
  fitBounds,
  flightPath,
  formatCoords,
  interpolateView,
  layerWeights,
  legendGroups,
  mapUrl,
  panBy,
  placeLabels,
  placePoints,
  sourceColors,
  sourceSpots,
  sourceZones,
  toScreen,
  toWorld,
  viewAnchored,
  wayCommand,
  worldArtOpacity,
  zoneArtOpacity,
  zoneLabelOpacity,
  zoneTotals,
  zoomAt,
  zoomLevel,
} from '../src/Player/Map/mapModel.js'
import { frameFade, landMask } from '../scripts/fetchMapArt.mjs'

const size = { width: 1000, height: 720 }

test('the atlas places every zone on its continent with a 3:2 map and a border', () => {
  const { zones, continents } = getAtlas()
  assert.equal(continents.length, 2)
  assert.ok(zones.length >= 40)
  for (const zone of zones) {
    assert.ok(Math.abs(zone.rect.width / zone.rect.height - 1.5) < 0.005, `${zone.name} keeps the game's map shape`)
    assert.ok(zone.cell.length >= 3, `${zone.name} has a border`)
    const { rect } = continents.find((continent) => continent.mapId === zone.continentId)
    assert.ok(zone.site.x > rect.x && zone.site.x < rect.x + rect.width && zone.site.y > rect.y && zone.site.y < rect.y + rect.height, `${zone.name} sits on its continent's map`)
    assert.ok(zone.site.x > 0 && zone.site.x < WORLD.width && zone.site.y > 0 && zone.site.y < WORLD.height)
    if (!zone.city) assert.ok(pointInPolygon(zone.site, zone.cell), `${zone.name}'s own centre is inside its border`)
  }
  assert.equal(new Set(zones.map((zone) => zone.mapId)).size, zones.length, 'one entry per uiMapID')
})

test('zones are found by uiMapID or by name, and positions round-trip', () => {
  assert.equal(atlasZone(1436).name, 'Westfall')
  assert.equal(atlasZone(999999, 'westfall').mapId, 1436)
  assert.equal(atlasZone(999999, 'Gnomeregan'), null)
  const westfall = atlasZone(1436)
  const world = projectPoint(westfall, 0.5, 0.5)
  const located = locateWorldPoint(world)
  assert.equal(located.zone.mapId, 1436)
  assert.ok(Math.abs(located.x - 0.5) < 1e-9 && Math.abs(located.y - 0.5) < 1e-9)
  assert.equal(locateWorldPoint({ x: 5, y: 5 }), null, 'the open sea is no zone')
  const stormwind = atlasZone(1453)
  assert.equal(locateWorldPoint(projectPoint(stormwind, 0.5, 0.5)).zone.mapId, 1453, 'a city wins over the zone around it')
})

test('the camera zooms about the cursor, pans, clamps and frames bounds', () => {
  const anchor = { x: 300, y: 200 }
  const before = toWorld(HOME_VIEW, size, anchor)
  const zoomed = zoomAt(HOME_VIEW, size, 3, anchor)
  const after = toWorld(zoomed, size, anchor)
  assert.ok(Math.abs(before.x - after.x) < 1e-6 && Math.abs(before.y - after.y) < 1e-6, 'the point under the cursor stays put')
  assert.equal(zoomAt(HOME_VIEW, size, 0.1).k, 1, 'never zooms out past the world')
  assert.equal(zoomAt(HOME_VIEW, size, 1e6).k, MAX_ZOOM)
  const panned = panBy(zoomed, size, 100, 0)
  assert.ok(panned.x < zoomed.x, 'dragging right moves the camera left')
  const screen = toScreen(zoomed, size, before)
  assert.ok(Math.abs(screen.x - anchor.x) < 1e-6)
  const rect = atlasZone(1429).rect
  const framed = fitBounds(rect, size, 0.9)
  assert.equal(zoomLevel(framed.k), 'zone', 'framing a zone reaches zone detail')
  assert.equal(zoomLevel(1), 'world')
  assert.equal(zoomLevel(3), 'region')
  const middle = interpolateView({ x: 0, y: 0, k: 1 }, { x: 100, y: 100, k: 16 }, 0.5)
  assert.ok(Math.abs(middle.k - 4) < 1e-9, 'zoom flies in log space')
  assert.deepEqual(interpolateView(HOME_VIEW, framed, 1), framed)
})

test('map URL carries profession, sources and drop', () => {
  assert.equal(mapUrl(), '/api/intelligence/farming/map')
  assert.equal(mapUrl({ discipline: 'mining', sources: ['a', 'b'], item: 'item:2770' }), '/api/intelligence/farming/map?discipline=mining&source=a%2Cb&item=item%3A2770')
})

test('sources get distinct colours within their profession family', () => {
  const colors = sourceColors([
    { sourceKey: 'h1', discipline: 'herbalism', observations: 10 },
    { sourceKey: 'h2', discipline: 'herbalism', observations: 20 },
    { sourceKey: 'm1', discipline: 'mining', observations: 5 },
  ])
  assert.notEqual(colors.get('h1'), colors.get('h2'))
  assert.equal(colors.get('h2'), '#6fd38b', 'the busiest herb gets the herbalism colour')
  assert.equal(colors.get('m1'), '#e0a065')
})

const points = [
  { mapId: 1436, sourceKey: 'a', x: 0.5, y: 0.5, observations: 10 },
  { mapId: 1436, sourceKey: 'a', x: 0.505, y: 0.5, observations: 6 },
  { mapId: 1436, sourceKey: 'b', x: 0.2, y: 0.2, observations: 4 },
  { mapId: 1429, sourceKey: 'a', x: 0.3, y: 0.3, observations: 3 },
  { mapId: 9999, sourceKey: 'a', x: 0.3, y: 0.3, observations: 7 },
  { mapId: 8888, sourceKey: 'b', x: 0.1, y: 0.1, observations: 2 },
]
const zones = [{ mapId: 8888, zone: 'Duskwood' }]

test('points are placed by map or zone name, and the rest counted', () => {
  const { placed, unplaced } = placePoints(points, zones)
  assert.equal(placed.length, 5)
  assert.equal(unplaced, 7)
  assert.equal(placed.find((point) => point.mapId === 8888).zone.name, 'Duskwood', 'an unknown map id falls back to its zone name')
  assert.equal(placePoints(points, zones, new Set(['b'])).placed.length, 2, 'hidden sources are left out')
})

test('zone totals and busiest spots merge nearby cells of one source', () => {
  const { placed } = placePoints(points, zones)
  const totals = zoneTotals(placed)
  assert.equal(totals[0].zone.name, 'Westfall')
  assert.equal(totals[0].observations, 20)
  assert.equal(totals[0].topSource, 'a')
  const spots = busiestSpots(placed, 1436)
  assert.equal(spots.length, 2)
  assert.equal(spots[0].observations, 16, 'neighbouring cells become one spot')
  assert.ok(spots[0].x > 0.5 && spots[0].x < 0.505, 'weighted to where most gathers were')
  assert.equal(formatCoords(spots[0].x, spots[0].y), '50.2, 50.0')
  assert.equal(formatCoords(-1, 2), '0.0, 100.0')
})

test('legend groups sources by profession and filters by name or drop', () => {
  const sources = [
    { sourceKey: 'a', name: 'Peacebloom', discipline: 'herbalism', observations: 10, icon: { name: 'Peacebloom' } },
    { sourceKey: 'b', name: 'Copper Vein', discipline: 'mining', observations: 30, icon: { name: 'Copper Ore' } },
    { sourceKey: 'c', name: 'Silverleaf', discipline: 'herbalism', observations: 5 },
  ]
  const groups = legendGroups(sources)
  assert.deepEqual(groups.map((group) => group.discipline), ['mining', 'herbalism'])
  assert.equal(groups[1].observations, 15)
  assert.deepEqual(legendGroups(sources, 'ore').map((group) => group.sources[0].name), ['Copper Vein'])
  assert.equal(legendGroups(sources, 'zzz').length, 0)
})

test('flights land exactly where they aim, and long ones rise above the map on the way', () => {
  const from = fitBounds(atlasZone(1429).rect, size, 0.9)
  const to = fitBounds(atlasZone(1411).rect, size, 0.9)
  const path = flightPath(from, to, size)
  assert.deepEqual(path.at(0), from)
  assert.deepEqual(path.at(1), to)
  assert.ok(path.at(0.5).k < Math.min(from.k, to.k) / 2, 'crossing the sea zooms out first')
  assert.ok(path.duration >= 320 && path.duration <= 1500)
  const near = flightPath(HOME_VIEW, { ...HOME_VIEW, k: 4 }, size)
  assert.ok(Math.abs(near.at(1).k - 4) < 1e-9)
  for (let t = 0; t <= 1; t += 0.1) assert.ok(Number.isFinite(near.at(t).k), 'a straight zoom has no gaps')
})

test('an animated zoom keeps the point under the cursor still at every step', () => {
  const anchor = { x: 720, y: 180 }
  const world = toWorld(HOME_VIEW, size, anchor)
  for (const k of [1.4, 3, 9]) {
    const screen = toScreen(viewAnchored(world, anchor, k, size), size, world)
    assert.ok(Math.abs(screen.x - anchor.x) < 1e-6 && Math.abs(screen.y - anchor.y) < 1e-6)
  }
  assert.equal(viewAnchored(world, anchor, 1e6, size).k, MAX_ZOOM)
})

test('what the map draws fades with zoom instead of switching', () => {
  assert.equal(zoneArtOpacity(1), 0, 'the world shows the world map')
  assert.equal(zoneArtOpacity(3), 1, 'regions show every zone map')
  assert.equal(worldArtOpacity(1), 1)
  assert.equal(worldArtOpacity(6), 0, 'up close only the zones are drawn')
  const ks = [1, 1.5, 2, 2.5, 3, 5, 8, 12, 20]
  for (let index = 1; index < ks.length; index += 1) {
    const [a, b] = [layerWeights(ks[index - 1]), layerWeights(ks[index])]
    assert.ok(b.bubbles <= a.bubbles && b.dots >= a.dots && b.markers >= a.markers, `monotonic from ×${ks[index - 1]} to ×${ks[index]}`)
    assert.ok(Math.abs(b.bubbles - a.bubbles) < 0.75, 'no layer jumps at once')
  }
  assert.equal(layerWeights(1, 'spots').dots, 1, 'spots show at any zoom when asked for')
  assert.equal(layerWeights(1, 'spots').heat, 0)
  const elwynn = atlasZone(1429)
  assert.equal(zoneLabelOpacity(elwynn, 0.5, 1), 0, 'too small to name')
  assert.equal(zoneLabelOpacity(elwynn, 2, 2), 1)
  assert.equal(zoneLabelOpacity(elwynn, 20, 18), 0, 'its own map names it up close')
})

test('overlapping zone labels give way to the bigger zone', () => {
  const at = { x: 100, y: 100 }
  const kept = placeLabels([
    { zone: atlasZone(1430), at, opacity: 1 },
    { zone: atlasZone(1434), at: { x: 104, y: 102 }, opacity: 1 },
    { zone: atlasZone(1436), at: { x: 400, y: 100 }, opacity: 1 },
  ])
  assert.deepEqual(kept.map((entry) => entry.zone.name).sort(), ['Stranglethorn Vale', 'Westfall'])
})

test('a resource is summed by zone and its best spots span every zone', () => {
  const { placed } = placePoints(points, zones)
  assert.deepEqual(sourceZones(placed, 'a').map((entry) => [entry.zone.name, entry.observations]), [['Westfall', 16], ['Elwynn Forest', 3]])
  const spots = sourceSpots(placed, 'a', { limit: 5 })
  assert.deepEqual(spots.map((spot) => spot.zone.name), ['Westfall', 'Elwynn Forest'])
  assert.equal(spots[0].observations, 16)
  assert.equal(wayCommand(atlasZone(1436), 0.4567, 0.123), '/way Westfall 45.7 12.3')
})

test('map art: a zone is cut to its explored land, gaps closed and edges feathered', () => {
  const width = 120
  const height = 80
  const coverage = new Uint8Array(width * height)
  const paint = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) coverage[y * width + x] = 255
  }
  // Two explored areas with a narrow gap, one with a hole in it.
  paint(20, 20, 50, 60)
  paint(56, 20, 90, 60)
  coverage[40 * width + 70] = 0
  const alpha = landMask(coverage, width, height, { close: 6, grow: 2, feather: 4, frame: 2 })
  assert.equal(alpha[40 * width + 30], 255, 'explored land is opaque')
  assert.equal(alpha[40 * width + 53], 255, 'the gap between areas closes')
  assert.equal(alpha[40 * width + 70], 255, 'holes fill')
  assert.equal(alpha[40 * width + 110], 0, 'far from the land is clear')
  const edge = alpha[40 * width + 93]
  assert.ok(edge > 0 && edge < 255, 'the edge feathers')
  const fade = frameFade(200, 140, { inset: 10, feather: 20, corner: 30 })
  assert.equal(fade[0], 0, 'the frame fades out')
  assert.equal(fade[70 * 200 + 100], 255, 'the middle stays')
  assert.ok(fade[12 * 200 + 12] < fade[12 * 200 + 100], 'corners fade further than edges')
})
