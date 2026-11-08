// The resource map's atlas of Azeroth, in the game's own geometry.
//
// Coordinates are "world" units: the game's Azeroth map, 1002 × 668. Every
// continent and zone is the rectangle the game draws its map in, taken from
// the client's UiMapAssignment table (Classic Era), so a recorded position
// (the game's normalised zone-map coordinate, 0–1 from the top left) lands
// exactly where it is in game, and the game's map art lines up when drawn
// into the same rectangles.
//
// Zone borders for the drawn atlas are the Voronoi cells of the zones'
// centres, clipped to each zone's rectangle: the game's rectangles overlap
// their neighbours, the cells do not.

export const WORLD = Object.freeze({ width: 1002, height: 668 })
const CELL_GROWTH = 1.06

// [uiMapID, name, continent, x, y, width, height, city?]
const CONTINENT_RECTS = [
  [1414, 'Kalimdor', 1414, -186.27, 45.21, 821.62, 547.8],
  [1415, 'Eastern Kingdoms', 1415, 372.23, 54.44, 789.25, 526.12],
]

export const CONTINENTS = Object.freeze(CONTINENT_RECTS.map(([mapId, name, , x, y, width, height]) => ({
  mapId,
  name,
  rect: { x, y, width, height },
  label: mapId === 1414 ? { x: 40, y: 622, anchor: 'start' } : { x: 968, y: 96, anchor: 'end' },
})))

const ZONES = [
  [1411, 'Durotar', 1414, 238.6, 290.64, 118.05, 78.71],
  [1412, 'Mulgore', 1414, 149.06, 337.11, 114.7, 76.48],
  [1413, 'The Barrens', 1414, 136.22, 295.01, 226.25, 150.86],
  [1416, 'Alterac Mountains', 1415, 713.41, 188.21, 62.78, 41.85],
  [1417, 'Arathi Highlands', 1415, 750.41, 224.83, 80.72, 53.81],
  [1418, 'Badlands', 1415, 777.59, 353.89, 55.77, 37.18],
  [1419, 'Blasted Lands', 1415, 758.82, 458.74, 75.11, 50.07],
  [1420, 'Tirisfal Glades', 1415, 662.96, 135.81, 101.32, 67.54],
  [1421, 'Silverpine Forest', 1415, 653.62, 184.48, 94.17, 62.78],
  [1422, 'Western Plaguelands', 1415, 721.63, 146.36, 96.41, 64.27],
  [1423, 'Eastern Plaguelands', 1415, 779.98, 136.65, 86.79, 57.87],
  [1424, 'Hillsbrad Foothills', 1415, 707.06, 212.87, 71.75, 47.83],
  [1425, 'The Hinterlands', 1415, 766.29, 188.96, 86.32, 57.54],
  [1426, 'Dun Morogh', 1415, 690.57, 308.77, 110.43, 73.61],
  [1427, 'Searing Gorge', 1415, 738.22, 358.6, 50.03, 33.35],
  [1428, 'Burning Steppes', 1415, 736.96, 379.48, 65.68, 43.77],
  [1429, 'Elwynn Forest', 1415, 696.55, 399.85, 77.82, 51.89],
  [1430, 'Deadwind Pass', 1415, 749.66, 443.05, 56.05, 37.37],
  [1431, 'Duskwood', 1415, 712.29, 439.69, 60.54, 40.36],
  [1432, 'Loch Modan', 1415, 775.68, 322.45, 61.85, 41.24],
  [1433, 'Redridge Mountains', 1415, 766.2, 414.09, 48.67, 32.46],
  [1434, 'Stranglethorn Vale', 1415, 681.18, 472.24, 143.08, 95.38],
  [1435, 'Swamp of Sorrows', 1415, 780.82, 437.54, 51.43, 34.28],
  [1436, 'Westfall', 1415, 663.34, 432.59, 78.48, 52.31],
  [1437, 'Wetlands', 1415, 739.71, 270.0, 92.72, 61.79],
  [1438, 'Teldrassil', 1414, 109.61, 66.84, 113.68, 75.78],
  [1439, 'Darkshore', 1414, 129.1, 144.94, 146.24, 97.5],
  [1440, 'Ashenvale', 1414, 156.82, 226.68, 128.75, 85.83],
  [1441, 'Thousand Needles', 1414, 204.45, 419.59, 98.24, 65.5],
  [1442, 'Stonetalon Mountains', 1414, 122.31, 265.89, 109.03, 72.71],
  [1443, 'Desolace', 1414, 100.26, 320.92, 100.38, 66.94],
  [1444, 'Feralas', 1414, 73.28, 383.86, 155.17, 103.46],
  [1445, 'Dustwallow Marsh', 1414, 216.55, 376.42, 117.22, 78.15],
  [1446, 'Tanaris', 1414, 199.66, 462.2, 154.06, 102.71],
  [1447, 'Azshara', 1414, 267.95, 211.74, 113.22, 75.5],
  [1448, 'Felwood', 1414, 158.13, 171.74, 128.38, 85.59],
  [1449, 'Un\'Goro Crater', 1414, 182.87, 464.25, 82.61, 55.08],
  [1450, 'Moonglade', 1414, 225.62, 141.41, 51.54, 34.38],
  [1451, 'Silithus', 1414, 138.12, 464.06, 77.77, 51.87],
  [1452, 'Winterspring', 1414, 201.85, 140.48, 158.52, 105.69],
  [1453, 'Stormwind City', 1415, 700.01, 407.45, 30.14, 20.1, true],
  [1454, 'Orgrimmar', 1414, 276.95, 280.24, 31.32, 20.89, true],
  [1455, 'Ironforge', 1415, 746.98, 324.28, 17.73, 11.83, true],
  [1456, 'Thunder Bluff', 1414, 183.24, 350.0, 23.3, 15.54, true],
  [1457, 'Darnassus', 1414, 129.17, 102.41, 23.63, 15.76, true],
  [1458, 'Undercity', 1415, 711.4, 179.74, 21.51, 14.35, true],
]

function round(value) {
  return Math.round(value * 100) / 100
}

// Sutherland–Hodgman: keep the part of `polygon` where f(point) <= 0.
function clip(polygon, f) {
  const out = []
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]
    const b = polygon[(index + 1) % polygon.length]
    const fa = f(a)
    const fb = f(b)
    if (fa <= 0) out.push(a)
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const t = fa / (fa - fb)
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  return out
}

function centroid(polygon) {
  let area = 0
  let x = 0
  let y = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]
    const b = polygon[(index + 1) % polygon.length]
    const cross = a.x * b.y - b.x * a.y
    area += cross
    x += (a.x + b.x) * cross
    y += (a.y + b.y) * cross
  }
  if (Math.abs(area) < 1e-9) return polygon[0] || { x: 0, y: 0 }
  return { x: x / (3 * area), y: y / (3 * area) }
}

export function pathFor(polygon) {
  if (!polygon.length) return ''
  return `M${polygon.map((point) => `${round(point.x)},${round(point.y)}`).join('L')}Z`
}

export function pointInPolygon(point, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]
    const b = polygon[j]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function buildAtlas() {
  const zones = ZONES.map(([mapId, name, continentId, x, y, width, height, city = false]) => ({
    mapId, name, continentId, city,
    site: { x: x + width / 2, y: y + height / 2 },
    rect: { x, y, width, height },
  }))

  for (const zone of zones) {
    // A zone's border may reach a little past its map rectangle, so
    // neighbours meet along their shared bisector rather than leaving sea
    // between them. Cities keep their exact rectangle.
    const grow = zone.city ? 1 : CELL_GROWTH
    const width = zone.rect.width * grow
    const height = zone.rect.height * grow
    const x = zone.site.x - width / 2
    const y = zone.site.y - height / 2
    let cell = [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
    if (!zone.city) {
      for (const other of zones) {
        if (other === zone || other.city || other.continentId !== zone.continentId) continue
        const nx = other.site.x - zone.site.x
        const ny = other.site.y - zone.site.y
        const mx = (other.site.x + zone.site.x) / 2
        const my = (other.site.y + zone.site.y) / 2
        cell = clip(cell, (point) => (point.x - mx) * nx + (point.y - my) * ny)
        if (!cell.length) break
      }
    }
    zone.cell = cell
    zone.path = pathFor(cell)
    zone.label = zone.city ? { x: zone.site.x, y: zone.rect.y + zone.rect.height + 4 } : centroid(cell)
  }

  const continents = CONTINENTS.map((continent) => {
    const members = zones.filter((zone) => zone.continentId === continent.mapId && !zone.city)
    const xs = members.flatMap((zone) => zone.cell.map((point) => point.x))
    const ys = members.flatMap((zone) => zone.cell.map((point) => point.y))
    const bounds = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
    return { ...continent, bounds, path: members.map((zone) => zone.path).join('') }
  })

  const byId = new Map(zones.map((zone) => [zone.mapId, zone]))
  const byName = new Map(zones.map((zone) => [zone.name.toLowerCase(), zone]))
  return Object.freeze({ zones, continents, byId, byName })
}

let atlas = null
export function getAtlas() {
  if (!atlas) atlas = buildAtlas()
  return atlas
}

// The atlas zone for a recorded map: by uiMapID, else by the zone's name.
export function atlasZone(mapId, zoneName = '') {
  const { byId, byName } = getAtlas()
  return byId.get(Number(mapId)) || byName.get(String(zoneName || '').trim().toLowerCase()) || null
}

// A zone-map position (0–1) to world units.
export function projectPoint(zone, x, y) {
  return { x: zone.rect.x + x * zone.rect.width, y: zone.rect.y + y * zone.rect.height }
}

// The zone under a world position, and the in-game map coordinate there.
// Cities win over the zone around them.
export function locateWorldPoint(point) {
  const { zones } = getAtlas()
  const city = zones.find((zone) => zone.city && point.x >= zone.rect.x && point.x <= zone.rect.x + zone.rect.width && point.y >= zone.rect.y && point.y <= zone.rect.y + zone.rect.height)
  const zone = city || zones.find((entry) => !entry.city && pointInPolygon(point, entry.cell))
  if (!zone) return null
  return {
    zone,
    x: (point.x - zone.rect.x) / zone.rect.width,
    y: (point.y - zone.rect.y) / zone.rect.height,
  }
}

// ------------------------------------------------------------------ Map art
// The game's own map art, when the site has it: one image per uiMapID at the
// 1002 × 668 the game draws (scripts/fetchMapArt.mjs). Azeroth is the world
// map; each zone is its fully explored map cut to its own land, so zones
// drawn in their rectangles join into one map. A template can point
// elsewhere (a CDN), like icons do.
const DEFAULT_ART_TEMPLATE = '/wow-art/maps/{uiMapId}.webp'

export function mapArtUrl(uiMapId) {
  const runtime = globalThis.__HOLDFAST_WOW_MAP_TEMPLATE__
  const build = import.meta.env?.VITE_WOW_MAP_TEMPLATE
  const template = (typeof runtime === 'string' && runtime) || (typeof build === 'string' && build) || DEFAULT_ART_TEMPLATE
  return template.replaceAll('{uiMapId}', String(uiMapId))
}

export const AZEROTH_MAP_ID = 947
export const AZEROTH_RECT = Object.freeze({ x: 0, y: 0, width: WORLD.width, height: WORLD.height })
