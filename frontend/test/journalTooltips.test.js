import test from 'node:test'
import assert from 'node:assert/strict'

import { referenceTooltip } from '../src/Player/Dungeons/atlasModel.js'
import { placeFloating } from '../src/WowAssets/floatingPlacement.js'

test('reference facts read like a tooltip, in the game\'s order, and say where they come from', () => {
  const facts = referenceTooltip({ name: 'Cruel Barb', bindType: 'BoP', slot: 'One-Hand', itemSubclass: 'One-Handed Swords',
    weapon: { minDamage: 30, maxDamage: 57, speed: 2.8, dps: 15.5 }, stats: [{ stat: 'Agility', value: 4 }], requiredLevel: 19, itemLevel: 24, factSources: ['wago-classic-era'] })
  // The client's order and words: item level first, a one-word weapon type.
  assert.deepEqual(facts.lines.map((line) => [line.left, line.right || '']), [
    ['Item Level 24', ''], ['Binds when picked up', ''], ['One-Hand', 'Sword'], ['30 - 57 Damage', 'Speed 2.80'], ['(15.5 damage per second)', ''],
    ['+4 Agility', ''], ['Requires Level 19', ''],
  ])
  assert.equal(facts.label, 'Classic reference')
  // A neck has no armor type; a stat that is not a base stat is the game's green.
  const neck = referenceTooltip({ slot: 'Neck', itemSubclass: 'Miscellaneous', stats: [{ stat: 'Spirit', value: 5 }, { stat: 'Spell Power', value: 3 }] })
  assert.deepEqual(neck.lines.map((line) => [line.left, line.right, line.tone]), [['Neck', '', undefined], ['+5 Spirit', undefined, 'stat'], ['+3 Spell Power', undefined, 'bonus']])
  // A recipe has a type and no slot: it stays on the left.
  assert.equal(referenceTooltip({ itemSubclass: 'Blacksmithing' }).lines[0].left, 'Blacksmithing')
  // Forever items say so; unknown facts are left out, never filled in.
  const forever = referenceTooltip({ name: 'Aetherwisp Bracers', slot: 'Wrist', armor: 45, factSources: ['wago-forever', 'foreverdb'] })
  assert.deepEqual(forever.lines.map((line) => line.left), ['Wrist', '45 Armor'])
  assert.equal(forever.label, 'WoW Forever reference')
  assert.equal(referenceTooltip({ name: 'Mystery Ring' }), null)
  assert.equal(referenceTooltip({ name: 'Strain', kind: 'quest-item', bindType: 'BoP' }).lines[0].left, 'Quest Item')
})

test('floating boxes stay in the window and off their anchor', () => {
  const viewport = { width: 1280, height: 720 }
  const anchor = (left, top, size = 46) => ({ left, top, right: left + size, bottom: top + size, width: size, height: size })
  const covers = (box, a, w, h) => box.left < a.right && a.left < box.left + w && box.top < a.bottom && a.top < box.top + h
  for (const [label, a] of [['middle', anchor(600, 300)], ['right edge', anchor(1220, 300)], ['left edge', anchor(4, 300)],
    ['bottom edge', anchor(600, 668)], ['top edge', anchor(600, 2)]]) {
    const box = placeFloating(a, 280, 300, 'right', viewport)
    assert.ok(box.left >= 12 && box.left + 280 <= 1268 && box.top >= 12 && box.top + 300 <= 708, `${label} inside: ${JSON.stringify(box)}`)
    assert.ok(!covers(box, a, 280, 300), `${label} off its anchor`)
  }
  // A phone: no room on either side, so below (or above near the bottom).
  const phone = { width: 390, height: 844 }
  const below = placeFloating(anchor(170, 200), 300, 260, 'right', phone)
  assert.equal(below.top, 256)
  const above = placeFloating(anchor(170, 700), 300, 260, 'right', phone)
  assert.equal(above.top, 700 - 260 - 10)
})
