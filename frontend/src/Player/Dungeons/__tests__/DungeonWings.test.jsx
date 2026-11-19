import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { FIXTURE_DUNGEON_LIST } from '../__fixtures__/atlas.js'
import { FIXTURE_SM_DETAIL, FIXTURE_SM_DUNGEON, FIXTURE_SM_LIBRARY_DETAIL, FIXTURE_SM_WINGS } from '../__fixtures__/wings.js'
import AtlasModalHost from '../AtlasModalHost.jsx'
import DungeonExplore from '../DungeonExplore.jsx'
import { ROOK, Routed, mockApi, renderWithSession, resetHarness } from './harness.jsx'

const RUNS = [
  { id: 1, status: 'completed', startedAt: Math.floor(Date.now() / 1000) - 86400, durationSeconds: 1500, timer: { seconds: 1400 },
    dungeon: { name: 'Scarlet Monastery', instanceId: 189, dungeonKey: 'scarlet-monastery:library', wing: { dungeonKey: 'scarlet-monastery:library' } } },
  { id: 2, status: 'abandoned', startedAt: Math.floor(Date.now() / 1000) - 3600, durationSeconds: 600,
    dungeon: { name: 'Scarlet Monastery', instanceId: 189, dungeonKey: 'scarlet-monastery', wing: null } },
]

function api() {
  return mockApi([
    { path: '/api/player/loot/dungeons', reply: () => ({ dungeons: [...FIXTURE_DUNGEON_LIST, FIXTURE_SM_DUNGEON], atlasWings: FIXTURE_SM_WINGS }) },
    { path: /^\/api\/player\/loot\/dungeons\/scarlet-monastery(%3A|:)library$/, reply: () => FIXTURE_SM_LIBRARY_DETAIL },
    { path: '/api/player/loot/dungeons/189', reply: () => FIXTURE_SM_DETAIL },
    { path: /^\/api\/player\/loot\/dungeons\/[^/]+$/, reply: () => ({ status: 404, body: { error: 'not_found' } }) },
    { path: /^\/api\/player\/wishlists\/[^/]+$/, reply: () => ({ limit: 50, items: [] }) },
    { path: '/api/player/dungeon-runs', reply: (request) => ({ runs: request.query.get('character') === 'char-1' ? RUNS : [], comparisons: [], filters: {} }) },
  ])
}

function Page() {
  return (
    <Routed>
      {(query) => (
        <>
          <DungeonExplore queryString={query} characters={[ROOK]} />
          <AtlasModalHost queryString={query} characters={[ROOK]} />
        </>
      )}
    </Routed>
  )
}

beforeEach(() => resetHarness())
afterEach(() => vi.restoreAllMocks())

describe('dungeon wings', () => {
  test('each wing is its own card, linked by its key; the combined card is gone', async () => {
    api()
    renderWithSession(<Page />)
    const library = await screen.findByRole('link', { name: /^Scarlet Monastery — Library/ })
    expect(screen.getByRole('link', { name: /^Scarlet Monastery — Graveyard/ })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Scarlet Monastery$/ })).toBeNull()
    expect(library.getAttribute('href')).toContain('open=scarlet-monastery%3Alibrary')
    const card = library.closest('li')
    expect(card.textContent).toContain('Levels 32–40')
    // The wing's own runs only: the run that proved no wing is not here.
    await waitFor(() => expect(card.textContent).toContain('Run 1×'))
  })

  test('a deep link opens one wing, with its own bosses, floors and shared quests', async () => {
    resetHarness('?open=scarlet-monastery%3Alibrary')
    const calls = api()
    renderWithSession(<Page />)
    const dialog = await screen.findByRole('dialog', { name: 'Scarlet Monastery — Library' })
    await waitFor(() => expect(calls.some((call) => /scarlet-monastery(%3A|:)library$/.test(call.path))).toBe(true))
    await waitFor(() => expect(within(dialog).getByText('Arcanist Doan')).toBeTruthy())
    expect(within(dialog).queryByText('Interrogator Vishas')).toBeNull()
    expect(within(dialog).getByText(/Floors: Library/)).toBeTruthy()

    resetHarness('?open=scarlet-monastery%3Alibrary&section=quests')
    api()
    renderWithSession(<Page />)
    const linked = await screen.findByRole('dialog', { name: 'Scarlet Monastery — Library' })
    await waitFor(() => expect(within(linked).getByText(/no source ties a quest to one wing/)).toBeTruthy())
    expect(within(linked).getByText('Mythology of the Titans')).toBeTruthy()
  })

  test('an old numeric link opens the whole dungeon, which lists its wings', async () => {
    resetHarness('?open=189')
    api()
    renderWithSession(<Page />)
    const dialog = await screen.findByRole('dialog', { name: 'Scarlet Monastery' })
    const wings = await within(dialog).findByRole('region', { name: 'Wings' })
    const link = within(wings).getByRole('link', { name: 'Scarlet Monastery — Library' })
    expect(link.getAttribute('href')).toContain('open=scarlet-monastery%3Alibrary')
    expect(within(dialog).getByText('Interrogator Vishas')).toBeTruthy()
  })
})
