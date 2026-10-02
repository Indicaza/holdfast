import assert from 'node:assert/strict'
import test from 'node:test'

import {
  QuestImportError,
  buildQuestImportPrompt,
  importQuestJson,
} from '../src/Quests/questJsonImport.js'

function workspace() {
  return {
    version: 1,
    revision: 7,
    focusedQuestId: '',
    rewardPolicy: '',
    rewardLimits: {
      rep: { min: 0, max: 500 },
      marks: { min: 0, max: 50 },
      marksPerQuestMax: 75,
    },
    quests: [
      {
        id: 'existing-quest',
        publication: 'published',
        mode: 'rotating',
        title: 'Existing Quest',
        summary: '',
        createdByMemberId: 'someone-else',
        createdAt: '2026-10-01T00:00:00.000Z',
        objectives: [],
        completed: false,
      },
    ],
  }
}

function quest(overrides = {}) {
  return {
    id: 'ai-quest-id',
    title: 'Gather the Goods',
    summary: 'Stock the guild bank.',
    publication: 'draft',
    mode: 'rotating',
    completed: true,
    objectives: [
      {
        id: 'ai-objective-id',
        title: 'Bring ore',
        description: 'Gather useful ore.',
        priority: 'High',
        completed: true,
        need: 'Copper Ore',
        reward: {
          rep: 100,
          marks: 10,
          items: [
            {
              id: 'ai-item-id',
              name: 'Bag',
              quantity: 1,
            },
          ],
        },
        assignments: [
          {
            memberId: 'fake-member',
            name: 'Invented Person',
            initials: 'IP',
          },
        ],
      },
    ],
    ...overrides,
  }
}

test('import regenerates IDs and strips AI-owned server/member state', () => {
  const result = importQuestJson(JSON.stringify(quest()), workspace(), {
    memberId: 'creator-one',
  })
  const imported = result.document.quests[1]
  const objective = imported.objectives[0]

  assert.notEqual(imported.id, 'ai-quest-id')
  assert.notEqual(objective.id, 'ai-objective-id')
  assert.notEqual(objective.reward.items[0].id, 'ai-item-id')
  assert.equal(imported.createdByMemberId, 'creator-one')
  assert.equal(imported.completed, false)
  assert.equal(objective.completed, false)
  assert.deepEqual(objective.assignments, [])
  assert.deepEqual(objective.rewardApproval, {
    approvedByMemberId: '',
    approvedByName: '',
    approvedAt: '',
    fingerprint: '',
  })
})

test('import appends quests and never replaces existing workspace state', () => {
  const current = workspace()
  const result = importQuestJson(
    JSON.stringify([quest(), quest({ title: 'Second' })]),
    current,
    { memberId: 'creator-one' },
  )

  assert.equal(result.document.quests.length, 3)
  assert.equal(result.document.quests[0].id, 'existing-quest')
  assert.equal(result.importedCount, 2)
})

test('published quests require publish authority', () => {
  assert.throws(
    () =>
      importQuestJson(
        JSON.stringify(quest({ publication: 'published' })),
        workspace(),
        { memberId: 'creator-one' },
      ),
    (error) =>
      error instanceof QuestImportError &&
      /current authority can only import drafts/.test(error.message),
  )

  assert.doesNotThrow(() =>
    importQuestJson(
      JSON.stringify(quest({ publication: 'published' })),
      workspace(),
      { memberId: 'creator-one', canPublish: true },
    ),
  )
})

test('featured import requires All publish scope and publishes the quest', () => {
  const featured = quest({ featured: true })

  assert.throws(
    () =>
      importQuestJson(JSON.stringify(featured), workspace(), {
        memberId: 'creator-one',
        canPublish: true,
        canFeature: false,
      }),
    (error) =>
      error instanceof QuestImportError && /All publish scope/.test(error.message),
  )

  const result = importQuestJson(JSON.stringify(featured), workspace(), {
    memberId: 'creator-one',
    canPublish: true,
    canFeature: true,
  })
  const imported = result.document.quests[1]

  assert.equal(imported.publication, 'published')
  assert.equal(result.document.focusedQuestId, imported.id)
  assert.equal(result.featuredTitle, imported.title)
})

test('canonical focusedQuestId may select one imported source quest', () => {
  const payload = {
    focusedQuestId: 'source-two',
    quests: [
      quest({ id: 'source-one', title: 'One' }),
      quest({ id: 'source-two', title: 'Two' }),
    ],
  }
  const result = importQuestJson(JSON.stringify(payload), workspace(), {
    memberId: 'creator-one',
    canPublish: true,
    canFeature: true,
  })

  assert.equal(result.featuredTitle, 'Two')
  assert.equal(result.document.quests[2].publication, 'published')
  assert.equal(result.document.focusedQuestId, result.document.quests[2].id)
})

test('multiple featured quests are rejected', () => {
  const payload = [
    quest({ title: 'One', featured: true }),
    quest({ title: 'Two', featured: true }),
  ]

  assert.throws(
    () =>
      importQuestJson(JSON.stringify(payload), workspace(), {
        memberId: 'creator-one',
        canPublish: true,
        canFeature: true,
      }),
    (error) =>
      error instanceof QuestImportError && /Only one imported quest/.test(error.message),
  )
})

test('per-objective and per-quest reward caps are enforced locally', () => {
  const tooMuchRep = quest()
  tooMuchRep.objectives[0].reward.rep = 501

  assert.throws(
    () => importQuestJson(JSON.stringify(tooMuchRep), workspace()),
    (error) =>
      error instanceof QuestImportError && /between 0 and 500/.test(error.message),
  )

  const tooManyMarks = quest({
    objectives: [
      {
        title: 'One',
        priority: 'High',
        reward: { rep: 0, marks: 40, items: [] },
      },
      {
        title: 'Two',
        priority: 'High',
        reward: { rep: 0, marks: 40, items: [] },
      },
    ],
  })

  assert.throws(
    () => importQuestJson(JSON.stringify(tooManyMarks), workspace()),
    (error) =>
      error instanceof QuestImportError && /75 Marks per quest/.test(error.message),
  )
})

test('seed prompt reflects live economy limits and caller authority', () => {
  const draftPrompt = buildQuestImportPrompt(workspace().rewardLimits)
  assert.match(draftPrompt, /between 0 and 500/)
  assert.match(draftPrompt, /between 0 and 50 per objective/)
  assert.match(draftPrompt, /cannot exceed 75/)
  assert.match(draftPrompt, /"draft" only/)
  assert.doesNotMatch(draftPrompt, /featured": true/)

  const officerPrompt = buildQuestImportPrompt(workspace().rewardLimits, {
    canPublish: true,
    canFeature: true,
  })
  assert.match(officerPrompt, /"draft" or "published"/)
  assert.match(officerPrompt, /featured": true/)
  assert.match(officerPrompt, /Do not assign guild members/)
})
