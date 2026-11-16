// URL state, filters and wording for the dungeon loot catalog and the
// character wishlists. Kept apart from the components so it can be tested
// without a browser.

export const LOOT_FILTER_KEYS = Object.freeze(['q', 'slot', 'type', 'quality', 'usable', 'all'])
export const PRIORITIES = Object.freeze([['high', 'High'], ['normal', 'Normal'], ['low', 'Low']])
export const QUALITY_NAMES = Object.freeze({ 0: 'Poor', 1: 'Common', 2: 'Uncommon', 3: 'Rare', 4: 'Epic', 5: 'Legendary' })
export const MAX_NOTE = 140

// The Dungeons page has two views: the player's runs, and loot with the
// wishlist. `view=loot` selects the second; everything else is the first.
export function readLootQuery(queryString = '') {
  const params = new URLSearchParams(queryString)
  const dungeon = Number(params.get('dungeon'))
  return {
    view: params.get('view') === 'loot' ? 'loot' : 'runs',
    character: params.get('character') || '',
    dungeon: Number.isSafeInteger(dungeon) && dungeon > 0 ? dungeon : null,
    filters: Object.fromEntries(LOOT_FILTER_KEYS.map((key) => [key, params.get(key) || ''])),
  }
}

export function lootHref({ server = '', character = '', dungeon = null, filters = {} } = {}) {
  const params = new URLSearchParams()
  if (server) params.set('server', server)
  params.set('view', 'loot')
  if (character) params.set('character', character)
  if (dungeon) params.set('dungeon', String(dungeon))
  for (const key of LOOT_FILTER_KEYS) if (filters[key]) params.set(key, filters[key])
  return `/dashboard/dungeons?${params.toString()}`
}

// The character to show: the URL's when it is one of the player's, else
// the one played most recently (the list arrives in that order).
export function resolveCharacter(characters = [], requested = '') {
  return characters.find((character) => character.id === requested) || characters[0] || null
}

// The dungeon to show: the URL's when the catalog has it, else the first
// with any loot, else the first.
export function resolveDungeon(dungeons = [], requested = null) {
  return dungeons.find((dungeon) => dungeon.instanceId === requested) || dungeons.find((dungeon) => dungeon.itemCount > 0) || dungeons[0] || null
}

// What the game itself says about using an item: its required level and a
// "Classes:" line in its tooltip. true, false, or null when neither is
// known. Armor types and stats are never used to guess.
export function usableBy(item = {}, character = null) {
  if (!character) return null
  const facts = []
  if (item.requiredLevel && character.level) facts.push(item.requiredLevel <= character.level)
  if (Array.isArray(item.classes) && item.classes.length && character.className) {
    const name = String(character.className).trim().toLowerCase()
    facts.push(item.classes.some((entry) => String(entry).trim().toLowerCase() === name))
  }
  if (!facts.length) return null
  return facts.every(Boolean)
}

export function matchesFilters(item, filters = {}, character = null) {
  if (!filters.all && !item.equippable) return false
  if (filters.slot && item.slot !== filters.slot) return false
  if (filters.type && item.itemSubclass !== filters.type) return false
  if (filters.quality && String(item.qualityId ?? '') !== String(filters.quality)) return false
  // "Usable" hides what the game says this character cannot use; an item
  // with nothing known about it stays.
  if (filters.usable && usableBy(item, character) === false) return false
  const q = String(filters.q || '').trim().toLowerCase()
  if (q && !String(item.name || '').toLowerCase().includes(q) && String(item.itemId) !== q) return false
  return true
}

// Sources with the items that pass the filters; sources left empty go.
// A search also matches a boss's name: then all its items show.
export function filterSources(sources = [], filters = {}, character = null) {
  const q = String(filters.q || '').trim().toLowerCase()
  return sources.map((source) => {
    const named = q && String(source.name || '').toLowerCase().includes(q)
    const items = source.items.filter((item) => matchesFilters(item, named ? { ...filters, q: '' } : filters, character))
    return { ...source, items }
  }).filter((source) => source.items.length)
}

// The choices each filter offers, from the loot on screen.
export function filterOptions(sources = [], { all = false } = {}) {
  const slots = new Set()
  const types = new Set()
  const qualities = new Set()
  for (const source of sources) {
    for (const item of source.items) {
      if (!all && !item.equippable) continue
      if (item.slot) slots.add(item.slot)
      if (item.itemSubclass) types.add(item.itemSubclass)
      if (item.qualityId !== null && item.qualityId !== undefined) qualities.add(item.qualityId)
    }
  }
  return { slots: [...slots].sort(), types: [...types].sort(), qualities: [...qualities].sort((a, b) => b - a) }
}

// How sure the catalog is that an item comes from a source, in words.
export const CONFIDENCE = Object.freeze({
  confirmed: { label: 'Seen dropping', tone: 'ok', help: 'Players saw it in this source\'s loot window.' },
  advertised: { label: 'Listed by the game', tone: 'info', help: 'The game\'s own journal lists it here. No player has reported seeing it drop yet.' },
  reported: { label: 'Seen in a roll', tone: 'quiet', help: 'It was rolled for in this dungeon. Which creature dropped it is not known.' },
  candidate: { label: 'Unconfirmed', tone: 'quiet', help: 'Only an outside loot table says so. Nothing in the game has confirmed it.' },
  delisted: { label: 'No longer listed', tone: 'warn', help: 'The game\'s journal stopped listing it, and nobody has seen it drop since. It may have been removed.' },
})

export function confidenceCopy(confidence) {
  return CONFIDENCE[confidence] || CONFIDENCE.candidate
}

const PROVENANCE = { loot_window: ['loot window', 'loot windows'], group_roll: ['group roll', 'group rolls'], encounter_journal: ['journal list', 'journal lists'], external: ['outside table', 'outside tables'] }

// "Seen in 3 loot windows, first on build 70338; listed by the journal".
export function evidenceText(item = {}) {
  const parts = (item.evidence || []).map((line) => {
    const [one, many] = PROVENANCE[line.provenance] || ['report', 'reports']
    const count = `${line.evidenceCount} ${line.evidenceCount === 1 ? one : many}`
    const builds = line.firstBuild && line.lastBuild && line.firstBuild !== line.lastBuild ? `builds ${line.firstBuild}–${line.lastBuild}` : line.lastBuild ? `build ${line.lastBuild}` : ''
    return `${count}${builds ? ` (${builds})` : ''}${line.status === 'removed' ? ', no longer listed' : ''}`
  })
  return parts.join(' · ')
}

export function difficultyText(item = {}, names = {}) {
  const ids = item.difficultyIds || []
  if (!ids.length) return ''
  return ids.map((id) => names[id] || names[String(id)] || (id ? `Difficulty ${id}` : '')).filter(Boolean).join(', ')
}

// One line under a wishlist item: where it is known to drop.
export function sourcesText(sources = []) {
  if (!sources.length) return 'No dungeon source known yet'
  const shown = sources.slice(0, 2).map((source) => (source.source ? `${source.source}, ${source.dungeon}` : source.dungeon))
  return `${shown.join(' · ')}${sources.length > 2 ? ` · +${sources.length - 2} more` : ''}`
}

// What happened to a wishlist item, from proof only. A roll or a loot
// window is an offer to the group and is never worded as the player's.
export function acquisitionCopy(entry = {}) {
  const evidence = entry.evidence || {}
  if (entry.state === 'acquired') {
    const how = { owned: 'In your bags or equipped', roll_won: 'You won the roll', manual: 'Marked by you' }[entry.acquiredBasis] || 'Acquired'
    return { label: 'Acquired', tone: 'ok', detail: how }
  }
  if (evidence.offeredInRollAt) return { label: 'Wanted', tone: 'info', detail: 'Came up in a roll you saw; not won' }
  if (evidence.seenInLootWindowAt) return { label: 'Wanted', tone: 'info', detail: 'You have seen it drop' }
  return { label: 'Wanted', tone: 'quiet', detail: '' }
}

export function wishlistGroups(items = []) {
  return { wanted: items.filter((item) => item.state !== 'acquired'), acquired: items.filter((item) => item.state === 'acquired') }
}

// "3 to add, 1 to update, 2 already on the list".
export function importSummaryText(summary = {}) {
  const parts = []
  if (summary.add) parts.push(`${summary.add} to add`)
  if (summary.update) parts.push(`${summary.update} to update`)
  if (summary.unchanged) parts.push(`${summary.unchanged} already on the list`)
  if (summary.invalid) parts.push(`${summary.invalid} with errors`)
  return parts.join(', ') || 'Nothing to import'
}

export function appliedText(applied = {}) {
  const parts = []
  if (applied.added) parts.push(`${applied.added} added`)
  if (applied.updated) parts.push(`${applied.updated} updated`)
  if (applied.skippedUpdates) parts.push(`${applied.skippedUpdates} existing left as they were`)
  if (applied.skippedInvalid) parts.push(`${applied.skippedInvalid} skipped`)
  return parts.join(', ') || 'Nothing changed: everything was already on the list'
}

// Errors grouped the way the player (and the AI) must treat them: a
// catalog error is fixed by dropping or replacing the item, never by
// producing an id.
export function groupImportErrors(errors = []) {
  return { format: errors.filter((error) => error.category !== 'catalog'), catalog: errors.filter((error) => error.category === 'catalog') }
}

const CHANGE_KINDS = {
  new_item: 'New item', new_source: 'New source', observed: 'Seen dropping', advertised_added: 'Now listed by the game',
  potentially_removed: 'No longer listed by the game', restored: 'Listed again', conflict: 'Conflicting reports',
}

export function changeText(change = {}) {
  const kind = CHANGE_KINDS[change.kind] || change.kind
  const subject = change.item?.name || change.source?.name || 'Unknown'
  const from = change.item && change.source?.name ? ` (${change.source.name})` : ''
  return `${kind}: ${subject}${from}`
}
