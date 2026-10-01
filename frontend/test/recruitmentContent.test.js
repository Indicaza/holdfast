import test from 'node:test'
import assert from 'node:assert/strict'

import {
  foundingMission,
  recruitmentFacts,
} from '../src/Home/recruitmentContent.js'
import { foundingMissionAction } from '../src/Home/FoundingMission/foundingMissionAction.js'

test('recruitment facts cover the founding-phase promises without duplicates', () => {
  assert.equal(recruitmentFacts.length, 6)
  assert.equal(new Set(recruitmentFacts.map((fact) => fact.id)).size, 6)
  assert.deepEqual(
    recruitmentFacts.map((fact) => fact.id),
    ['founding', 'region', 'solo', 'voice', 'realm', 'recruiting'],
  )

  for (const fact of recruitmentFacts) {
    assert.ok(fact.label)
    assert.ok(fact.value)
    assert.ok(fact.detail)
  }
})

test('realm and founding copy clearly distinguish beta from launch', () => {
  const realm = recruitmentFacts.find((fact) => fact.id === 'realm')

  assert.match(realm.detail, /Normal realm during beta/)
  assert.match(realm.detail, /PvP realm at launch/)
  assert.match(foundingMission.description, /in-game guild charter/)
  assert.match(foundingMission.description, /PvP realm/)
})

test('founding mission sends visitors to recruitment and members to quests', () => {
  assert.deepEqual(foundingMissionAction(false), {
    label: 'Join Holdfast',
    href: null,
  })
  assert.deepEqual(foundingMissionAction(true), {
    label: 'View Quests',
    href: '/quests',
  })
})
