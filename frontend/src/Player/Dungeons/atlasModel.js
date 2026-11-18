// The Dungeon Atlas's pure logic: URL state, the explore filters, what a
// card says, boss abilities, loot rows, entrance markers and the modal's
// focus trap. Every `atlas` field is optional: a dungeon the catalog knows
// only from loot still gets a card, a modal and a loot list.

export const ATLAS_SECTIONS = Object.freeze([
  ['overview', 'Overview'],
  ['bosses', 'Bosses'],
  ['loot', 'Loot'],
  ['quests', 'Quests'],
  ['runs', 'My runs'],
])

export const ABILITY_CATEGORIES = Object.freeze([
  ['interrupt', 'Interrupts'],
  ['tank-danger', 'Tank danger'],
  ['healer-danger', 'Healer danger'],
  ['positioning', 'Positioning'],
  ['dispel', 'Dispels'],
  ['crowd-control', 'Crowd control'],
  ['special-mechanic', 'Special mechanics'],
])

export const PROVENANCE_TIERS = Object.freeze({
  'official-client': { label: 'Game client', tone: 'ok' },
  'forever-reference': { label: 'Forever reference', tone: 'ok' },
  'classic-reference': { label: 'Classic reference', tone: 'quiet' },
  'community-unverified': { label: 'Community, unverified', tone: 'warn' },
})

export const EXPLORE_FILTER_KEYS = Object.freeze(['find', 'zone', 'kind', 'lootSlot', 'wish', 'fit', 'lmin', 'lmax'])
const VIEWS = ['explore', 'runs', 'loot']
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 }

function int(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function finite(value) {
  const number = Number(value)
  return value !== null && value !== undefined && value !== '' && Number.isFinite(number) ? number : null
}

// The Dungeons page's tab. A link with run filters or an open run (made
// before the tabs existed) still lands on My runs.
export function dungeonsView(queryString = '') {
  const params = new URLSearchParams(queryString)
  const view = params.get('view')
  if (VIEWS.includes(view)) return view
  if (params.get('run') || ['realm', 'status', 'from', 'to'].some((key) => params.get(key))) return 'runs'
  return 'explore'
}

// The explore filters and the open dungeon (?open=36&section=bosses&boss=…).
export function readAtlasQuery(queryString = '') {
  const params = new URLSearchParams(queryString)
  const section = params.get('section')
  return {
    character: params.get('character') || '',
    open: int(params.get('open')),
    section: ATLAS_SECTIONS.some(([id]) => id === section) ? section : 'overview',
    boss: params.get('boss') || '',
    filters: Object.fromEntries(EXPLORE_FILTER_KEYS.map((key) => [key, params.get(key) || ''])),
  }
}

export function exploreHref({ server = '', character = '', filters = {}, open = null, section = '', boss = '' } = {}) {
  const params = new URLSearchParams()
  if (server) params.set('server', server)
  if (character) params.set('character', character)
  for (const key of EXPLORE_FILTER_KEYS) if (filters[key]) params.set(key, filters[key])
  if (open) params.set('open', String(open))
  if (open && section && section !== 'overview') params.set('section', section)
  if (open && boss) params.set('boss', String(boss))
  const query = params.toString()
  return `/dashboard/dungeons${query ? `?${query}` : ''}`
}

// The current URL with a dungeon opened (or closed, open = null). Every
// other param (server, character, view, filters) is kept, so the modal can
// open over any tab or the world map and close back to it.
export function withAtlasOpen(href, { open = null, section = '', boss = '' } = {}) {
  const url = new URL(href, 'https://guildweaver.local')
  for (const key of ['open', 'section', 'boss']) url.searchParams.delete(key)
  if (open) {
    url.searchParams.set('open', String(open))
    if (section && section !== 'overview') url.searchParams.set('section', section)
    if (boss) url.searchParams.set('boss', String(boss))
  }
  return `${url.pathname}${url.search}${url.hash}`
}

// The world map centred on a dungeon's entrance, with the layer on and the
// dungeon open.
export function worldMapHref(dungeon = {}) {
  const atlas = normalizeAtlas(dungeon.atlas)
  const params = new URLSearchParams()
  const mapId = atlas.entrance?.mapId || atlas.zoneMapId
  if (mapId) params.set('zone', String(mapId))
  params.set('dungeons', '1')
  return `/map?${params.toString()}`
}

function entrance(value) {
  if (!value || typeof value !== 'object') return null
  const mapId = int(value.mapId)
  const x = finite(value.x)
  const y = finite(value.y)
  return mapId && x !== null && y !== null ? { mapId, x, y } : null
}

// Every atlas field with a safe default, whatever (or nothing) arrived.
// Catalog dungeons (those with recorded loot) plus atlas-only dungeons the
// backend knows about but has no loot for yet, so Explore and the world map
// show every known dungeon. Catalog entries win on duplicate instance ids.
export function listWithAtlasDungeons(data) {
  const catalog = Array.isArray(data?.dungeons) ? data.dungeons : []
  const extra = Array.isArray(data?.atlasDungeons) ? data.atlasDungeons : []
  const have = new Set(catalog.map((entry) => entry.instanceId))
  return [...catalog, ...extra.filter((entry) => entry && !have.has(entry.instanceId))]
}

export function normalizeAtlas(atlas) {
  const source = atlas && typeof atlas === 'object' ? atlas : {}
  const list = (value) => (Array.isArray(value) ? value : [])
  return {
    known: Boolean(atlas && typeof atlas === 'object'),
    levelMin: finite(source.levelMin),
    levelMax: finite(source.levelMax),
    recommendedLevel: finite(source.recommendedLevel),
    zoneName: source.zoneName || '',
    zoneMapId: int(source.zoneMapId),
    entrance: entrance(source.entrance),
    artworkUrl: source.artworkUrl || '',
    bossCount: finite(source.bossCount),
    rareCount: finite(source.rareCount),
    questCount: finite(source.questCount),
    kind: source.kind === 'raid' ? 'raid' : source.kind === 'dungeon' ? 'dungeon' : null,
    lootSlots: list(source.lootSlots),
    description: source.description || '',
    maps: list(source.maps).filter((map) => map && map.imageUrl),
    bosses: list(source.bosses),
    creatures: list(source.creatures),
    rares: list(source.rares),
    quests: list(source.quests),
    provenance: list(source.provenance),
  }
}

// The dungeon's kind: the atlas's, else the catalog's instance type.
export function dungeonKind(dungeon = {}) {
  const atlas = normalizeAtlas(dungeon.atlas)
  if (atlas.kind) return atlas.kind
  const type = String(dungeon.type || dungeon.instance?.type || '').toLowerCase()
  return type === 'raid' ? 'raid' : type === 'party' || type === 'dungeon' ? 'dungeon' : null
}

export function levelText(atlas = {}) {
  const { levelMin, levelMax } = normalizeAtlas(atlas)
  if (levelMin && levelMax) return levelMin === levelMax ? `Level ${levelMin}` : `Levels ${levelMin}–${levelMax}`
  if (levelMin) return `Level ${levelMin}+`
  if (levelMax) return `Up to level ${levelMax}`
  return ''
}

// How a character's level fits a dungeon: 'fit', 'under' (too low),
// 'over' (outlevelled) or null when either level is unknown.
export function levelFit(atlasInput, character) {
  const atlas = normalizeAtlas(atlasInput)
  const level = finite(character?.level)
  if (!level) return null
  const low = atlas.levelMin ?? (atlas.recommendedLevel ? atlas.recommendedLevel - 3 : null)
  const high = atlas.levelMax ?? (atlas.recommendedLevel ? atlas.recommendedLevel + 3 : null)
  if (low === null && high === null) return null
  if (low !== null && level < low - 1) return 'under'
  if (high !== null && level > high + 1) return 'over'
  return 'fit'
}

export const FIT_COPY = Object.freeze({
  fit: { label: 'Good for', tone: 'ok' },
  under: { label: 'Too high for', tone: 'warn' },
  over: { label: 'Outlevelled by', tone: 'quiet' },
})

// instanceId → wanted wishlist items known to drop there.
export function wishlistCounts(items = []) {
  const counts = new Map()
  for (const entry of items) {
    if (entry.state === 'acquired') continue
    const seen = new Set()
    for (const source of entry.sources || []) {
      const id = int(source.instanceId)
      if (!id || seen.has(id)) continue
      seen.add(id)
      counts.set(id, (counts.get(id) || 0) + 1)
    }
  }
  return counts
}

// What one card says, from a list entry with or without an atlas.
export function cardModel(dungeon = {}, { character = null, wishCounts = new Map() } = {}) {
  const atlas = normalizeAtlas(dungeon.atlas)
  const fit = levelFit(atlas, character)
  return {
    id: dungeon.instanceId,
    name: dungeon.name || `Instance ${dungeon.instanceId}`,
    artworkUrl: atlas.artworkUrl,
    levels: levelText(atlas),
    zone: atlas.zoneName,
    kind: dungeonKind(dungeon),
    bossCount: atlas.bossCount ?? (atlas.bosses.length || null),
    questCount: atlas.questCount,
    itemCount: Number(dungeon.itemCount) || 0,
    wishlistDrops: wishCounts.get(dungeon.instanceId) || 0,
    fit,
    hasEntrance: Boolean(atlas.entrance),
  }
}

// Dungeons passing the explore filters, the best fits first.
export function filterDungeons(dungeons = [], filters = {}, { character = null, wishCounts = new Map() } = {}) {
  const find = String(filters.find || '').trim().toLowerCase()
  const lmin = finite(filters.lmin)
  const lmax = finite(filters.lmax)
  return dungeons.filter((dungeon) => {
    const atlas = normalizeAtlas(dungeon.atlas)
    if (find && !`${dungeon.name || ''} ${atlas.zoneName}`.toLowerCase().includes(find)) return false
    if (filters.zone && atlas.zoneName !== filters.zone) return false
    if (filters.kind && dungeonKind(dungeon) !== filters.kind) return false
    if (filters.lootSlot && !atlas.lootSlots.includes(filters.lootSlot)) return false
    if (filters.wish && !(wishCounts.get(dungeon.instanceId) > 0)) return false
    if (filters.fit && levelFit(atlas, character) !== 'fit') return false
    // A level range keeps dungeons that overlap it; unknown levels drop out.
    if (lmin !== null || lmax !== null) {
      const low = atlas.levelMin ?? atlas.recommendedLevel
      const high = atlas.levelMax ?? atlas.recommendedLevel
      if (low === null && high === null) return false
      if (lmin !== null && (high ?? low) < lmin) return false
      if (lmax !== null && (low ?? high) > lmax) return false
    }
    return true
  }).sort((a, b) => {
    const fa = levelFit(a.atlas, character) === 'fit' ? 0 : 1
    const fb = levelFit(b.atlas, character) === 'fit' ? 0 : 1
    const la = normalizeAtlas(a.atlas).levelMin ?? 999
    const lb = normalizeAtlas(b.atlas).levelMin ?? 999
    return fa - fb || la - lb || String(a.name).localeCompare(String(b.name))
  })
}

// The choices each explore filter offers, from the dungeons listed. A
// filter with nothing to offer is hidden.
export function exploreOptions(dungeons = []) {
  const zones = new Set()
  const slots = new Set()
  const kinds = new Set()
  let levels = false
  for (const dungeon of dungeons) {
    const atlas = normalizeAtlas(dungeon.atlas)
    if (atlas.zoneName) zones.add(atlas.zoneName)
    for (const slot of atlas.lootSlots) slots.add(slot)
    const kind = dungeonKind(dungeon)
    if (kind) kinds.add(kind)
    if (atlas.levelMin || atlas.levelMax || atlas.recommendedLevel) levels = true
  }
  return { zones: [...zones].sort(), slots: [...slots].sort(), kinds: [...kinds].sort(), levels }
}

// The dungeons a character's level suits: the "all appropriate dungeons"
// scope of Plan My Gear.
export function appropriateDungeons(dungeons = [], character = null) {
  return dungeons.filter((dungeon) => levelFit(dungeon.atlas, character) === 'fit')
}

// Abilities in category order, the most important first in each.
export function groupAbilities(abilities = []) {
  const known = new Set(ABILITY_CATEGORIES.map(([id]) => id))
  const groups = new Map()
  for (const ability of abilities || []) {
    if (!ability) continue
    const category = known.has(ability.category) ? ability.category : 'special-mechanic'
    groups.set(category, [...(groups.get(category) || []), ability])
  }
  return ABILITY_CATEGORIES.filter(([id]) => groups.has(id)).map(([id, label]) => ({
    category: id,
    label,
    abilities: groups.get(id).slice().sort((a, b) => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3) || String(a.name).localeCompare(String(b.name))),
  }))
}

// "Classic reference — unverified for Forever" shows unless an ability
// says it was checked on Forever.
export function needsUnverifiedBadge(ability = {}) {
  return ability.verifiedForForever !== true
}

export function provenanceCopy(entry = {}) {
  return PROVENANCE_TIERS[entry.source] || { label: entry.source || 'Unknown source', tone: 'quiet' }
}

// A 0–1 map position, or null when it is not known (no marker drawn).
export function markerPosition(position) {
  if (!position || typeof position !== 'object') return null
  const x = finite(position.x)
  const y = finite(position.y)
  if (x === null || y === null || x < 0 || x > 1 || y < 0 || y > 1) return null
  return { left: `${(x * 100).toFixed(2)}%`, top: `${(y * 100).toFixed(2)}%` }
}

export function bossKey(boss = {}) {
  return String(boss.encounterId || boss.npcId || boss.name || '')
}

function normalizedName(value) {
  return String(value || '').trim().toLowerCase()
}

// Every catalog item of a dungeon, one row per item and source.
export function lootRows(detail = {}) {
  const rows = []
  for (const source of detail?.sources || []) {
    for (const item of source.items || []) rows.push({ item, source: source.name || null, sourceKey: source.key, boss: Boolean(source.boss) })
  }
  return rows
}

// A boss's loot: the catalog source with its name, plus any atlas item
// keys or item objects the boss lists that the catalog does not.
export function bossLoot(boss = {}, detail = {}) {
  const name = normalizedName(boss.name)
  const rows = lootRows(detail)
  const mine = rows.filter((row) => name && normalizedName(row.source) === name)
  const have = new Set(mine.map((row) => row.item.itemKey))
  const byKey = new Map(rows.map((row) => [row.item.itemKey, row]))
  for (const entry of boss.loot || []) {
    const key = typeof entry === 'string' ? entry : entry?.itemKey
    if (!key || have.has(key)) continue
    const row = byKey.get(key) || (typeof entry === 'object' ? { item: entry, source: boss.name, sourceKey: `boss:${name}`, boss: true } : null)
    if (row) {
      mine.push({ ...row, source: boss.name })
      have.add(key)
    }
  }
  return mine
}

// The request one Want / Wanted click sends: the existing wishlist PUT
// (with where it drops) or DELETE.
export function wishlistToggleRequest(characterId, item, wanted, instance = null) {
  const path = `/api/player/wishlists/${encodeURIComponent(characterId)}/items/${item.itemKey}`
  if (wanted) return { path, method: 'DELETE', body: undefined }
  return { path, method: 'PUT', body: instance?.instanceId ? { sourceDungeon: instance.name, sourceInstanceId: instance.instanceId } : {} }
}

// Plan My Gear's scope as the instance ids the planning prompt takes
// (?dungeons=36,48; the server keeps the first 40). [] = the whole catalog.
export function planScope(scope, { dungeon = null, dungeons = [], character = null } = {}) {
  if (scope === 'dungeon' && dungeon) return [dungeon.instanceId]
  if (scope === 'appropriate') return appropriateDungeons(dungeons, character).map((entry) => entry.instanceId).slice(0, 40)
  return []
}

// World map markers: only dungeons whose entrance is known and whose zone
// the atlas can place.
export function entranceMarkers(dungeons = [], locateZone) {
  const markers = []
  for (const dungeon of dungeons) {
    const atlas = normalizeAtlas(dungeon.atlas)
    if (!atlas.entrance) continue
    const zone = locateZone(atlas.entrance.mapId)
    if (!zone?.rect) continue
    markers.push({
      key: `dungeon:${dungeon.instanceId}`,
      instanceId: dungeon.instanceId,
      label: dungeon.name,
      kind: dungeonKind(dungeon),
      world: { x: zone.rect.x + atlas.entrance.x * zone.rect.width, y: zone.rect.y + atlas.entrance.y * zone.rect.height },
    })
  }
  return markers
}

// Where Tab moves inside the modal: wraps from the last control to the
// first (and back with Shift), and pulls focus in from outside. null =
// let the browser move it.
export function trapFocusIndex(count, current, shift) {
  if (!count) return -1
  if (current < 0) return shift ? count - 1 : 0
  if (shift && current === 0) return count - 1
  if (!shift && current === count - 1) return 0
  return null
}
