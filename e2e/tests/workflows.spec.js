import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

async function json(context, route, options) {
  const response = await context.request.fetch(route, options)
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

async function session(browser, persona) {
  const context = await browser.newContext()
  await authenticate(context, persona)
  return { context, page: await context.newPage() }
}

async function removeTestQuests(context) {
  const workspace = await json(context, '/api/quests/manage')
  workspace.quests = workspace.quests.filter((quest) => !quest.title.startsWith('Guardrail '))
  await json(context, '/api/quests/manage', { method: 'PUT', data: workspace })
}

async function createDraft(page, title) {
  await page.goto('/quests')
  await page.getByRole('button', { name: 'Create quest', exact: true }).first().click()
  await page.getByLabel('Quest title').fill(title)
  await page.getByRole('dialog').getByRole('button', { name: 'Create quest', exact: true }).click()
  await expect(page.getByText('Quest created.')).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
}

async function manage(page, title) {
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await page.getByRole('button', { name: 'Manage quest' }).click()
}

test('profile edits survive reload and a failed save can be retried', async ({ browser }) => {
  const { context, page } = await session(browser, 'member')
  const original = (await json(context, '/api/guild/members/me')).member.profile
  try {
    await page.goto('/members/e2e-member')
    await page.getByRole('button', { name: 'Edit profile', exact: true }).first().click()
    await page.getByLabel('BattleTag', { exact: true }).fill('Guardrail#0042')
    await page.getByRole('textbox', { name: 'About', exact: true }).fill('Guardrail profile saved in the browser.')
    await page.route('**/api/guild/members/me', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporary_failure"}' })
      } else await route.continue()
    })
    await page.getByRole('button', { name: 'Save profile' }).click()
    await expect(page.getByText('Could not save your member profile. Try again.')).toBeVisible()
    expect((await json(context, '/api/guild/members/me')).member.profile).toEqual(original)
    await page.unroute('**/api/guild/members/me')
    await page.getByRole('button', { name: 'Save profile' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.reload()
    await expect(page.getByText('Guardrail profile saved in the browser.')).toBeVisible()
    await expect(page.getByText('Guardrail#0042')).toBeVisible()
  } finally {
    await json(context, '/api/guild/members/me', { method: 'PATCH', data: { profile: original } })
    await context.close()
  }
})

test('leadership can persist promotions and toggle a billet assignment', async ({ browser }) => {
  const { context, page } = await session(browser, 'commander')
  const original = (await json(context, '/api/guild/members/e2e-member')).member.rank
  const { billet } = await json(context, '/api/guild/billets', { method: 'POST', data: { name: 'Guardrail Supply Lead', responsibility: 'Browser workflow fixture' } })
  try {
    await page.goto('/ranks')
    await page.getByRole('button', { name: 'Edit authority for Guardrail Supply Lead', exact: true }).click()
    await page.getByRole('checkbox', { name: /^Create quests/ }).check()
    await page.getByRole('button', { name: 'Save authority', exact: true }).click()
    await expect.poll(async () => (await json(context, '/api/guild/authority')).billets.find((scope) => scope.id === billet.id).permissions).toContain('quests.create')
    await page.goto('/members/e2e-member')
    const rank = page.getByLabel('Rank for Mira Member')
    await rank.selectOption('Sergeant')
    await expect(page.getByText(/Saved\./)).toBeVisible()
    await page.reload()
    await expect(rank).toHaveValue('Sergeant')
    await page.locator('.member-billet-control summary').click()
    const assignment = page.getByRole('checkbox', { name: /Guardrail Supply Lead/ })
    await assignment.click()
    await expect(assignment).toBeChecked()
    await expect.poll(async () => (await json(context, '/api/guild/members/e2e-member')).member.billets.map((item) => item.id)).toContain(billet.id)
    await page.reload()
    await page.locator('.member-billet-control summary').click()
    await expect(assignment).toBeChecked()
    await assignment.click()
    await expect.poll(async () => (await json(context, '/api/guild/members/e2e-member')).member.billets.map((item) => item.id)).not.toContain(billet.id)
  } finally {
    await json(context, `/api/guild/members/manage/e2e-member/billets/${billet.id}`, { method: 'DELETE' })
    await json(context, `/api/guild/billets/${billet.id}`, { method: 'DELETE' })
    await json(context, '/api/guild/members/manage/e2e-member/rank', { method: 'PATCH', data: { rank: original } })
    await context.close()
  }
})

test('quest content, publication, archive, and deletion survive reloads', async ({ browser }) => {
  const { context, page } = await session(browser, 'commander')
  const title = 'Guardrail publishing lifecycle'
  try {
    await createDraft(page, title)
    await manage(page, title)
    await page.getByRole('textbox', { name: 'Summary', exact: true }).fill('Saved quest summary')
    await page.getByRole('combobox', { name: 'Publication', exact: true }).selectOption('published')
    await page.getByRole('button', { name: 'Save quest', exact: true }).click()
    await expect(page.getByText('Quest saved.')).toBeVisible()
    await page.reload()
    await manage(page, title)
    await expect(page.getByRole('textbox', { name: 'Summary', exact: true })).toHaveValue('Saved quest summary')
    await expect(page.getByRole('combobox', { name: 'Publication', exact: true })).toHaveValue('published')
    await page.getByRole('combobox', { name: 'Publication', exact: true }).selectOption('archived')
    await page.getByRole('button', { name: 'Save quest', exact: true }).click()
    await expect(page.getByText('Quest saved.')).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.reload()
    await expect(page.getByRole('button', { name: new RegExp(title) })).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption('all')
    await manage(page, title)
    await page.getByRole('button', { name: 'Delete quest', exact: true }).click()
    await page.getByRole('button', { name: 'Keep quest', exact: true }).click()
    await page.getByRole('button', { name: 'Delete quest', exact: true }).click()
    await page.getByRole('button', { name: 'Delete permanently', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.reload()
    expect((await json(context, '/api/quests/manage')).quests.some((quest) => quest.title === title)).toBe(false)
  } finally {
    await removeTestQuests(context)
    await context.close()
  }
})

test('invalid imports preserve the board and a corrected import persists', async ({ browser }) => {
  const { context, page } = await session(browser, 'commander')
  try {
    await page.goto('/quests')
    const before = await json(context, '/api/quests/manage')
    await page.getByRole('button', { name: 'AI / JSON', exact: true }).click()
    const input = page.getByRole('dialog').locator('textarea')
    await input.fill('{invalid')
    await page.getByRole('button', { name: 'Import & save' }).click()
    await expect(page.getByRole('dialog')).toContainText(/That is not valid JSON/)
    expect(await json(context, '/api/quests/manage')).toEqual(before)
    await input.fill(JSON.stringify({ quests: [{ title: 'Guardrail imported quest', summary: 'Imported through the browser', publication: 'draft', mode: 'rotating', objectives: [{ title: 'Imported objective', description: 'Bring supplies', priority: 'Medium', need: '1 volunteer', reward: { rep: 0, marks: 0, items: [] } }] }] }))
    await page.getByRole('button', { name: 'Import & save' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('button', { name: /Guardrail imported quest/ })).toBeVisible()
    const after = await json(context, '/api/quests/manage')
    expect(after.quests.length).toBe(before.quests.length + 1)
    expect(after.quests.find((quest) => quest.title === 'Guardrail imported quest').objectives[0].assignments).toEqual([])
  } finally {
    await removeTestQuests(context)
    await context.close()
  }
})

test('a stale editor cannot overwrite newer data and can reopen the current quest', async ({ browser }) => {
  const { context, page } = await session(browser, 'commander')
  const title = 'Guardrail concurrent edit'
  try {
    await createDraft(page, title)
    await manage(page, title)
    await page.getByRole('textbox', { name: 'Summary', exact: true }).fill('Stale browser draft')
    const workspace = await json(context, '/api/quests/manage')
    workspace.quests.find((quest) => quest.title === title).summary = 'Newer saved summary'
    await json(context, '/api/quests/manage', { method: 'PUT', data: workspace })
    await page.getByRole('button', { name: 'Save quest', exact: true }).click()
    await expect(page.getByText(/Someone changed the quest board first/)).toBeVisible()
    expect((await json(context, '/api/quests/manage')).quests.find((quest) => quest.title === title).summary).toBe('Newer saved summary')
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await manage(page, title)
    await expect(page.getByRole('textbox', { name: 'Summary', exact: true })).toHaveValue('Newer saved summary')
  } finally {
    await removeTestQuests(context)
    await context.close()
  }
})

test('rejected work explains the reason and can be resubmitted without a payout', async ({ browser }) => {
  const leader = await session(browser, 'commander')
  const member = await session(browser, 'member')
  const title = 'Guardrail review changes'
  try {
    const workspace = await json(leader.context, '/api/quests/manage')
    const source = structuredClone(workspace.quests.find((quest) => quest.id === 'e2e-supply-run'))
    source.id = 'guardrail-review'
    source.title = title
    source.createdByMemberId = 'e2e-commander'
    source.objectives = [structuredClone(source.objectives.find((objective) => objective.id === 'e2e-patrol'))]
    source.objectives[0].id = 'guardrail-review-objective'
    source.objectives[0].assignments = []
    workspace.quests.push(source)
    await json(leader.context, '/api/quests/manage', { method: 'PUT', data: workspace })
    await json(member.context, '/api/quests/member/signup', { method: 'POST', data: { questId: source.id, objectiveId: source.objectives[0].id } })
    await member.page.goto('/quests')
    await member.page.getByRole('button', { name: new RegExp(title) }).click()
    await member.page.getByRole('button', { name: 'Request completion', exact: true }).click()
    await expect(member.page.getByText('Ready for review', { exact: true })).toBeVisible()
    await leader.page.goto('/quests')
    await leader.page.getByRole('button', { name: new RegExp(title) }).click()
    await leader.page.getByRole('button', { name: 'Needs changes', exact: true }).click()
    await expect(leader.page.getByRole('button', { name: 'Send back', exact: true })).toBeDisabled()
    await leader.page.getByRole('textbox', { name: 'What needs to change?', exact: true }).fill('Scout the northern route too.')
    await leader.page.getByRole('button', { name: 'Send back', exact: true }).click()
    await expect(leader.page.getByText('Scout the northern route too.', { exact: true })).toBeVisible()
    await member.page.reload()
    await member.page.getByRole('button', { name: new RegExp(title) }).click()
    await expect(member.page.getByText('Scout the northern route too.', { exact: true })).toBeVisible()
    await member.page.getByRole('button', { name: 'Request review again', exact: true }).click()
    await expect(member.page.getByText('Ready for review', { exact: true })).toBeVisible()
    const after = await json(leader.context, '/api/quests/manage')
    expect(after.quests.find((quest) => quest.id === source.id).objectives[0].completed).toBe(false)
    const profile = await json(member.context, '/api/guild/members/me')
    expect(profile.member.activity.some((entry) => entry.objectiveId === 'guardrail-review-objective')).toBe(false)
  } finally {
    await removeTestQuests(leader.context)
    await member.context.close()
    await leader.context.close()
  }
})
