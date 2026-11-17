import assert from 'node:assert/strict'
import test from 'node:test'

import {
  acquisitionCopy,
  appliedText,
  changeText,
  confidenceCopy,
  difficultyText,
  evidenceText,
  filterOptions,
  filterSources,
  groupImportErrors,
  importSummaryText,
  lootHref,
  readLootQuery,
  resolveCharacter,
  resolveDungeon,
  sourcesText,
  usableBy,
  wishlistGroups,
} from '../src/Player/lootModel.js'

const barb = { itemId: 5191, itemKey: 'i:5191', name: 'Cruel Barb', qualityId: 3, slot: 'One-Hand', itemSubclass: 'One-Handed Swords', equippable: true, requiredLevel: 19, classes: null }
const staff = { itemId: 5201, itemKey: 'i:5201', name: 'Emberstone Staff', qualityId: 3, slot: 'Two-Hand', itemSubclass: 'Staves', equippable: true, requiredLevel: 18, classes: ['Mage', 'Warlock'] }
const cape = { itemId: 5193, itemKey: 'i:5193', name: 'Cape of the Brotherhood', qualityId: 2, slot: 'Back', itemSubclass: 'Cloth', equippable: true, requiredLevel: 30, classes: null }
const linen = { itemId: 2589, itemKey: 'i:2589', name: 'Linen Cloth', qualityId: 1, slot: null, itemSubclass: 'Cloth', equippable: false, requiredLevel: null, classes: null }
const sources = [{ key: 'boss:edwin vancleef', name: 'Edwin VanCleef', boss: true, items: [barb, staff, cape, linen] }, { key: 'creature:1729', name: 'Defias Evoker', items: [linen] }]
const rook = { id: 'rook', name: 'Rook', level: 20, className: 'Warrior' }

test('the page URL carries the view, character, dungeon and filters', () => {
  assert.deepEqual(readLootQuery(''), { view: 'runs', character: '', dungeon: null, filters: { q: '', slot: '', type: '', quality: '', usable: '', all: '' } })
  const query = readLootQuery('view=loot&character=rook&dungeon=36&q=barb&slot=Back&usable=1&run=7')
  assert.equal(query.view, 'loot')
  assert.equal(query.character, 'rook')
  assert.equal(query.dungeon, 36)
  assert.deepEqual(query.filters, { q: 'barb', slot: 'Back', type: '', quality: '', usable: '1', all: '' })
  assert.equal(readLootQuery('view=loot&dungeon=abc').dungeon, null)
  assert.equal(readLootQuery('view=other').view, 'runs')
  assert.equal(lootHref({ server: 'us:live realm', character: 'rook', dungeon: 36, filters: { q: 'barb', slot: '' } }),
    '/dashboard/dungeons?server=us%3Alive+realm&view=loot&character=rook&dungeon=36&q=barb')
  assert.equal(lootHref(), '/dashboard/dungeons?view=loot')
})

test('the character and dungeon shown fall back to what the player has', () => {
  const characters = [{ id: 'fern' }, { id: 'rook' }]
  assert.equal(resolveCharacter(characters, 'rook').id, 'rook')
  assert.equal(resolveCharacter(characters, 'someone-elses').id, 'fern', 'an id that is not theirs is never shown')
  assert.equal(resolveCharacter([], 'rook'), null)
  const dungeons = [{ instanceId: 33, itemCount: 0 }, { instanceId: 36, itemCount: 4 }]
  assert.equal(resolveDungeon(dungeons, 33).instanceId, 33)
  assert.equal(resolveDungeon(dungeons, null).instanceId, 36, 'the first with loot')
  assert.equal(resolveDungeon([{ instanceId: 33, itemCount: 0 }], 99).instanceId, 33)
  assert.equal(resolveDungeon([], 36), null)
})

test('usable comes only from what the game says: level and a Classes line', () => {
  assert.equal(usableBy(barb, rook), true)
  assert.equal(usableBy(cape, rook), false, 'required level above the character')
  assert.equal(usableBy(staff, rook), false, 'the tooltip restricts it to other classes')
  assert.equal(usableBy(staff, { ...rook, className: 'mage' }), true)
  assert.equal(usableBy(linen, rook), null, 'nothing known: no claim either way')
  assert.equal(usableBy(barb, null), null)
  assert.equal(usableBy({ ...barb, requiredLevel: null }, rook), null)
  assert.equal(usableBy(barb, { ...rook, level: 0 }), null, 'a character whose level is unknown')
})

test('filters narrow the loot and drop empty sources', () => {
  const names = (list) => list.map((source) => [source.name, source.items.map((item) => item.name)])
  assert.deepEqual(names(filterSources(sources, {}, rook)), [['Edwin VanCleef', ['Cruel Barb', 'Emberstone Staff', 'Cape of the Brotherhood']]], 'gear only by default')
  assert.equal(filterSources(sources, { all: '1' }, rook).length, 2)
  assert.deepEqual(names(filterSources(sources, { slot: 'Back' }, rook)), [['Edwin VanCleef', ['Cape of the Brotherhood']]])
  assert.deepEqual(names(filterSources(sources, { type: 'Staves' }, rook)), [['Edwin VanCleef', ['Emberstone Staff']]])
  assert.deepEqual(names(filterSources(sources, { quality: '2' }, rook)), [['Edwin VanCleef', ['Cape of the Brotherhood']]])
  assert.deepEqual(names(filterSources(sources, { usable: '1' }, rook)), [['Edwin VanCleef', ['Cruel Barb']]])
  assert.deepEqual(names(filterSources(sources, { usable: '1', all: '1' }, rook))[1], ['Defias Evoker', ['Linen Cloth']], 'unknown usability is kept')
  assert.deepEqual(names(filterSources(sources, { q: 'barb' }, rook)), [['Edwin VanCleef', ['Cruel Barb']]])
  assert.deepEqual(names(filterSources(sources, { q: '5193' }, rook)), [['Edwin VanCleef', ['Cape of the Brotherhood']]], 'by item id')
  assert.equal(filterSources(sources, { q: 'vancleef' }, rook)[0].items.length, 3, 'a boss name shows all its gear')
  assert.deepEqual(filterSources(sources, { q: 'nothing' }, rook), [])
  assert.deepEqual(filterOptions(sources), { slots: ['Back', 'One-Hand', 'Two-Hand'], types: ['Cloth', 'One-Handed Swords', 'Staves'], qualities: [3, 2] })
  assert.deepEqual(filterOptions(sources, { all: true }).qualities, [3, 2, 1])
})

test('confidence and evidence say what is known, not more', () => {
  assert.equal(confidenceCopy('confirmed').label, 'Seen dropping')
  assert.equal(confidenceCopy('advertised').label, 'Listed by the game')
  assert.match(confidenceCopy('advertised').help, /No player has reported seeing it drop yet/)
  assert.equal(confidenceCopy('delisted').tone, 'warn')
  assert.equal(confidenceCopy('whatever').label, 'Unconfirmed')
  assert.equal(evidenceText({ evidence: [
    { provenance: 'loot_window', evidenceCount: 3, firstBuild: '70338', lastBuild: '70400', status: 'active' },
    { provenance: 'encounter_journal', evidenceCount: 1, firstBuild: '70338', lastBuild: '70338', status: 'removed' },
  ] }), '3 loot windows (builds 70338–70400) · 1 journal list (build 70338), no longer listed')
  assert.equal(evidenceText({}), '')
  assert.equal(difficultyText({ difficultyIds: [1, 2] }, { 1: 'Normal' }), 'Normal, Difficulty 2')
  assert.equal(difficultyText({ difficultyIds: [0] }, {}), '')
  assert.equal(sourcesText([]), 'No dungeon source known yet')
  assert.equal(sourcesText([{ source: 'Edwin VanCleef', dungeon: 'The Deadmines' }, { source: null, dungeon: 'Wailing Caverns' }, { dungeon: 'Shadowfang Keep' }]),
    'Edwin VanCleef, The Deadmines · Wailing Caverns · +1 more')
})

test('an offer is never worded as the player\'s item', () => {
  assert.deepEqual(acquisitionCopy({ state: 'wanted', evidence: {} }), { label: 'Wanted', tone: 'quiet', detail: '' })
  assert.equal(acquisitionCopy({ state: 'wanted', evidence: { seenInLootWindowAt: 5 } }).detail, 'You have seen it drop')
  assert.equal(acquisitionCopy({ state: 'wanted', evidence: { seenInLootWindowAt: 5, offeredInRollAt: 9 } }).detail, 'Came up in a roll you saw; not won')
  assert.deepEqual(acquisitionCopy({ state: 'acquired', acquiredBasis: 'roll_won' }), { label: 'Acquired', tone: 'ok', detail: 'You won the roll' })
  assert.equal(acquisitionCopy({ state: 'acquired', acquiredBasis: 'owned' }).detail, 'In your bags or equipped')
  assert.equal(acquisitionCopy({ state: 'acquired', acquiredBasis: 'manual' }).detail, 'Marked by you')
  const groups = wishlistGroups([{ itemKey: 'a', state: 'wanted' }, { itemKey: 'b', state: 'acquired' }, { itemKey: 'c', state: 'wanted' }])
  assert.deepEqual([groups.wanted.map((item) => item.itemKey), groups.acquired.map((item) => item.itemKey)], [['a', 'c'], ['b']])
})

test('import results and catalog changes read as sentences', () => {
  assert.equal(importSummaryText({ add: 3, update: 1, unchanged: 2, invalid: 0 }), '3 to add, 1 to update, 2 already on the list')
  assert.equal(importSummaryText({ add: 0, update: 0, unchanged: 0, invalid: 0 }), 'Nothing to import')
  assert.equal(appliedText({ added: 2, updated: 0, unchanged: 1, skippedUpdates: 1, skippedInvalid: 2 }), '2 added, 1 existing left as they were, 2 skipped')
  assert.equal(appliedText({ added: 0, updated: 0, unchanged: 3 }), 'Nothing changed: everything was already on the list')
  const grouped = groupImportErrors([{ code: 'invalid_json', category: 'json' }, { code: 'unknown_item', category: 'catalog' }, { code: 'invalid_priority', category: 'schema' }])
  assert.deepEqual([grouped.format.map((error) => error.code), grouped.catalog.map((error) => error.code)], [['invalid_json', 'invalid_priority'], ['unknown_item']])
  assert.equal(changeText({ kind: 'potentially_removed', item: { name: 'Cruel Barb' }, source: { name: 'Edwin VanCleef' } }), 'No longer listed by the game: Cruel Barb (Edwin VanCleef)')
  assert.equal(changeText({ kind: 'new_source', item: null, source: { name: 'Kresh' } }), 'New source: Kresh')
})
