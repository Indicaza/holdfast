import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  FIXTURE_DEADMINES_DETAIL,
  FIXTURE_DUNGEON_LIST,
  FIXTURE_DUNGEON_LIST_SPRINT1,
  FIXTURE_WISHLIST,
} from '../__fixtures__/atlas.js'
import AtlasModalHost from '../AtlasModalHost.jsx'
import DungeonExplore from '../DungeonExplore.jsx'
import { BRICK, ROOK, Routed, mockApi, renderWithSession, resetHarness } from './harness.jsx'

const RUNS = [
  { id: 1, status: 'completed', startedAt: Math.floor(Date.now() / 1000) - 86400, durationSeconds: 1800, timer: { seconds: 1700 }, dungeon: { name: 'The Deadmines', instanceId: 36 } },
  { id: 2, status: 'abandoned', startedAt: Math.floor(Date.now() / 1000) - 3600, durationSeconds: 600, dungeon: { name: 'The Deadmines', instanceId: 36 } },
]

function api({ list = FIXTURE_DUNGEON_LIST, wishlists = {}, runs = RUNS } = {}) {
  return mockApi([
    { path: '/api/player/loot/dungeons', reply: () => ({ dungeons: list }) },
    { path: '/api/player/loot/dungeons/36', reply: () => FIXTURE_DEADMINES_DETAIL },
    { path: /^\/api\/player\/loot\/dungeons\/\d+$/, reply: () => ({ status: 404, body: { error: 'not_found' } }) },
    { path: /^\/api\/player\/wishlists\/[^/]+$/, reply: (request) => wishlists[request.path.split('/').pop()] || { limit: 50, items: [] } },
    { path: '/api/player/dungeon-runs', reply: (request) => ({ runs: request.query.get('character') === 'char-1' ? runs : [], comparisons: [], filters: {} }) },
  ])
}

function Page({ characters = [ROOK, BRICK] }) {
  return (
    <Routed>
      {(query) => (
        <>
          <DungeonExplore queryString={query} characters={characters} />
          <AtlasModalHost queryString={query} characters={characters} />
        </>
      )}
    </Routed>
  )
}

const card = (name) => screen.getByRole('link', { name: new RegExp(`^${name}`) }).closest('li')

beforeEach(() => resetHarness())
afterEach(() => vi.restoreAllMocks())

describe('character-aware discovery', () => {
  test('cards show level fit, wishlist targets, usable drops and previous runs', async () => {
    api({ wishlists: { 'char-1': FIXTURE_WISHLIST } })
    renderWithSession(<Page />)
    await screen.findByRole('link', { name: /^The Deadmines/ })
    const deadmines = card('The Deadmines')
    // 2 wishlist items list Deadmines as a source; Corsair's Overshirt
    // matches by its reference item id.
    await waitFor(() => expect(deadmines.textContent).toContain('3 wishlist targets'))
    await waitFor(() => expect(deadmines.textContent).toMatch(/\d+ drops for Rogue/))
    await waitFor(() => expect(deadmines.textContent).toContain('Run 2×'))
    expect(deadmines.textContent).toContain('best 28:20')
    expect(card('Wailing Caverns').textContent).toContain('Not run yet')
  })

  test('"Recommended for me" keeps level fits and wishlist dungeons, and says why', async () => {
    api({ wishlists: { 'char-1': FIXTURE_WISHLIST } })
    renderWithSession(<Page />)
    const toggle = await screen.findByRole('checkbox', { name: /Recommended for Rook/ })
    await waitFor(() => expect(toggle.closest('label').textContent).toContain('(2)'))
    fireEvent.click(toggle)
    await waitFor(() => expect(window.location.search).toContain('rec=1'))
    const links = screen.getAllByRole('link').map((link) => link.getAttribute('aria-label'))
    expect(links).toEqual([expect.stringMatching(/^The Deadmines.*recommended$/), expect.stringMatching(/^Wailing Caverns.*recommended$/)])
    const why = within(card('The Deadmines')).getByText(/^Why:/).textContent
    expect(why).toContain('Levels 17–26 suits Rook (level 20)')
    expect(why).toContain('3 wishlist items drop here')
    expect(why).toMatch(/\d+ drops a Rogue can use/)
    // No invented numbers: no percentages or scores anywhere.
    expect(why).not.toMatch(/%|score/i)
  })

  test('switching character re-evaluates fit and recommendations', async () => {
    api()
    renderWithSession(<Page />)
    await screen.findByRole('link', { name: /^The Deadmines/ })
    fireEvent.change(screen.getByRole('combobox', { name: 'Character' }), { target: { value: 'char-2' } })
    await waitFor(() => expect(window.location.search).toContain('character=char-2'))
    fireEvent.click(await screen.findByRole('checkbox', { name: /Recommended for Brick/ }))
    await waitFor(() => expect(screen.getAllByRole('link').map((link) => link.getAttribute('aria-label'))).toEqual([expect.stringMatching(/^Molten Core/)]))
    expect(card('Molten Core').textContent).toContain('Level 60 suits Brick')
  })

  test('without reference fields (sprint-1 backend) the cards still work', async () => {
    api({ list: FIXTURE_DUNGEON_LIST_SPRINT1, wishlists: { 'char-1': FIXTURE_WISHLIST } })
    renderWithSession(<Page />)
    await screen.findByRole('link', { name: /^The Deadmines/ })
    await waitFor(() => expect(card('The Deadmines').textContent).toContain('2 wishlist targets'))
    expect(card('The Deadmines').textContent).not.toContain('reference')
  })

  test('filters combine; nothing matching offers a way back', async () => {
    api()
    renderWithSession(<Page />)
    await screen.findByRole('link', { name: /^The Deadmines/ })
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'raid' } })
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(1))
    fireEvent.change(screen.getByRole('combobox', { name: 'Zone' }), { target: { value: 'Westfall' } })
    expect(await screen.findByText('No dungeons match these filters.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(screen.getAllByRole('link').length).toBe(FIXTURE_DUNGEON_LIST.length))
  })

  test('without characters there is no recommendation and Plan my gear is off', async () => {
    api()
    renderWithSession(<Page characters={[]} />)
    await screen.findByRole('link', { name: /^The Deadmines/ })
    expect(screen.queryByRole('checkbox', { name: /Recommended/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Plan my gear' })).toHaveProperty('disabled', true)
  })
})

describe('the modal from the URL', () => {
  test('?open= opens a dungeon over Explore; closing keeps the filters', async () => {
    api()
    resetHarness('?character=char-1&kind=dungeon&open=36&section=bosses&boss=2747')
    renderWithSession(<Page />)
    expect(await screen.findByRole('dialog', { name: 'The Deadmines' })).toBeTruthy()
    expect(await screen.findByRole('article', { name: 'Edwin VanCleef' })).toBeTruthy()
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.search).toBe('?character=char-1&kind=dungeon')
  })

  test('switching character inside the modal updates the URL and keeps it open', async () => {
    api()
    resetHarness('?character=char-1&open=36')
    renderWithSession(<Page />)
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Character' }), { target: { value: 'char-2' } })
    await waitFor(() => expect(window.location.search).toBe('?character=char-2&open=36'))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
