import test from 'node:test'
import assert from 'node:assert/strict'

import {
  blankQuest,
  questScopeAllows,
  rewardApprovalStatus,
  rewardAuthorityAllows,
  rewardFingerprint,
  withSelfAssignments,
} from '../src/Quests/questAuthority.js'

function session({
  userId = 'member-one',
  permissions = [],
  questScopes = {},
  approveLimits = {},
  issueLimits = {},
} = {}) {
  const permissionSet = new Set(permissions)

  return {
    user: { id: userId },
    hasPermission(permission) {
      return permissionSet.has(permission)
    },
    authority: {
      questScopes,
      rewardLimits: {
        approve: {
          repPerObjective: 0,
          marksPerObjective: 0,
          marksPerQuest: 0,
          ...approveLimits,
        },
        issue: {
          repPerObjective: 0,
          marksPerObjective: 0,
          marksPerQuest: 0,
          ...issueLimits,
        },
      },
    },
  }
}

test('blank quests belong to their creator and start as editable drafts', () => {
  const quest = blankQuest('member-one')

  assert.equal(quest.createdByMemberId, 'member-one')
  assert.equal(quest.publication, 'draft')
  assert.equal(quest.objectives.length, 1)
  assert.equal(quest.objectives[0].completed, false)
})

test('own versus all quest scope is resolved against the quest creator', () => {
  const ownSession = session({
    permissions: ['quests.edit'],
    questScopes: { 'quests.edit': 'own' },
  })

  assert.equal(
    questScopeAllows(
      ownSession,
      'quests.edit',
      { createdByMemberId: 'member-one' },
    ),
    true,
  )
  assert.equal(
    questScopeAllows(
      ownSession,
      'quests.edit',
      { createdByMemberId: 'member-two' },
    ),
    false,
  )

  const allSession = session({
    permissions: ['quests.edit'],
    questScopes: { 'quests.edit': 'all' },
  })

  assert.equal(
    questScopeAllows(
      allSession,
      'quests.edit',
      { createdByMemberId: 'member-two' },
    ),
    true,
  )
})

test('reward approval status is bound to the current reward fingerprint', () => {
  const reward = { rep: 100, marks: 5, items: [] }
  const objective = {
    reward,
    rewardApproval: {
      approvedAt: '2026-10-02T12:00:00.000Z',
      fingerprint: rewardFingerprint(reward),
    },
  }

  assert.equal(rewardApprovalStatus(objective), 'approved')

  objective.reward = { ...reward, marks: 6 }
  assert.equal(rewardApprovalStatus(objective), 'pending')
})

test('reward action affordances respect both scope and reward brackets', () => {
  const actor = session({
    permissions: ['rewards.approve'],
    questScopes: { 'rewards.approve': 'all' },
    approveLimits: {
      repPerObjective: 250,
      marksPerObjective: 10,
      marksPerQuest: 30,
    },
  })

  const quest = {
    createdByMemberId: 'member-two',
    objectives: [
      { reward: { rep: 200, marks: 10, items: [] } },
      { reward: { rep: 0, marks: 15, items: [] } },
    ],
  }

  assert.equal(
    rewardAuthorityAllows(
      actor,
      'rewards.approve',
      quest,
      quest.objectives[0],
    ),
    true,
  )

  quest.objectives[1].reward.marks = 21

  assert.equal(
    rewardAuthorityAllows(
      actor,
      'rewards.approve',
      quest,
      quest.objectives[0],
    ),
    false,
  )
})

test('raw management assignments identify the signed-in member for modal signup state', () => {
  const quest = withSelfAssignments(
    {
      objectives: [
        {
          assignments: [
            { memberId: 'member-one', name: 'Rook' },
            { memberId: 'member-two', name: 'Quill' },
          ],
        },
      ],
    },
    'member-one',
  )

  assert.equal(quest.objectives[0].assignments[0].isSelf, true)
  assert.equal(quest.objectives[0].assignments[1].isSelf, false)
})
