import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { invalidateResources } from '../../../Api/resourceCache.js'
import { LiveUpdatesContext } from '../../../Live/liveUpdatesContext.js'
import { FIXTURE_DEADMINES_DETAIL, FIXTURE_DUNGEON_LIST, FIXTURE_WISHLIST } from '../__fixtures__/atlas.js'
import {
  THANES_PLAN,
  DEADMINES_PLAN_PROGRESS,
  DEADMINES_PLAN_PUBLISHED,
  DEADMINES_PLAN_READY,
  DEADMINES_PLAN_START,
  DEADMINES_PLAN_UNSYNCED,
  ULDAMAN_PLAN,
} from '../__fixtures__/questPlans.js'
import AtlasModalHost from '../AtlasModalHost.jsx'
import DungeonDetailModal from '../DungeonDetailModal.jsx'
import { BRICK, ROOK, Routed, mockApi, renderWithSession, resetHarness } from './harness.jsx'

// The Quests section's preparation checklist, from the planner's plan
// (GET /api/player/loot/dungeons/:id/plan). Plans in the fixtures come from
// the real planner over the checked-in catalog, for synthetic characters.

function api({ plan = DEADMINES_PLAN_START, detail = FIXTURE_DEADMINES_DETAIL, readiness = null } = {}) {
  return mockApi([
    { path: '/api/player/loot/dungeons/36', reply: () => detail },
    { path: '/api/player/loot/dungeons/36/plan', reply: (request) => (typeof plan === 'function' ? plan(request) : plan) },
    { path: '/api/player/loot/dungeons/36/readiness', reply: () => readiness || { status: 404, body: { error: 'not_found' } } },
    { path: /^\/api\/player\/wishlists\//, reply: () => FIXTURE_WISHLIST },
    { path: '/api/player/dungeon-runs', reply: () => ({ runs: [], comparisons: [], filters: {} }) },
  ])
}

function Quests(props) {
  return (
    <DungeonDetailModal instanceId={36} dungeons={FIXTURE_DUNGEON_LIST} character={ROOK} characters={[ROOK, BRICK]} section="quests" layout="page"
      onCharacter={() => {}} onNavigate={() => {}} onClose={() => {}} {...props} />
  )
}

const checklist = () => screen.findByRole('region', { name: 'Quest preparation for Rook' })
const step = (id) => document.querySelector(`[data-step="${id}"]`)

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return this.parentNode } })
})
beforeEach(() => resetHarness())
afterEach(() => vi.restoreAllMocks())

describe('the preparation checklist', () => {
  test('readiness, the next step, numbered quests and lettered parts', async () => {
    const calls = api()
    renderWithSession(<Quests />)
    const plan = await checklist()
    expect(plan.dataset.readiness).toBe('missing')
    expect(within(plan).getByText('0 of 5 collected · 3 to pick up · 2 waiting on an earlier quest')).toBeTruthy()
    expect(calls.find((call) => call.path.endsWith('/plan')).query.get('character')).toBe('char-1')

    const next = within(plan).getByRole('region', { name: 'Next step' })
    expect(next.textContent).toContain('Next · step 1a')
    expect(next.textContent).toContain('Go to Wilder Thistlenettle in Stormwind City (65.4, 21.2)')
    const map = within(next).getByRole('link', { name: /View Wilder Thistlenettle on the world map/ })
    expect(map.getAttribute('href')).toBe('/map?zone=1453&mark=0.6544%2C0.2121&label=Wilder+Thistlenettle')
    expect(within(next).getByText('unverified').getAttribute('title')).toContain('not checked on Forever')

    // Step 4: the Defias Brotherhood chain, lettered under its quest.
    const defias = step('collect:q166')
    expect(defias.textContent).toContain('6-quest chain')
    expect(within(defias).getByText('a.')).toBeTruthy()
    expect(within(defias).getAllByText(/The Defias Brotherhood — Gryan Stoutmantle/, { selector: '.gw-qplan__text' })).toHaveLength(3)
    // Blocked links say what they wait on.
    expect(step('collect:q132').textContent).toContain('Waits on step 4a.')
    // The shared chain: step 5 points at it.
    expect(step('collect:q214').textContent).toContain('Waits on step 4f.')
    // The current step stands out.
    expect(step('collect:q168:travel').getAttribute('aria-current')).toBe('step')
  })

  test('quest chains expand and collapse from the keyboard; Expand all opens every step', async () => {
    api()
    renderWithSession(<Quests />)
    await checklist()
    const defias = step('collect:q166')
    const toggle = within(defias).getByRole('button', { name: 'Hide steps' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(within(defias).getByRole('button', { name: /Show 8 steps/ }).getAttribute('aria-expanded')).toBe('false')
    expect(step('collect:q132')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(step('collect:q132')).toBeTruthy()
  })

  test('accepted and completed quests are quiet; turn-ins come after the run', async () => {
    api({ plan: DEADMINES_PLAN_PROGRESS })
    renderWithSession(<Quests />)
    await checklist()
    expect(step('collect:q168').textContent).toContain('In quest log')
    expect(step('collect:q168').className).toContain('gw-qplan__item--done')
    expect(step('collect:q2040').textContent).toContain('Completed')
    const after = screen.getByRole('region', { name: 'After the run' })
    expect(after.textContent).toContain('Turn in Collecting Memories')
    // The catalog has no quest enders: no invented turn-in spot.
    expect(within(after).queryByRole('link')).toBeNull()
  })

  test('sharing is offered as an alternative, never as a fact about the group', async () => {
    api()
    renderWithSession(<Quests />)
    const share = await screen.findByRole('region', { name: 'Or ask your group to share' })
    expect(share.textContent).toContain('Guildweaver cannot see other players\' quest logs')
    expect(share.textContent).toContain('Sharing saves the trip to Wilder Thistlenettle in Stormwind City.')
    expect(share.textContent).toContain('(if nobody can share)')
  })

  test('published editorial data: the turn-in spot, notes and shareability', async () => {
    api({ plan: DEADMINES_PLAN_PUBLISHED })
    renderWithSession(<Quests />)
    await checklist()
    const after = screen.getByRole('region', { name: 'After the run' })
    const map = within(after).getByRole('link', { name: /Synthetic turn-in NPC/ })
    expect(map.getAttribute('href')).toContain('zone=1453')
    // Checked by the editors: no "unverified" next to it.
    expect(within(after).queryByText('unverified')).toBeNull()
    expect(screen.getByRole('region', { name: /^Enter/ }).textContent).toContain('Synthetic: meet your group at the Moonbrook entrance.')
    expect(screen.queryByRole('region', { name: 'Or ask your group to share' })?.textContent || '').not.toContain('Red Silk Bandanas')
    expect(screen.getByText(/notes from the Guildweaver editors/)).toBeTruthy()
  })

  test('ready: says so and points at the entrance', async () => {
    api({ plan: DEADMINES_PLAN_READY })
    renderWithSession(<Quests />)
    const plan = await checklist()
    expect(plan.dataset.readiness).toBe('ready')
    const next = within(plan).getByRole('region', { name: 'Next step' })
    expect(next.textContent).toContain('Go to the entrance in Westfall')
    expect(within(next).getByRole('link').getAttribute('href')).toContain('zone=1436')
  })

  test('nothing synced: nothing is marked done, and it says how to sync', async () => {
    api({ plan: DEADMINES_PLAN_UNSYNCED })
    renderWithSession(<Quests />)
    const plan = await checklist()
    expect(plan.textContent).toContain('No quest data synced for Rook yet')
    expect(plan.textContent).toContain('Sync quest data to get a next step.')
    expect(plan.querySelectorAll('.gw-qplan__item--done')).toHaveLength(0)
  })

  test('stale and incomplete quest data are called out', async () => {
    const old = new Date(Date.now() - 40 * 3600 * 1000).toISOString()
    api({ plan: { ...DEADMINES_PLAN_START, character: { capturedAt: old, receivedAt: old, completedCoverage: 'none', questLogCoverage: 'full' } } })
    renderWithSession(<Quests />)
    const plan = await checklist()
    expect(plan.textContent).toContain('may be out of date')
    expect(plan.textContent).toContain('The game did not report which quests were completed')
  })

  test('optional and repeatable quests are folded away; a long plan folds what is done', async () => {
    const done = structuredClone(ULDAMAN_PLAN)
    // Mark one collect quest done the way the planner does, to see it fold.
    const collect = done.sections.find((section) => section.key === 'collect')
    const quest = collect.steps.find((entry) => entry.kind === 'quest' && entry.status === 'todo' && !entry.children.some((child) => child.id === done.next))
    Object.assign(quest, { status: 'done', text: `${quest.text.replace(/^Get /, '')}: completed`, children: [], collapsed: true })
    mockApi([
      { path: '/api/player/loot/dungeons/70', reply: () => ({ ...FIXTURE_DEADMINES_DETAIL, instance: { instanceId: 70, name: 'Uldaman' }, atlas: { quests: [] } }) },
      { path: '/api/player/loot/dungeons/70/plan', reply: () => done },
      { path: /^\/api\/player\/wishlists\//, reply: () => FIXTURE_WISHLIST },
    ])
    renderWithSession(<Quests instanceId={70} dungeons={[]} />)
    await checklist()
    expect(screen.getByText(/1 already collected/).closest('details').open).toBe(false)
    // Only the item holding the next step is open.
    const open = screen.getAllByRole('button', { name: 'Hide steps' })
    expect(open).toHaveLength(1)
    expect(open[0].closest('.gw-qplan__item').className).toContain('contains-next')
    expect(screen.getByText('Optional quests').closest('details').open).toBe(false)
    expect(screen.getByText('Repeatable quests').closest('details').open).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryAllByRole('button', { name: 'Hide steps' })).toHaveLength(0)
  })

  test('quest facts and rewards stay one click away, not a second checklist', async () => {
    api()
    renderWithSession(<Quests />)
    await checklist()
    const details = screen.getByText('Quest details and rewards').closest('details')
    expect(details.open).toBe(false)
    // The old readiness groups are not drawn beside the plan.
    expect(screen.queryByText('Pick up before you go')).toBeNull()
  })

  test('a new upload refreshes the checklist in place (the player topic)', async () => {
    let reply = DEADMINES_PLAN_START
    const listeners = new Set()
    const live = { status: 'open', subscribe: (next) => { listeners.add(next); return () => listeners.delete(next) } }
    api({ plan: () => reply })
    renderWithSession(<LiveUpdatesContext.Provider value={live}><Quests /></LiveUpdatesContext.Provider>)
    expect((await checklist()).dataset.readiness).toBe('missing')
    reply = DEADMINES_PLAN_READY
    act(() => {
      invalidateResources(['player'])
      listeners.forEach((listener) => listener({ topics: ['player'], source: 'player.sync' }))
    })
    await waitFor(() => expect(document.querySelector('.gw-qplan').dataset.readiness).toBe('ready'))
  })

  test('switching character asks for that character\'s plan', async () => {
    const calls = api({ plan: (request) => (request.query.get('character') === 'char-2' ? DEADMINES_PLAN_UNSYNCED : DEADMINES_PLAN_START) })
    function Switcher() {
      const [character, setCharacter] = useState(ROOK)
      return <Quests character={character} onCharacter={(id) => setCharacter(id === 'char-2' ? BRICK : ROOK)} />
    }
    renderWithSession(<Switcher />)
    await checklist()
    fireEvent.change(screen.getByRole('combobox', { name: 'Character' }), { target: { value: 'char-2' } })
    expect(await screen.findByRole('region', { name: 'Quest preparation for Brick' })).toBeTruthy()
    expect(calls.filter((call) => call.path.endsWith('/plan')).map((call) => call.query.get('character'))).toEqual(['char-1', 'char-2'])
  })

  test('without a character there is no plan request, only the quest list', async () => {
    const calls = api()
    renderWithSession(<Quests character={null} characters={[]} />)
    expect(await screen.findByText(/Choose a character to get a preparation checklist/)).toBeTruthy()
    expect(calls.some((call) => call.path.endsWith('/plan'))).toBe(false)
  })
})

describe('realm isolation', () => {
  test('only the server\'s own character is planned for, even with a same-named one elsewhere', async () => {
    const other = { ...ROOK, id: 'char-9', realm: 'Elsewhere' }
    const calls = api()
    resetHarness('?server=us%3Afixture&open=36&section=quests')
    renderWithSession(<Routed>{(query) => <AtlasModalHost server="us:fixture" queryString={query} characters={[other, ROOK]} layout="page" />}</Routed>)
    await checklist()
    expect(calls.filter((call) => call.path.endsWith('/plan')).map((call) => call.query.get('character'))).toEqual(['char-1'])
  })
})

describe('presentation polish', () => {
  test('a reason many steps share is said once, above them', async () => {
    api({ plan: THANES_PLAN })
    renderWithSession(<Quests />)
    await checklist()
    const collect = screen.getByRole('region', { name: /^Collect before you go/ })
    expect(collect.querySelectorAll('.gw-qplan__note--unknown')).toHaveLength(1)
    expect(collect.querySelector('.gw-qplan__note--unknown').textContent).toBe('5 steps · Not known: its quest chain is not known.')
    expect(collect.querySelectorAll('.gw-qplan__item > .gw-qplan__why')).toHaveLength(0)
  })

  test('a next step from old or incomplete data is a suggestion, and says so', async () => {
    const old = new Date(Date.now() - 40 * 3600 * 1000).toISOString()
    api({ plan: { ...DEADMINES_PLAN_START, character: { capturedAt: old, receivedAt: old, completedCoverage: 'full', questLogCoverage: 'full' } } })
    renderWithSession(<Quests />)
    const next = await screen.findByRole('region', { name: 'Next step' })
    expect(next.textContent).toContain('Suggested next · step 1a')
    expect(next.textContent).toContain('From incomplete quest data')
    resetHarness()
    api()
    renderWithSession(<Quests />)
    const confirmed = await screen.findByRole('region', { name: 'Next step' })
    expect(confirmed.textContent).toContain('Next · step 1a')
    expect(confirmed.textContent).not.toContain('Suggested')
  })

  test('quests a higher level opens are listed with that level, not hidden', async () => {
    const readiness = { readiness: 'missing', required: 5, counts: {}, quests: [
      { questId: 2040, name: 'Underground Assault', state: 'ineligible', reasons: ['level-below-minimum'], minLevel: 22, relevance: 'dungeon' },
      { questId: 9, name: 'Other faction', state: 'ineligible', reasons: ['faction'], minLevel: 10, relevance: 'dungeon' },
    ], optional: [], prerequisites: [], repeatable: [], questList: 'curated', character: null }
    api({ readiness })
    renderWithSession(<Quests />)
    await checklist()
    const later = await screen.findByText('Available at a higher level')
    const block = later.closest('details')
    expect(block.textContent).toContain('Underground Assault')
    expect(block.textContent).toContain('From level 22 · Rook is 20')
    expect(block.textContent).not.toContain('Other faction')
  })

  test('entering is not a quest requirement, and the times read clearly', async () => {
    const read = new Date(Date.now() - 3 * 3600 * 1000).toISOString()
    const sent = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    api({ plan: { ...DEADMINES_PLAN_START, character: { capturedAt: read, receivedAt: sent, completedCoverage: 'full', questLogCoverage: 'full' } } })
    renderWithSession(<Quests />)
    const plan = await checklist()
    expect(screen.getByRole('region', { name: /^Enter/ }).textContent).toContain('not what the game requires to enter')
    expect(plan.textContent).toMatch(/Quest log read in game 3h ago, uploaded 5m ago\./)
  })
})

