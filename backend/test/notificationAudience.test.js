import assert from 'node:assert/strict'
import test from 'node:test'

import { withGuildTransaction } from '../src/Data/database.js'
import { questReviewerMemberIdsInDatabase } from '../src/Notification/notificationAudience.js'
import { memberIds, withHttpApp } from '../testSupport/httpHarness.js'

function setLieutenantScope(db, { permissions = ['rewards.issue'], questScope = 'own' } = {}) {
  db.prepare(`
    UPDATE rank_authority
    SET permissions_json = ?, quest_scope = ?
    WHERE rank = 'Lieutenant'
  `).run(JSON.stringify(permissions), questScope)
}

test('quest reviewer audiences respect active membership, capability, quest scope, and exclusions', () => withHttpApp(async () => {
  withGuildTransaction((db) => {
    setLieutenantScope(db, { permissions: ['rewards.issue'], questScope: 'own' })

    const officerOwnedQuest = {
      id: 'quest-officer',
      createdByMemberId: memberIds.officer,
    }
    let reviewers = questReviewerMemberIdsInDatabase(db, officerOwnedQuest)
    assert.deepEqual(reviewers.sort(), [memberIds.officer, memberIds.owner].sort())

    const ownerOwnedQuest = {
      id: 'quest-owner',
      createdByMemberId: memberIds.owner,
    }
    reviewers = questReviewerMemberIdsInDatabase(db, ownerOwnedQuest)
    assert.deepEqual(reviewers, [memberIds.owner])

    setLieutenantScope(db, { permissions: ['rewards.issue'], questScope: 'all' })
    reviewers = questReviewerMemberIdsInDatabase(db, ownerOwnedQuest)
    assert.deepEqual(reviewers.sort(), [memberIds.officer, memberIds.owner].sort())

    reviewers = questReviewerMemberIdsInDatabase(db, ownerOwnedQuest, {
      excludeMemberIds: [memberIds.officer],
    })
    assert.deepEqual(reviewers, [memberIds.owner])

    reviewers = questReviewerMemberIdsInDatabase(db, ownerOwnedQuest, {
      permission: 'quests.create',
    })
    assert.deepEqual(reviewers, [memberIds.owner])

    db.prepare("UPDATE members SET status = 'departed' WHERE id = ?").run(memberIds.officer)
    reviewers = questReviewerMemberIdsInDatabase(db, ownerOwnedQuest)
    assert.deepEqual(reviewers, [memberIds.owner])
  })
}))
