// The Dungeon Atlas's pure logic: URL state, the explore filters, what a
// card says, boss abilities, loot rows, entrance markers and the modal's
// focus trap. Every `atlas` field is optional: a dungeon the catalog knows
// only from loot still gets a card, a modal and a loot list.

export const ATLAS_SECTIONS = Object.freeze([
  ['overview', 'Overview'],
  ['prepare', 'Prepare'],
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

// Shown on anything derived from Classic reference data.
export const UNVERIFIED_LABEL = 'Classic reference — not verified for Forever'

export const PROVENANCE_TIERS = Object.freeze({
  'official-client': { label: 'Game client', tone: 'ok' },
  'forever-reference': { label: 'Forever reference', tone: 'ok' },
  'classic-reference': { label: 'Classic reference', tone: 'quiet' },
  'community-unverified': { label: 'Community, unverified', tone: 'warn' },
})

export const EXPLORE_FILTER_KEYS = Object.freeze(['find', 'zone', 'kind', 'lootSlot', 'wish', 'fit', 'rec', 'lmin', 'lmax'])
const VIEWS = ['explore', 'runs', 'loot']
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 }

function int(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

// A wing's dungeon key: "scarlet-monastery:library".
const WING_KEY = /^[a-z0-9-]{1,80}:[a-z0-9-]{1,40}$/

// The open dungeon in a URL: the game's instance ID (a number, as links
// have always had it), or a wing's key.
export function openId(value) {
  const text = String(value ?? '').trim().toLowerCase()
  return WING_KEY.test(text) ? text : int(text)
}

export function isWingEntry(dungeon) {
  return Boolean(dungeon && typeof dungeon.dungeonKey === 'string' && WING_KEY.test(dungeon.dungeonKey))
}

// A list entry's identity in links and lookups: a wing's key, else the
// game's instance ID. Every wing of a dungeon shares one instance ID.
export function entryKey(dungeon) {
  return isWingEntry(dungeon) ? dungeon.dungeonKey : int(dungeon?.instanceId)
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
    open: openId(params.get('open')),
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

// The current URL with another character chosen; everything else is kept.
export function withCharacter(href, character = '') {
  const url = new URL(href, 'https://guildweaver.local')
  if (character) url.searchParams.set('character', character)
  else url.searchParams.delete('character')
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
// What a failed atlas request answered, for its error message: the HTTP
// status and the server's error code (" (HTTP 500, loot_dungeons_unavailable)"),
// or "" when nothing is known.
export function loadFailureDetail(error) {
  const status = Number(error?.status) || 0
  const code = typeof error?.code === 'string' && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : ''
  const parts = [status ? `HTTP ${status}` : (error ? 'network error' : ''), code].filter(Boolean)
  return parts.length ? ` (${parts.join(', ')})` : ''
}

// The explorer's entries: the catalog's dungeons and the atlas-only ones,
// with a dungeon played as wings (atlasWings) listed once per wing instead.
// The dungeon itself stays reachable by its instance ID (old links).
export function listWithAtlasDungeons(data) {
  const catalog = Array.isArray(data?.dungeons) ? data.dungeons : []
  const extra = Array.isArray(data?.atlasDungeons) ? data.atlasDungeons : []
  const wings = (Array.isArray(data?.atlasWings) ? data.atlasWings : []).filter(isWingEntry)
  const have = new Set(catalog.map((entry) => entry.instanceId))
  const dungeons = [...catalog, ...extra.filter((entry) => entry && !have.has(entry.instanceId))]
  if (!wings.length) return dungeons
  const winged = new Set(wings.map((entry) => int(entry.instanceId)))
  const out = []
  const placed = new Set()
  for (const dungeon of dungeons) {
    const id = int(dungeon.instanceId)
    if (!winged.has(id)) { out.push(dungeon); continue }
    if (placed.has(id)) continue
    placed.add(id)
    for (const wing of wings) if (int(wing.instanceId) === id) out.push(wing)
  }
  for (const wing of wings) if (!placed.has(int(wing.instanceId))) out.push(wing)
  return out
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
    // Sprint 2 (optional): Classic reference loot, matched without details.
    referenceLootCount: finite(source.referenceLootCount),
    referenceItemIds: list(source.referenceItemIds).map(int).filter(Boolean),
    referenceSlots: list(source.referenceSlots),
    dungeonLoot: list(source.dungeonLoot),
    referenceVersion: source.referenceVersion && typeof source.referenceVersion === 'object' ? source.referenceVersion : null,
    description: source.description || '',
    // A map is either art (imageUrl) or a spawn layout the site draws (points).
    maps: list(source.maps).filter((map) => map && (map.imageUrl || (Array.isArray(map.points) && map.points.length))),
    bosses: list(source.bosses),
    creatures: list(source.creatures),
    rares: list(source.rares),
    quests: list(source.quests),
    provenance: list(source.provenance),
    // Wings (see docs/dungeon-atlas-contract.md): a dungeon lists its wings;
    // a wing says its floors, what it shares and what no wing owns.
    dungeonKey: typeof source.dungeonKey === 'string' ? source.dungeonKey : '',
    wingEntries: list(source.wingEntries).filter(isWingEntry),
    wing: typeof source.wing === 'string' ? source.wing : '',
    floors: list(source.floors).filter((floor) => floor && floor.name),
    unassigned: { bosses: list(source.unassigned?.bosses), rares: list(source.unassigned?.rares) },
    levelSource: source.levelSource || '',
    // WoW Forever's own dungeons: origin, what is known, listed drops
    // whose item details are unknown (by id).
    origin: source.origin === 'forever' ? 'forever' : 'classic',
    coverage: source.coverage && typeof source.coverage === 'object' ? source.coverage : null,
    floorNames: list(source.floorNames).filter((name) => typeof name === 'string'),
    unresolvedLoot: list(source.unresolvedLoot).filter((entry) => entry && Number.isSafeInteger(entry.itemId)),
    entrancesShared: source.entrancesShared === true,
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
    id: entryKey(dungeon),
    wing: isWingEntry(dungeon) ? dungeon.wing || '' : '',
    name: dungeon.name || `Instance ${dungeon.instanceId}`,
    artworkUrl: atlas.artworkUrl,
    levels: levelText(atlas),
    zone: atlas.zoneName,
    kind: dungeonKind(dungeon),
    bossCount: atlas.bossCount ?? (atlas.bosses.length || null),
    questCount: atlas.questCount,
    itemCount: Number(dungeon.itemCount) || 0,
    referenceLootCount: atlas.referenceLootCount,
    wishlistDrops: wishCounts.get(entryKey(dungeon)) || 0,
    fit,
    hasEntrance: Boolean(atlas.entrance),
  }
}

// Dungeons passing the explore filters, the best fits first.
export function filterDungeons(dungeons = [], filters = {}, { character = null, wishCounts = new Map(), recommendations = null } = {}) {
  const find = String(filters.find || '').trim().toLowerCase()
  const lmin = finite(filters.lmin)
  const lmax = finite(filters.lmax)
  return dungeons.filter((dungeon) => {
    const atlas = normalizeAtlas(dungeon.atlas)
    if (find && !`${dungeon.name || ''} ${atlas.zoneName}`.toLowerCase().includes(find)) return false
    if (filters.zone && atlas.zoneName !== filters.zone) return false
    if (filters.kind && dungeonKind(dungeon) !== filters.kind) return false
    if (filters.lootSlot && !atlas.lootSlots.includes(filters.lootSlot) && !atlas.referenceSlots.includes(filters.lootSlot)) return false
    if (filters.wish && !(wishCounts.get(entryKey(dungeon)) > 0)) return false
    if (filters.fit && levelFit(atlas, character) !== 'fit') return false
    if (filters.rec && !recommendations?.get(entryKey(dungeon))?.recommended) return false
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
    // "Recommended" lists the strongest reasons first.
    if (filters.rec && recommendations) {
      const ra = recommendations.get(entryKey(a))?.score || 0
      const rb = recommendations.get(entryKey(b))?.score || 0
      if (ra !== rb) return rb - ra
    }
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
    for (const slot of [...atlas.lootSlots, ...atlas.referenceSlots]) slots.add(slot)
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

// An observed catalog item with the reference facts it lacks filled in.
// When an item is both, the observed facts win.
function mergeItem(observed, reference) {
  const merged = { ...observed }
  for (const [key, value] of Object.entries(reference || {})) {
    if (merged[key] === null || merged[key] === undefined || (Array.isArray(merged[key]) && !merged[key].length && Array.isArray(value) && value.length)) merged[key] = value
  }
  return merged
}

function referenceItem(entry) {
  if (!entry || typeof entry !== 'object') return null
  const itemId = int(entry.itemId) || int(String(entry.itemKey || '').replace(/^i:/, ''))
  if (!itemId) return null
  return { ...entry, itemId, itemKey: entry.itemKey || `i:${itemId}` }
}

// A boss's loot: the catalog source with its name, plus any atlas item
// keys or item objects the boss lists that the catalog does not, plus its
// Classic reference loot (`referenceLoot`, sprint 2). Each row says
// whether it was observed (Guildweaver telemetry) and/or is reference.
export function bossLoot(boss = {}, detail = {}) {
  const name = normalizedName(boss.name)
  const rows = lootRows(detail)
  const mine = rows.filter((row) => name && normalizedName(row.source) === name).map((row) => ({ ...row, observed: true, reference: false }))
  const have = new Set(mine.map((row) => row.item.itemKey))
  const byKey = new Map(rows.map((row) => [row.item.itemKey, row]))
  for (const entry of boss.loot || []) {
    const key = typeof entry === 'string' ? entry : entry?.itemKey
    if (!key || have.has(key)) continue
    const row = byKey.get(key) || (typeof entry === 'object' ? { item: entry, source: boss.name, sourceKey: `boss:${name}`, boss: true } : null)
    if (row) {
      mine.push({ ...row, source: boss.name, observed: true, reference: false })
      have.add(key)
    }
  }
  for (const raw of Array.isArray(boss.referenceLoot) ? boss.referenceLoot : []) {
    const ref = referenceItem(raw)
    if (!ref) continue
    const index = mine.findIndex((row) => row.item.itemKey === ref.itemKey)
    if (index >= 0) {
      mine[index] = { ...mine[index], item: mergeItem(mine[index].item, ref), reference: true }
      continue
    }
    const observedRow = byKey.get(ref.itemKey)
    mine.push(observedRow
      ? { ...observedRow, item: mergeItem(observedRow.item, ref), source: boss.name, observed: true, reference: true }
      : { item: ref, source: boss.name, sourceKey: `boss:${name}`, boss: true, observed: ref.observed === true, reference: true })
    have.add(ref.itemKey)
  }
  return mine.map((row) => ({ ...row, bossKey: bossKey(boss), sourceKind: 'boss' }))
}

// Every item the dungeon is known to give, one row per item: boss loot
// (observed and reference), rares, trash and shared drops, quest
// rewards, then any observed loot not tied to a boss. The first source
// listed wins for an item seen twice.
// Where a shared (trash or chest) drop comes from: the one creature or chest,
// else the ones the reference names (up to three), else "trash and shared".
export function sharedSourceLabel(raw = {}) {
  if (raw?.sourceName) return raw.sourceName
  const names = [...new Set((Array.isArray(raw?.sources) ? raw.sources : []).map((source) => source?.name).filter(Boolean))]
  if (!names.length) return 'Trash and shared drops'
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ')
}

export function dungeonItems(detail = {}, atlasInput = null) {
  const atlas = normalizeAtlas(atlasInput ?? detail?.atlas)
  const rows = []
  const seen = new Set()
  const add = (row) => {
    if (!row?.item?.itemKey || seen.has(row.item.itemKey)) return
    seen.add(row.item.itemKey)
    rows.push(row)
  }
  for (const boss of atlas.bosses) for (const row of bossLoot(boss, detail)) add(row)
  const observed = new Map(lootRows(detail).map((row) => [row.item.itemKey, row]))
  const fromReference = (raw, source, sourceKind, extra = {}) => {
    const ref = referenceItem(raw)
    if (!ref) return
    const seenRow = observed.get(ref.itemKey)
    add(seenRow
      ? { ...seenRow, item: mergeItem(seenRow.item, ref), observed: true, reference: true, sourceKind, ...extra }
      : { item: ref, source, sourceKey: `${sourceKind}:${normalizedName(source)}`, boss: false, observed: ref.observed === true, reference: true, sourceKind, ...extra })
  }
  for (const rare of atlas.rares) for (const raw of rare.referenceLoot || []) fromReference(raw, rare.name ? `${rare.name} (rare)` : 'Rare spawn', 'rare')
  for (const raw of atlas.dungeonLoot) fromReference(raw, sharedSourceLabel(raw), 'trash')
  for (const quest of atlas.quests) {
    for (const raw of Array.isArray(quest?.rewards) ? quest.rewards : []) fromReference(raw, `Quest: ${quest.name || 'unnamed'}`, 'quest', { questId: quest.questId ?? null, choice: raw?.choice === true })
  }
  for (const row of lootRows(detail)) add({ ...row, observed: true, reference: false, sourceKind: row.boss ? 'boss' : 'other' })
  return rows
}

// Whether an item can be worn or wielded at all: the catalog's own flag,
// else a known equipment slot.
export function isEquippable(item = {}) {
  if (item.equippable === true) return true
  if (item.equippable === false) return false
  const slot = String(item.slot || '').trim()
  return Boolean(slot) && !/^(non-equippable|bag|quiver|ammo|ammunition)$/i.test(slot)
}

function classAllows(item, character) {
  if (!Array.isArray(item.classes) || !item.classes.length || !character?.className) return true
  const name = String(character.className).trim().toLowerCase()
  return item.classes.some((entry) => String(entry).trim().toLowerCase() === name)
}

// Classic (1.12) armour and weapon proficiencies: the types each class can
// ever train. Mail (hunters, shamans) and plate (warriors, paladins) need
// level 40. Not verified on Forever; an unknown class or type is allowed.
const ARMOR_TYPES = { cloth: 'cloth', leather: 'leather', mail: 'mail', plate: 'plate', shields: 'shield', shield: 'shield',
  librams: 'libram', idols: 'idol', totems: 'totem' }
const CLASS_ARMOR = {
  warrior: ['cloth', 'leather', 'mail', 'plate', 'shield'], paladin: ['cloth', 'leather', 'mail', 'plate', 'shield', 'libram'],
  hunter: ['cloth', 'leather', 'mail'], rogue: ['cloth', 'leather'], priest: ['cloth'], shaman: ['cloth', 'leather', 'mail', 'shield', 'totem'],
  mage: ['cloth'], warlock: ['cloth'], druid: ['cloth', 'leather', 'idol'],
}
const LATE_ARMOR = { hunter: 'mail', shaman: 'mail', warrior: 'plate', paladin: 'plate' }
const WEAPON_TYPES = ['one-handed axes', 'two-handed axes', 'one-handed maces', 'two-handed maces', 'one-handed swords', 'two-handed swords',
  'polearms', 'staves', 'daggers', 'fist weapons', 'bows', 'guns', 'crossbows', 'thrown', 'wands']
const CLASS_WEAPONS = {
  warrior: WEAPON_TYPES.filter((type) => type !== 'wands'),
  paladin: ['one-handed axes', 'two-handed axes', 'one-handed maces', 'two-handed maces', 'one-handed swords', 'two-handed swords', 'polearms'],
  hunter: ['one-handed axes', 'two-handed axes', 'one-handed swords', 'two-handed swords', 'polearms', 'staves', 'daggers', 'fist weapons',
    'bows', 'guns', 'crossbows', 'thrown'],
  rogue: ['one-handed maces', 'one-handed swords', 'daggers', 'fist weapons', 'bows', 'guns', 'crossbows', 'thrown'],
  priest: ['one-handed maces', 'staves', 'daggers', 'wands'],
  shaman: ['one-handed axes', 'two-handed axes', 'one-handed maces', 'two-handed maces', 'staves', 'daggers', 'fist weapons'],
  mage: ['one-handed swords', 'staves', 'daggers', 'wands'],
  warlock: ['one-handed swords', 'staves', 'daggers', 'wands'],
  druid: ['one-handed maces', 'two-handed maces', 'staves', 'daggers', 'fist weapons'],
}

export function proficiencyAllows(item = {}, character = null, horizon = null) {
  const cls = String(character?.className || '').trim().toLowerCase()
  if (!CLASS_ARMOR[cls]) return true
  const subclass = String(item.itemSubclass || '').trim().toLowerCase()
  const itemClass = String(item.itemClass || '').trim().toLowerCase()
  const armor = ARMOR_TYPES[subclass]
  if (armor && itemClass !== 'weapon') {
    if (!CLASS_ARMOR[cls].includes(armor)) return false
    // Mail or plate is trained at 40: only gear needed at or after it.
    if (LATE_ARMOR[cls] === armor) {
      return Math.max(finite(character?.level) || 0, finite(horizon) || 0) >= 40
    }
    return true
  }
  if (WEAPON_TYPES.includes(subclass)) return CLASS_WEAPONS[cls].includes(subclass)
  return true
}

// Gear a character can use from this dungeon: equippable, not restricted
// to another class, of an armour or weapon type the class can use (Classic
// proficiencies, proficiencyAllows), and a required level the character has
// or will reach within the dungeon's level range. Stats are never used to
// guess fit.
export function gearTargets(rows = [], character = null, atlasInput = null) {
  if (!character) return []
  const atlas = normalizeAtlas(atlasInput)
  const level = finite(character.level)
  const horizon = Math.max(level || 0, atlas.levelMax || 0) || null
  return rows.filter(({ item }) => {
    if (!isEquippable(item) || !classAllows(item, character) || !proficiencyAllows(item, character, horizon)) return false
    const required = finite(item.requiredLevel)
    return !(required && horizon && required > horizon)
  }).map((row) => {
    const required = finite(row.item.requiredLevel)
    return { ...row, usableNow: !(required && level && required > level), requiredLevel: required }
  }).sort((a, b) => (b.item.qualityId ?? -1) - (a.item.qualityId ?? -1) || (b.item.itemLevel ?? 0) - (a.item.itemLevel ?? 0) || String(a.item.name).localeCompare(String(b.item.name)))
}

const BIND_TEXT = {
  bop: 'Binds when picked up', boe: 'Binds when equipped', bou: 'Binds when used', quest: 'Quest item',
  1: 'Binds when picked up', 2: 'Binds when equipped', 3: 'Binds when used', 4: 'Quest item',
}

export function bindText(value) {
  if (value === null || value === undefined || value === '' || value === 0) return ''
  return BIND_TEXT[String(value).toLowerCase()] || (typeof value === 'string' ? value : '')
}

function weaponText(weapon) {
  if (!weapon || typeof weapon !== 'object') return ''
  const min = finite(weapon.minDamage)
  const max = finite(weapon.maxDamage)
  const speed = finite(weapon.speed)
  const dps = finite(weapon.dps)
  return [min !== null && max !== null ? `${min}–${max} damage` : '', speed ? `speed ${speed.toFixed(2)}` : '', dps ? `${dps.toFixed(1)} dps` : ''].filter(Boolean).join(', ')
}

// An item's facts as [label, value] lines, from whatever the record holds
// (catalog or reference). Unknown facts are left out, never guessed.
export function itemFacts(item = {}) {
  // Subclasses are the client's names ("One-Handed Swords", "Plate"):
  // armour gets "armor" after it, anything else is shown as is.
  const subclass = item.itemSubclass || ''
  const type = String(item.itemClass || '').toLowerCase() === 'armor' && subclass && !/^(miscellaneous|shields?)$/i.test(subclass)
    ? `${subclass} armor` : subclass || item.itemClass || ''
  const stats = Array.isArray(item.stats) ? item.stats.filter((line) => line?.stat && finite(line.value) !== null).map((line) => `${line.value > 0 ? '+' : ''}${line.value} ${line.stat}`).join(', ') : ''
  return [
    ['Slot', item.slot || ''],
    ['Type', type],
    ['Item level', finite(item.itemLevel) ?? ''],
    ['Requires level', finite(item.requiredLevel) ?? ''],
    ['Armor', finite(item.armor) ?? ''],
    ['Weapon', weaponText(item.weapon)],
    ['Stats', stats],
    ['Classes', Array.isArray(item.classes) && item.classes.length ? item.classes.join(', ') : ''],
    ['Binds', bindText(item.bindType)],
    ['Set', item.setName || ''],
  ].filter(([, value]) => value !== '' && value !== null && value !== undefined)
}

// The player's wishlist matched to dungeons: the item's known sources,
// plus the dungeon's reference item ids (list field, sprint 2). Acquired
// items are left out. instanceId → itemKey[].
// A wing's entries are keyed by its wing key (entryKey): a source names
// the wing when it is one of its bosses or rares, a sibling wing's boss is
// not this wing's, and a source naming no wing's boss (trash, chests, an
// unassigned boss) is shared by every wing.
export function wishlistTargets(items = [], dungeons = []) {
  const targets = new Map()
  const add = (id, key) => {
    if (!id || !key) return
    const list = targets.get(id) || []
    if (!list.includes(key)) list.push(key)
    targets.set(id, list)
  }
  const wanted = items.filter((entry) => entry && entry.state !== 'acquired')
  const wings = dungeons.filter(isWingEntry)
  const owns = (wing, source) => {
    const atlas = wing.atlas || {}
    const npcId = int(source.npcId)
    const name = normalizedName(source.bossName || source.source || source.sourceName)
    return Boolean((npcId && (atlas.bossNpcIds || []).includes(npcId)) || (name && (atlas.bossNames || []).some((boss) => normalizedName(boss) === name)))
  }
  for (const entry of wanted) {
    for (const source of entry.sources || []) {
      const id = int(source.instanceId)
      add(id, entry.itemKey)
      const siblings = wings.filter((wing) => int(wing.instanceId) === id)
      if (!siblings.length) continue
      const owner = siblings.find((wing) => owns(wing, source))
      for (const wing of owner ? [owner] : siblings) add(wing.dungeonKey, entry.itemKey)
    }
  }
  for (const dungeon of dungeons) {
    const ids = new Set(normalizeAtlas(dungeon.atlas).referenceItemIds)
    if (!ids.size) continue
    for (const entry of wanted) {
      const itemId = int(entry.itemId) || int(String(entry.itemKey || '').replace(/^i:/, ''))
      if (itemId && ids.has(itemId)) add(entryKey(dungeon), entry.itemKey)
    }
  }
  return targets
}

export function countsOf(targets = new Map()) {
  return new Map([...targets].map(([id, keys]) => [id, keys.length]))
}

// The player's own runs summed per dungeon (by instance id, else name), and
// per wing for runs whose boss kills prove one (run.dungeon.wing). A wing
// shows only those; a run that proves no wing stays on its dungeon.
export function runHistory(runs = []) {
  const byId = new Map()
  const byName = new Map()
  const byWing = new Map()
  const blank = () => ({ count: 0, completed: 0, lastStartedAt: null, bestSeconds: null })
  for (const run of runs || []) {
    const wingKey = run?.dungeon?.wing?.dungeonKey
    if (wingKey) {
      if (!byWing.has(wingKey)) byWing.set(wingKey, blank())
      tally(byWing.get(wingKey), run)
    }
    const id = int(run?.dungeon?.instanceId)
    const name = normalizedName(run?.dungeon?.name)
    const current = (id && byId.get(id)) || (name && byName.get(name)) || blank()
    current.count += 1
    if (run.status === 'completed') {
      current.completed += 1
      const seconds = finite(run.timer?.seconds ?? run.durationSeconds)
      if (seconds && (current.bestSeconds === null || seconds < current.bestSeconds)) current.bestSeconds = seconds
    }
    const started = finite(run.startedAt)
    if (started && (current.lastStartedAt === null || started > current.lastStartedAt)) current.lastStartedAt = started
    if (id) byId.set(id, current)
    if (name) byName.set(name, current)
  }
  return { get: (dungeon) => (isWingEntry(dungeon) ? byWing.get(dungeon.dungeonKey) || null
    : byId.get(int(dungeon?.instanceId)) || byName.get(normalizedName(dungeon?.name)) || null) }
}

function tally(current, run) {
  current.count += 1
  if (run.status === 'completed') {
    current.completed += 1
    const seconds = finite(run.timer?.seconds ?? run.durationSeconds)
    if (seconds && (current.bestSeconds === null || seconds < current.bestSeconds)) current.bestSeconds = seconds
  }
  const started = finite(run.startedAt)
  if (started && (current.lastStartedAt === null || started > current.lastStartedAt)) current.lastStartedAt = started
}

// Runs shown for one entry: a wing's own (proved by boss kills), or every
// run of the dungeon.
export function runsForEntry(runs = [], dungeon = null) {
  if (!isWingEntry(dungeon)) return runs || []
  return (runs || []).filter((run) => run?.dungeon?.wing?.dungeonKey === dungeon.dungeonKey)
}

function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}

// "Recommended for me", from facts only: the character's level is in the
// dungeon's range, or (when not under-levelled) the dungeon drops a
// wishlist item. Every reason shown is a fact the site holds; nothing is
// scored on guessed upgrades or drop chances. `usable` (gear the class can
// use) is counted only when the dungeon's details are loaded.
export function recommendDungeon(dungeon = {}, { character = null, wishCount = 0, usable = null, questCount = null } = {}) {
  if (!character) return { recommended: false, reasons: [], score: 0 }
  const atlas = normalizeAtlas(dungeon.atlas)
  const fit = levelFit(atlas, character)
  const reasons = []
  if (fit === 'fit') reasons.push(`${levelText(atlas)} suits ${character.name} (level ${character.level})`)
  if (wishCount > 0) reasons.push(`${plural(wishCount, 'wishlist item')} ${wishCount === 1 ? 'drops' : 'drop'} here`)
  if (usable && fit !== 'under') reasons.push(`${plural(usable, 'drop')} ${character.className ? `a ${character.className}` : character.name} can use`)
  const quests = questCount ?? atlas.questCount
  if (fit === 'fit' && quests) reasons.push(plural(quests, 'quest'))
  const recommended = fit !== 'under' && (fit === 'fit' || wishCount > 0)
  return { recommended, reasons: recommended ? reasons : [], score: recommended ? (fit === 'fit' ? 1 : 0) + wishCount * 10 + (usable ? Math.min(usable, 9) : 0) : 0 }
}

// --- Boss quick guide -----------------------------------------------------

export const ROLES = Object.freeze([['tank', 'Tank'], ['healer', 'Healer'], ['dps', 'Damage']])

const ROLE_FOCUS = Object.freeze({
  tank: ['tank-danger', 'positioning'],
  healer: ['healer-danger', 'dispel'],
  dps: ['interrupt', 'crowd-control', 'positioning'],
})

// The verb a quick-guide line opens with, from the ability's category only.
const CATEGORY_ACTION = Object.freeze({
  interrupt: 'Interrupt', 'tank-danger': 'Tank danger', 'healer-danger': 'Healer danger', positioning: 'Positioning',
  dispel: 'Dispel', 'crowd-control': 'Crowd control', 'special-mechanic': 'Mechanic',
})

const SINGLE_ROLE_CLASSES = new Set(['rogue', 'mage', 'warlock', 'hunter'])

// The quick guide's role: the character's own (role or spec) when known,
// else the only role the class can fill, else none (all roles).
export function defaultRole(character = null) {
  if (!character) return ''
  const role = String(character.role || '').toLowerCase()
  if (ROLES.some(([id]) => id === role)) return role
  if (role === 'damage' || role === 'damager') return 'dps'
  const spec = String(character.spec?.name || character.specName || character.spec || '').toLowerCase()
  if (spec) {
    if (/protection|guardian|blood|feral tank/.test(spec)) return 'tank'
    if (/holy|discipline|restoration/.test(spec)) return 'healer'
    return 'dps'
  }
  return SINGLE_ROLE_CLASSES.has(String(character.className || '').toLowerCase()) ? 'dps' : ''
}

// The 2–4 abilities that matter most for a role, before the full list:
// the role's categories first, then priority. Derived only from each
// ability's category, priority and interruptible flag.
export function quickGuide(abilities = [], role = '') {
  const list = (abilities || []).filter((ability) => ability && ability.name)
  if (!list.length) return []
  const focus = ROLE_FOCUS[role] || []
  const relevant = (ability) => focus.includes(ability.category) || (role === 'dps' && ability.interruptible === true)
  const rank = (ability) => PRIORITY_RANK[ability.priority] ?? 3
  const sorted = list.slice().sort((a, b) => (relevant(a) ? 0 : 1) - (relevant(b) ? 0 : 1) || rank(a) - rank(b)
    || (focus.indexOf(a.category) + 1 || 99) - (focus.indexOf(b.category) + 1 || 99) || String(a.name).localeCompare(String(b.name)))
  const picked = sorted.filter((ability) => (relevant(ability) && ability.priority !== 'low') || ability.priority === 'high').slice(0, 4)
  for (const ability of sorted) {
    if (picked.length >= 2) break
    if (!picked.includes(ability)) picked.push(ability)
  }
  return picked.map((ability) => ({
    ability,
    action: ability.category === 'interrupt' && ability.interruptible === false ? 'Cannot be interrupted' : CATEGORY_ACTION[ability.category] || 'Mechanic',
    forRole: relevant(ability),
    interruptible: ability.interruptible === true,
    unverified: needsUnverifiedBadge(ability),
  }))
}

// A quest's facts in display order; a giver may be a name or { npcId, name }.
export function questModel(quest = {}) {
  const giver = typeof quest.giver === 'string' ? quest.giver : quest.giver?.name || ''
  const faction = { alliance: 'Alliance', horde: 'Horde', both: 'Alliance & Horde' }[String(quest.faction || '').toLowerCase()] || quest.faction || ''
  const location = quest.location && typeof quest.location === 'object' ? quest.location : null
  const x = finite(location?.x)
  const y = finite(location?.y)
  return {
    id: quest.questId || quest.name,
    name: quest.name || 'Unnamed quest',
    level: finite(quest.level),
    minLevel: finite(quest.minLevel),
    faction,
    giver,
    objective: quest.objective || '',
    prerequisites: (Array.isArray(quest.prerequisites) ? quest.prerequisites : []).map((entry) => entry?.name || (entry?.questId ? `Quest ${entry.questId}` : '')).filter(Boolean),
    rewards: (Array.isArray(quest.rewards) ? quest.rewards : []).map(referenceItem).filter(Boolean),
    location: location ? {
      zoneName: location.zoneName || '',
      mapId: int(location.mapId),
      coords: x !== null && y !== null && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? `${(x * 100).toFixed(1)}, ${(y * 100).toFixed(1)}` : '',
    } : null,
  }
}

// The request one Want / Wanted click sends: the existing wishlist PUT
// (with where it drops) or DELETE.
export function wishlistToggleRequest(characterId, item, wanted, instance = null) {
  const path = `/api/player/wishlists/${encodeURIComponent(characterId)}/items/${item.itemKey}`
  if (wanted) return { path, method: 'DELETE', body: undefined }
  return { path, method: 'PUT', body: instance?.instanceId ? { sourceDungeon: instance.name, sourceInstanceId: instance.instanceId } : {} }
}

// The planning prompt holds at most this many dungeons (the server keeps the first 40).
export const MAX_PLAN_DUNGEONS = 40

// Plan My Gear's scope as the instance ids the planning prompt takes
// (?dungeons=36,48; the server keeps the first 40). [] = the whole catalog.
export function planScope(scope, { dungeon = null, dungeons = [], character = null } = {}) {
  if (scope === 'dungeon' && dungeon) return [dungeon.instanceId]
  // The prompt takes instance IDs: a dungeon's wings are one instance.
  if (scope === 'appropriate') return [...new Set(appropriateDungeons(dungeons, character).map((entry) => entry.instanceId))].slice(0, MAX_PLAN_DUNGEONS)
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
      key: `dungeon:${entryKey(dungeon)}`,
      instanceId: dungeon.instanceId,
      open: entryKey(dungeon),
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

// ------------------------------------------------------------ Quest readiness

// A quest's state for the selected character (GET …/readiness?character=).
export const QUEST_STATE_COPY = Object.freeze({
  completed: { label: 'Completed', tone: 'ok', mark: '✓' },
  accepted: { label: 'In quest log', tone: 'info', mark: '◆' },
  available: { label: 'Pick up', tone: 'warn', mark: '!' },
  prerequisites: { label: 'Needs an earlier quest', tone: 'bad', mark: '✕' },
  ineligible: { label: 'Not for this character', tone: 'quiet', mark: '–' },
  unknown: { label: 'Not known', tone: 'quiet', mark: '?' },
})

export const READINESS_COPY = Object.freeze({
  ready: { label: 'Ready', tone: 'ok' },
  missing: { label: 'Quests to pick up', tone: 'warn' },
  blocked: { label: 'Blocked', tone: 'bad' },
  unknown: { label: 'Not known', tone: 'quiet' },
  none: { label: 'No dungeon quests', tone: 'quiet' },
})

const PREREQUISITE_COPY = { done: 'done', accepted: 'in quest log', missing: 'not done', unknown: 'not known' }

function readinessQuest(raw = {}) {
  const location = raw.giver?.location && typeof raw.giver.location === 'object' ? raw.giver.location : null
  const x = finite(location?.x)
  const y = finite(location?.y)
  return {
    questId: int(raw.questId),
    name: raw.name || (raw.questId ? `Quest ${raw.questId}` : 'Unnamed quest'),
    state: QUEST_STATE_COPY[raw.state] ? raw.state : 'unknown',
    reasons: Array.isArray(raw.reasons) ? raw.reasons : [],
    relevance: raw.relevance || 'dungeon',
    level: finite(raw.level),
    minLevel: finite(raw.minLevel),
    giver: raw.giver?.name || '',
    startsFromItem: int(raw.startsFromItem),
    location: location ? {
      zoneName: location.zoneName || '',
      mapId: int(location.mapId),
      coords: x !== null && y !== null && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? `${(x * 100).toFixed(1)}, ${(y * 100).toFixed(1)}` : '',
    } : null,
    prerequisitesKnown: raw.prerequisitesKnown !== false,
    prerequisites: (Array.isArray(raw.prerequisites) ? raw.prerequisites : []).map((entry) => ({
      questId: int(entry?.questId),
      name: entry?.name || (entry?.questId ? `Quest ${entry.questId}` : 'Unnamed quest'),
      status: PREREQUISITE_COPY[entry?.status] ? entry.status : 'unknown',
      statusLabel: PREREQUISITE_COPY[entry?.status] || PREREQUISITE_COPY.unknown,
    })),
    objectivesComplete: raw.objectivesComplete === true ? true : raw.objectivesComplete === false ? false : null,
  }
}

// Why a quest's state is "unknown", in a few words.
export function unknownReason(quest) {
  const reasons = quest.reasons || []
  if (reasons.includes('prerequisites-not-known')) return 'its quest chain is not known'
  if (reasons.includes('completion-not-reported') || reasons.includes('quest-log-not-reported')) return 'quest data not synced'
  if (reasons.includes('reputation-not-reported')) return 'needs a reputation'
  if (reasons.includes('prerequisite-state-not-reported')) return 'earlier quests not reported'
  if (reasons.includes('eligibility-not-reported')) return 'who can take it is not known'
  return ''
}

// The readiness response, for the website: a summary and the quests in
// groups (what to pick up first; completed and ineligible last). Optional
// and repeatable quests never change the summary.
export function readinessModel(data) {
  if (!data || typeof data !== 'object' || !READINESS_COPY[data.readiness]) return null
  const required = (data.quests || []).map(readinessQuest)
  const optional = [...(data.optional || []), ...(data.repeatable || [])].map(readinessQuest)
  const chain = (data.prerequisites || []).map(readinessQuest)
  const applies = (quest) => quest.state !== 'ineligible'
  const byState = (list, ...states) => list.filter((quest) => states.includes(quest.state))
  const counts = {
    required: required.filter(applies).length,
    completed: byState(required, 'completed').length,
    accepted: byState(required, 'accepted').length,
    needed: byState(required, 'available').length,
    blocked: byState(required, 'prerequisites').length,
    unknown: byState(required, 'unknown').length,
    ineligible: byState(required, 'ineligible').length,
  }
  const groups = [
    { id: 'needed', title: 'Pick up before you go', quests: byState(required, 'available') },
    { id: 'blocked', title: 'Needs an earlier quest first', quests: byState(required, 'prerequisites') },
    { id: 'unknown', title: 'Not known yet', quests: byState(required, 'unknown') },
    { id: 'accepted', title: 'In the quest log', quests: byState(required, 'accepted') },
    { id: 'chains', title: 'Prerequisite chains', quests: chain.filter((quest) => applies(quest) && quest.state !== 'completed'), quiet: true },
    { id: 'optional', title: 'Optional quests', quests: optional.filter((quest) => applies(quest) && quest.state !== 'completed'), quiet: true },
    { id: 'completed', title: 'Completed', quests: [...byState(required, 'completed'), ...byState(optional, 'completed')], quiet: true },
  ].filter((group) => group.quests.length)
  const character = data.character && typeof data.character === 'object' ? data.character : null
  return {
    readiness: data.readiness,
    ...READINESS_COPY[data.readiness],
    counts,
    groups,
    questList: data.questList === 'unknown' ? 'unknown' : 'curated',
    capturedAt: character?.capturedAt || null,
    synced: Boolean(character),
    partial: Boolean(character) && (character.completedCoverage !== 'full' || character.questLogCoverage !== 'full'),
    chainsUnknown: [...required, ...optional].some((quest) => !quest.prerequisitesKnown),
    ineligible: counts.ineligible,
  }
}

// One line for the summary: "2 of 5 required done · 1 in the quest log · 2 to pick up".
export function readinessLine(model) {
  if (!model) return ''
  const { counts } = model
  if (!counts.required) return model.questList === 'unknown' ? 'No source lists this dungeon\'s quests yet. That does not mean it has none.' : 'No dungeon quests apply to this character.'
  return [
    `${counts.completed} of ${counts.required} required done`,
    counts.accepted ? `${counts.accepted} in the quest log` : null,
    counts.needed ? `${counts.needed} to pick up` : null,
    counts.blocked ? `${counts.blocked} waiting on an earlier quest` : null,
    counts.unknown ? `${counts.unknown} not known` : null,
  ].filter(Boolean).join(' · ')
}
