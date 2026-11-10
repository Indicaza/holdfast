import test from 'node:test'
import assert from 'node:assert/strict'

import {
  foundingMission,
  recruitmentFacts,
} from '../src/Home/recruitmentContent.js'
import { foundingMissionAction } from '../src/Home/FoundingMission/foundingMissionAction.js'

test('recruitment facts stay concise, complete, and unique', () => {
  assert.equal(recruitmentFacts.length, 4)
  assert.equal(new Set(recruitmentFacts.map((fact) => fact.id)).size, 4)
  assert.deepEqual(
    recruitmentFacts.map((fact) => fact.id),
    ['founding', 'region', 'pace', 'recruiting'],
  )

  for (const fact of recruitmentFacts) {
    assert.ok(fact.label)
    assert.ok(fact.value)
    assert.ok(fact.detail)
  }
})

test('founding copy identifies the live faction and ruleset', () => {
  const founding = recruitmentFacts.find((fact) => fact.id === 'founding')

  assert.match(founding.detail, /Alliance/)
  assert.match(founding.detail, /RP-PvP realm/)
  assert.match(foundingMission.description, /in-game guild charter/)
})

test('founding mission sends visitors to recruitment and members to quests', () => {
  assert.deepEqual(foundingMissionAction(false), {
    label: 'Join Holdfast',
    href: null,
  })
  assert.deepEqual(foundingMissionAction(true), {
    label: 'View Quests',
    href: '/holdfast/quests',
  })
})
