// The Dungeon Content Studio's pure editor operations.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearOverride, fieldStatus, initialValue, isDirty, linesToList, locationFrom, mechanicId, moveItem, parseIds, problemsAt, setOverride, setOverrideMeta, setQuestPlan,
} from '../src/Admin/DungeonStudio/studioModel.js'

const empty = () => ({ schemaVersion: 1, instanceId: 3065, dungeon: {}, bosses: {}, questPlan: {} })

test('override, verify and clear a field without touching the rest', () => {
  let doc = setOverride(empty(), ['dungeon'], 'subtitle', 'Synthetic')
  assert.deepEqual(doc.dungeon.subtitle, { verified: false, source: '', value: 'Synthetic' })
  doc = setOverrideMeta(doc, ['dungeon'], 'subtitle', { verified: true, source: 'checked in game' })
  assert.equal(doc.dungeon.subtitle.verified, true)
  doc = setOverride(doc, ['bosses', '261306'], 'mechanics', [])
  assert.ok(doc.bosses['261306'])
  doc = clearOverride(doc, ['bosses', '261306'], 'mechanics')
  assert.equal(doc.bosses['261306'], undefined, 'a boss without overrides is dropped')
  assert.equal(doc.dungeon.subtitle.value, 'Synthetic')
  assert.ok(isDirty(doc, empty()))
})

test('helpers: initial values, ids, reordering, lines, locations, status', () => {
  assert.equal(initialValue({ kind: 'text' }, 'Imported'), 'Imported')
  assert.deepEqual(initialValue({ kind: 'mechanics' }, null), [])
  assert.equal(initialValue({ kind: 'media' }, 'https://x/art.png'), null)
  assert.equal(mechanicId('Shadow Bolt', ['shadow-bolt']), 'shadow-bolt-2')
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b'])
  assert.deepEqual(moveItem(['a'], 0, -1), ['a'])
  assert.deepEqual(linesToList(' one \n\n two'), ['one', 'two'])
  assert.deepEqual(parseIds('155, -168 x 0'), [155, -168])
  assert.equal(locationFrom({ mapId: '0', x: 0.5, y: 0.5 }), null)
  assert.equal(locationFrom({ mapId: 1455, x: 1.5, y: 0.5 }), null)
  assert.deepEqual(locationFrom({ mapId: '1455', x: '0.2', y: '0.3', zoneName: 'Ironforge' }), { mapId: 1455, x: 0.2, y: 0.3, zoneName: 'Ironforge' })
  assert.equal(fieldStatus({ conflict: true }).tone, 'danger')
  assert.equal(fieldStatus({ winner: 'editorial', override: { verified: true } }).label, 'Override, verified')
  const plan = setQuestPlan(empty(), (next) => ({ ...next, quests: [], instructions: [{ section: 'enter', text: 'x' }] }))
  assert.deepEqual(Object.keys(plan.questPlan), ['instructions'])
  const validation = { errors: [{ path: 'bosses.1.mechanics[0].id', message: 'dup' }], warnings: [{ path: 'bosses.10', message: 'other' }] }
  assert.equal(problemsAt(validation, 'bosses.1.mechanics').length, 1)
  assert.equal(problemsAt(validation, 'bosses.1').length, 1, 'bosses.10 is not bosses.1')
})
