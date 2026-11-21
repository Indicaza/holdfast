import { expect, test } from '@playwright/test'

import { authenticate } from '../helpers/auth.js'
import { connectAndSync } from '../helpers/player.js'

// The dungeon quest preparation checklist on the website, against the real
// backend: the planner (backend/src/Atlas/atlasQuestPlan.js) over the
// checked-in quest catalog, for a character whose quest state is uploaded
// the way the add-on sends it. Synthetic character, real quest data.

const REALM = 'E2E Quest Realm'
const CHARACTER = { id: 'Player-quest-planner-1', name: 'Questine', realm: REALM, level: 20 }
let revision = Math.floor(Date.now() / 1000)

// The add-on's quest_state stream for the character.
function questState({ completed = [], log = [] } = {}) {
  revision += 1
  return {
    streamKey: `quest_state:${CHARACTER.id}`, kind: 'state', revision,
    envelope: {
      schemaVersion: 1, eventType: 'quest_state', capturedAt: revision, characterId: CHARACTER.id, realm: REALM, region: 'US',
      installationId: 'e2e-quest-plan', payloadSchemaVersion: 1, gameBuild: { version: '1.60.1', build: '70959', interface: 16001 },
      payload: { schemaVersion: 1, capturedAt: revision, faction: 'alliance', race: 'Human', classToken: 'WARRIOR', level: 20,
        completed: { coverage: 'full', questIds: completed }, questLog: { coverage: 'full', entries: log.map((questId) => ({ questId, isComplete: false })) } },
    },
  }
}

// One computer for the whole file (pairing is rate limited): later uploads reuse its key.
let deviceToken = null
async function upload(page, telemetry, characters = []) {
  const result = await connectAndSync(page, { deviceName: 'Quest planner PC', characters, telemetry, deviceToken })
  deviceToken = result.deviceToken
}

async function signIn(page, context, state = {}) {
  await authenticate(context, 'questPlanner')
  await page.goto('/dashboard/dungeons')
  await upload(page, [questState(state)], deviceToken ? [] : [CHARACTER])
}

const quests = (page) => page.getByRole('region', { name: 'Quest preparation for Questine' })

test('Deadmines: follow the checklist from a deep link, to the map and back', async ({ page, context }) => {
  await signIn(page, context, { completed: [2040] })
  await page.goto('/dashboard/dungeons?open=36&section=quests')
  const plan = quests(page)
  await expect(plan).toHaveAttribute('data-readiness', 'missing')
  await expect(plan).toContainText('1 of 5 collected')
  await expect(plan.getByRole('region', { name: 'Next step' })).toContainText('Wilder Thistlenettle')
  // Completed quests are marked from the synced data.
  await expect(plan.locator('[data-step="collect:q2040"]')).toContainText('Completed')
  // The Defias Brotherhood chain sits under its quest.
  await expect(plan.locator('[data-step="collect:q166"]')).toContainText('6-quest chain')

  const map = plan.getByRole('region', { name: 'Next step' }).getByRole('link', { name: /View Wilder Thistlenettle on the world map/ })
  await map.click()
  await expect(page).toHaveURL(/\/map\?.*zone=1453/)
  await expect(page.getByRole('button', { name: 'Wilder Thistlenettle (marked spot)' })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/open=36&section=quests/)
  await expect(quests(page)).toBeVisible()
})

test('a new quest upload updates the open checklist without a reload', async ({ page, context }) => {
  await signIn(page, context)
  await page.goto('/dashboard/dungeons?open=36&section=quests')
  const plan = quests(page)
  await expect(plan).toContainText('0 of 5 collected')
  // A flag on the page: it is still there if nothing reloaded.
  await page.evaluate(() => { window.__noReload = true })
  // The add-on syncs again: the character picked up three quests.
  await upload(page, [questState({ log: [167, 168, 2040] })])
  await expect(plan).toContainText('3 of 5 collected', { timeout: 15_000 })
  await expect(plan.locator('[data-step="collect:q168"]')).toContainText('In quest log')
  expect(await page.evaluate(() => window.__noReload)).toBe(true)
})

test('The Hall of Thanes: unknown chains and givers are said, never guessed', async ({ page, context }) => {
  await signIn(page, context)
  await page.goto('/dashboard/dungeons?open=3065&section=quests')
  const plan = quests(page)
  await expect(plan).toHaveAttribute('data-readiness', 'unknown')
  await expect(plan).toContainText('its quest chain is not known')
  await expect(plan).toContainText('Quest giver not in our data')
  // The only map link is the dungeon entrance the atlas knows.
  const links = plan.getByRole('link', { name: /on the world map/ })
  await expect(links).toHaveCount(1)
  await expect(links.first()).toHaveAttribute('href', /zone=1455/)
})

test('on a phone the checklist fits the screen', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, context)
  await page.goto('/dashboard/dungeons?open=36&section=quests')
  await expect(quests(page)).toBeVisible()
  await expect(quests(page).getByRole('region', { name: 'Next step' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
})
