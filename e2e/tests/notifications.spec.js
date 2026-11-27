import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

async function session(browser, persona) {
  const context = await browser.newContext()
  await authenticate(context, persona)
  return { context, page: await context.newPage() }
}

async function json(context, route, options) {
  const response = await context.request.fetch(route, options)
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json()
}

async function markAllRead(context) {
  await json(context, '/api/notifications/read-all', { method: 'POST' })
}

test('personal updates appear in the navbar inbox and read state survives reload', async ({ browser }) => {
  const member = await session(browser, 'member')
  const leader = await session(browser, 'commander')
  const original = (await json(member.context, '/api/guild/members/e2e-member')).member.rank
  const target = original === 'Corporal' ? 'Sergeant' : 'Corporal'

  try {
    await markAllRead(member.context)
    await json(leader.context, '/api/guild/members/manage/e2e-member/rank', {
      method: 'PATCH',
      data: { rank: target },
    })

    await member.page.goto('/quests')
    const bell = member.page.locator('.notification-bell__button')
    await expect(bell).toHaveAttribute('aria-label', /unread/)
    await bell.click()

    const panel = member.page.locator('.notification-bell__panel')
    await expect(panel).toBeVisible()
    const rankItem = panel.locator('.notification-bell__item').filter({ hasText: 'Rank changed' })
    await expect(rankItem).toContainText(`Your Holdfast rank is now ${target}.`)

    await panel.getByRole('button', { name: 'Mark all read', exact: true }).click()
    await expect(bell).toHaveAttribute('aria-label', 'Notifications')

    await member.page.keyboard.press('Escape')
    await expect(member.page.locator('.notification-bell__panel')).toHaveCount(0)

    await member.page.reload()
    await expect(member.page.locator('.notification-bell__button')).toHaveAttribute('aria-label', 'Notifications')
  } finally {
    await json(leader.context, '/api/guild/members/manage/e2e-member/rank', {
      method: 'PATCH',
      data: { rank: original },
    })
    await markAllRead(member.context)
    await member.context.close()
    await leader.context.close()
  }
})

test('action notifications show Needs you, become Handled after another workflow action, and do not leak into the closed DOM', async ({ browser }) => {
  const member = await session(browser, 'member')
  const leader = await session(browser, 'commander')
  const questId = 'e2e-notification-review'
  const objectiveId = 'e2e-notification-review-objective'
  const objectiveTitle = 'Notification browser objective'

  try {
    await markAllRead(leader.context)
    let workspace = await json(leader.context, '/api/quests/manage')
    workspace.quests = workspace.quests.filter((quest) => quest.id !== questId)
    const source = structuredClone(workspace.quests.find((quest) => quest.id === 'e2e-supply-run'))
    source.id = questId
    source.title = 'Notification browser quest'
    source.createdByMemberId = 'e2e-commander'
    source.objectives = [structuredClone(source.objectives.find((objective) => objective.id === 'e2e-patrol'))]
    source.objectives[0].id = objectiveId
    source.objectives[0].title = objectiveTitle
    source.objectives[0].assignments = []
    source.objectives[0].completed = false
    workspace.quests.push(source)
    await json(leader.context, '/api/quests/manage', { method: 'PUT', data: workspace })

    await json(member.context, '/api/quests/member/signup', {
      method: 'POST',
      data: { questId, objectiveId },
    })
    await json(member.context, '/api/quests/member/request-completion', {
      method: 'POST',
      data: { questId, objectiveId },
    })

    await leader.page.goto('/quests')
    const bell = leader.page.locator('.notification-bell__button')
    await bell.click()
    let panel = leader.page.locator('.notification-bell__panel')
    const action = panel.locator('.notification-bell__item').filter({ hasText: objectiveTitle })
    await expect(action).toContainText('Needs you')

    await json(leader.context, '/api/quests/manage/review-completion', {
      method: 'POST',
      data: {
        questId,
        objectiveId,
        decision: 'rejected',
        note: 'Browser notification round-trip.',
      },
    })

    await leader.page.keyboard.press('Escape')
    await expect(leader.page.locator('.notification-bell__panel')).toHaveCount(0)
    await bell.click()
    panel = leader.page.locator('.notification-bell__panel')
    await expect(panel.locator('.notification-bell__item').filter({ hasText: objectiveTitle })).toContainText('Handled')

    await leader.page.keyboard.press('Escape')
    await expect(leader.page.locator('.notification-bell__panel')).toHaveCount(0)
    await expect(leader.page.locator('.notification-bell').getByText(objectiveTitle, { exact: true })).toHaveCount(0)
  } finally {
    const latest = await json(leader.context, '/api/quests/manage')
    latest.quests = latest.quests.filter((quest) => quest.id !== questId)
    await json(leader.context, '/api/quests/manage', { method: 'PUT', data: latest })
    await markAllRead(member.context)
    await markAllRead(leader.context)
    await member.context.close()
    await leader.context.close()
  }
})
