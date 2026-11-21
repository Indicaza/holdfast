import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { invalidateResources } from '../../../Api/resourceCache.js'
import { LiveUpdatesContext } from '../../../Live/liveUpdatesContext.js'
import { FIXTURE_DEADMINES_DETAIL, FIXTURE_DUNGEON_LIST, FIXTURE_WISHLIST } from '../__fixtures__/atlas.js'
import { readinessLine, readinessModel } from '../atlasModel.js'
import DungeonDetailModal from '../DungeonDetailModal.jsx'
import { BRICK, ROOK, mockApi, renderWithSession, resetHarness } from './harness.jsx'

// Sprint step 4B: the selected character's quest readiness, from the quest
// state the add-on synced (GET /api/player/loot/dungeons/:id/readiness).

const quest = (questId, name, state, extra = {}) => ({
  questId, name, relevance: 'dungeon', wing: null, state, reasons: [], level: 18, minLevel: 14, faction: 'alliance', repeatable: false,
  giver: null, startsFromItem: null, prerequisitesKnown: true, prerequisites: [], objectivesComplete: null, verifiedForForever: false, ...extra,
})

const CAPTURED = new Date(Date.now() - 2 * 3600 * 1000).toISOString()

const MISSING = {
  dungeon: { instanceId: 36, dungeonKey: 'deadmines' }, schemaVersion: 1, readiness: 'missing', required: 5,
  counts: { completed: 1, accepted: 1, available: 2, prerequisites: 1, ineligible: 0, unknown: 0 },
  quests: [
    quest(167, 'The Defias Brotherhood', 'completed'),
    quest(168, 'Collecting Memories', 'accepted', { objectivesComplete: true }),
    quest(2040, 'Underground Assault', 'available', { giver: { kind: 'npc', id: 6579, name: 'Shoni the Shilent', location: { zoneName: 'Stormwind City', mapId: 1453, x: 0.55, y: 0.12 } } }),
    quest(214, 'Red Silk Bandanas', 'available'),
    quest(166, 'The Defias Brotherhood (part 7)', 'prerequisites', { reasons: ['prerequisite:155'], prerequisites: [{ questId: 155, name: 'The Defias Brotherhood (part 6)', mustBeActive: false, status: 'missing' }] }),
  ],
  optional: [quest(9001, 'A Side Errand', 'available', { relevance: 'optional' })],
  prerequisites: [quest(155, 'The Defias Brotherhood (part 6)', 'available', { relevance: 'prerequisite' })],
  repeatable: [], unknownRelevance: [], questList: 'curated',
  character: { capturedAt: CAPTURED, receivedAt: CAPTURED, completedCoverage: 'full', questLogCoverage: 'full' },
  characterId: 'char-1',
}

const READY = {
  ...MISSING, readiness: 'ready', counts: { completed: 3, accepted: 2, available: 0, prerequisites: 0, ineligible: 0, unknown: 0 },
  quests: MISSING.quests.map((entry) => ({ ...entry, state: entry.questId === 168 || entry.questId === 2040 ? 'accepted' : 'completed', reasons: [] })),
  optional: [], prerequisites: [],
}

const NOT_SYNCED = {
  ...MISSING, readiness: 'unknown', counts: { completed: 0, accepted: 0, available: 0, prerequisites: 0, ineligible: 0, unknown: 5 },
  quests: MISSING.quests.map((entry) => ({ ...entry, state: 'unknown', reasons: ['completion-not-reported', 'quest-log-not-reported'] })),
  optional: [], prerequisites: [], character: null,
}

function api(readiness) {
  const calls = mockApi([
    { path: '/api/player/loot/dungeons/36', reply: () => FIXTURE_DEADMINES_DETAIL },
    { path: '/api/player/loot/dungeons/36/readiness', reply: (request) => (typeof readiness === 'function' ? readiness(request) : readiness) },
    { path: '/api/player/wishlists/char-1', reply: () => FIXTURE_WISHLIST },
    { path: '/api/player/wishlists/char-2', reply: () => ({ limit: 50, items: [] }) },
    { path: '/api/player/dungeon-runs', reply: () => ({ runs: [], comparisons: [], filters: {} }) },
  ])
  return calls
}

function Modal(props) {
  return (
    <DungeonDetailModal instanceId={36} dungeons={FIXTURE_DUNGEON_LIST} character={ROOK} characters={[ROOK, BRICK]}
      onCharacter={() => {}} onNavigate={() => {}} onClose={() => {}} {...props} />
  )
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return this.parentNode } })
})
beforeEach(() => resetHarness())
afterEach(() => vi.restoreAllMocks())

describe('readinessModel', () => {
  test('groups what to pick up first and counts only required quests', () => {
    const model = readinessModel(MISSING)
    expect(model.label).toBe('Quests to pick up')
    expect(model.groups.map((group) => group.id)).toEqual(['needed', 'blocked', 'accepted', 'chains', 'optional', 'completed'])
    expect(model.counts).toMatchObject({ required: 5, completed: 1, accepted: 1, needed: 2, blocked: 1 })
    expect(readinessLine(model)).toBe('1 of 5 required done · 1 in the quest log · 2 to pick up · 1 waiting on an earlier quest')
  })

  test('no list is not "no quests"; nothing synced is said; bad data gives nothing', () => {
    const none = readinessModel({ ...MISSING, readiness: 'none', quests: [], optional: [], prerequisites: [], questList: 'unknown' })
    expect(readinessLine(none)).toMatch(/That does not mean it has none/)
    expect(readinessModel(NOT_SYNCED).synced).toBe(false)
    expect(readinessModel({ readiness: 'sure' })).toBeNull()
    expect(readinessModel(null)).toBeNull()
  })

  test('Forever quests with unknown chains say so', () => {
    const forever = readinessModel({ ...NOT_SYNCED, quests: [quest(98423, 'The Treaty of Understanding', 'unknown', { prerequisitesKnown: false, reasons: ['prerequisites-not-known'] })] })
    expect(forever.chainsUnknown).toBe(true)
  })
})

describe('the modal', () => {
  test('overview: a short readiness summary with when the data was captured', async () => {
    const calls = api(MISSING)
    renderWithSession(<Modal section="overview" />)
    const summary = await screen.findByText('1 of 5 required done · 1 in the quest log · 2 to pick up · 1 waiting on an earlier quest')
    expect(summary.closest('[data-readiness]').dataset.readiness).toBe('missing')
    expect(screen.getByText(/^Quests as of .+, from the last sync: \/reload or log out in WoW to update\.$/)).toBeTruthy()
    const request = calls.find((call) => call.path === '/api/player/loot/dungeons/36/readiness')
    expect(request.query.get('character')).toBe('char-1')
  })

  test('quests tab: groups by state, with giver, location, chain and turn-in', async () => {
    api(MISSING)
    renderWithSession(<Modal section="quests" />)
    const needed = await screen.findByText('Pick up before you go')
    const group = needed.closest('[data-group]')
    expect(group.open).toBe(true)
    expect(within(group).getByText('Underground Assault')).toBeTruthy()
    expect(within(group).getByText(/From Shoni the Shilent, Stormwind City 55.0, 12.0/)).toBeTruthy()
    const blocked = screen.getByText('Needs an earlier quest first').closest('[data-group]')
    expect(within(blocked).getByText(/The Defias Brotherhood \(part 6\)/)).toBeTruthy()
    expect(within(blocked).getByText('(not done)')).toBeTruthy()
    expect(screen.getByText('Ready to turn in')).toBeTruthy()
    // Optional and completed quests are there but folded away.
    expect(screen.getByText('Optional quests').closest('[data-group]').open).toBe(false)
    expect(screen.getAllByText('Completed').find((element) => element.tagName === 'H4').closest('[data-group]').open).toBe(false)
    expect(screen.getByText('Quest details and rewards')).toBeTruthy()
  })

  test('an old Prepare link opens Quests, readiness first', async () => {
    api(MISSING)
    renderWithSession(<Modal section="prepare" />)
    await screen.findByText('Pick up before you go')
    expect(screen.getByRole('button', { name: 'Quests' })).toHaveProperty('ariaCurrent', 'page')
    expect(screen.queryByRole('button', { name: 'Prepare' })).toBeNull()
  })

  test('no quest data synced: says so and is never ready', async () => {
    api(NOT_SYNCED)
    renderWithSession(<Modal section="quests" />)
    expect(await screen.findByText(/No quest data synced for Rook yet/)).toBeTruthy()
    expect(document.querySelector('[data-readiness]').dataset.readiness).toBe('unknown')
    expect(screen.getAllByText(/Not known: quest data not synced/).length).toBe(5)
  })

  test('a new upload refreshes it (the player topic)', async () => {
    let reply = MISSING
    let listener = () => {}
    const live = { status: 'open', subscribe: (next) => { listener = next; return () => {} } }
    api(() => reply)
    renderWithSession(<LiveUpdatesContext.Provider value={live}><Modal section="overview" /></LiveUpdatesContext.Provider>)
    await screen.findByText(/2 to pick up/)
    reply = READY
    act(() => {
      invalidateResources(['player'])
      listener({ topics: ['player'], source: 'player.sync' })
    })
    await waitFor(() => expect(document.querySelector('[data-readiness]').dataset.readiness).toBe('ready'))
    expect(screen.getByText('3 of 5 required done · 2 in the quest log')).toBeTruthy()
  })

  test('switching character asks for the new character readiness', async () => {
    const calls = api((request) => (request.query.get('character') === 'char-2' ? NOT_SYNCED : MISSING))
    function Switcher() {
      const [character, setCharacter] = useState(ROOK)
      return <Modal section="overview" character={character} onCharacter={(id) => setCharacter(id === 'char-2' ? BRICK : ROOK)} />
    }
    renderWithSession(<Switcher />)
    await screen.findByText(/2 to pick up/)
    fireEvent.change(screen.getByRole('combobox', { name: 'Character' }), { target: { value: 'char-2' } })
    expect(await screen.findByText(/No quest data synced for Brick yet/)).toBeTruthy()
    expect(calls.filter((call) => call.path.endsWith('/readiness')).map((call) => call.query.get('character'))).toEqual(['char-1', 'char-2'])
  })

  test('without a character, no readiness is asked for', async () => {
    const calls = api(MISSING)
    renderWithSession(<Modal section="quests" character={null} characters={[]} />)
    await screen.findAllByText(/./)
    await waitFor(() => expect(calls.some((call) => call.path === '/api/player/loot/dungeons/36')).toBe(true))
    expect(calls.some((call) => call.path.endsWith('/readiness'))).toBe(false)
  })
})
