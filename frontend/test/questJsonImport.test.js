import test from 'node:test'
import assert from 'node:assert/strict'

import {
  QuestImportError,
  buildQuestImportPrompt,
  importQuestJson,
} from '../src/Admin/questJsonImport.js'

function currentDocument() {
  return {
    version: 1,
    focusedQuestId: 'existing-featured',
    rewardPolicy: '',
    rewardLimits: {
      rep: { min: 0, max: 1000 },
      marks: { min: 0, max: 500 },
    },
    quests: [
      {
        id: 'existing-featured',
        publication: 'published',
        mode: 'rotating',
        title: 'Existing',
        summary: '',
        objectives: [],
        completed: false,
      },
    ],
  }
}

test('quest import appends fresh quests, features when requested, and strips assignments', () => {
  const result = importQuestJson(
    JSON.stringify({
      quests: [
        {
          id: 'ai-id-that-will-not-be-trusted',
          title: 'Launch Supplies',
          featured: true,
          publication: 'draft',
          mode: 'rotating',
          objectives: [
            {
              title: 'Gather ore',
              priority: 'High',
              completed: true,
              assignments: [
                {
                  memberId: 'someone',
                  name: 'Someone',
                },
              ],
              reward: {
                rep: 100,
                marks: 25,
                items: [{ name: 'Bag', quantity: 1 }],
              },
            },
          ],
        },
      ],
    }),
    currentDocument(),
  )

  assert.equal(result.importedCount, 1)
  assert.equal(result.document.quests.length, 2)

  const imported = result.document.quests[1]
  assert.notEqual(imported.id, 'ai-id-that-will-not-be-trusted')
  assert.equal(imported.publication, 'published')
  assert.equal(result.document.focusedQuestId, imported.id)
  assert.equal(imported.objectives[0].completed, false)
  assert.deepEqual(imported.objectives[0].assignments, [])
  assert.match(imported.objectives[0].reward.items[0].id, /^reward-item-/)
})

test('canonical focusedQuestId can select an imported quest while IDs are regenerated', () => {
  const result = importQuestJson(
    JSON.stringify({
      focusedQuestId: 'source-two',
      quests: [
        {
          id: 'source-one',
          title: 'One',
          publication: 'draft',
          objectives: [],
        },
        {
          id: 'source-two',
          title: 'Two',
          publication: 'draft',
          objectives: [],
        },
      ],
    }),
    currentDocument(),
  )

  const importedTwo = result.document.quests.find((quest) => quest.title === 'Two')

  assert.ok(importedTwo)
  assert.equal(importedTwo.publication, 'published')
  assert.equal(result.document.focusedQuestId, importedTwo.id)
})

test('multiple featured quests are rejected', () => {
  assert.throws(
    () =>
      importQuestJson(
        JSON.stringify({
          quests: [
            { title: 'One', featured: true },
            { title: 'Two', featured: true },
          ],
        }),
        currentDocument(),
      ),
    (error) =>
      error instanceof QuestImportError &&
      /Only one imported quest can be featured/.test(error.message),
  )
})

test('seed prompt reflects current reward limits and forbids member assignment', () => {
  const prompt = buildQuestImportPrompt(currentDocument().rewardLimits)

  assert.match(prompt, /Rep rewards must be 0 or between 0 and 1000/)
  assert.match(prompt, /Marks rewards must be 0 or between 0 and 500/)
  assert.match(prompt, /DO NOT assign guild members/)
  assert.match(prompt, /"featured": true/)
  assert.doesNotMatch(prompt, /GuildOS/i)
})
