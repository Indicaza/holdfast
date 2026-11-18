import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { FIXTURE_DUNGEON_LIST } from '../__fixtures__/atlas.js'
import PlanMyGear from '../PlanMyGear.jsx'
import { BRICK, ROOK, mockApi, renderWithSession, resetHarness } from './harness.jsx'

const PREVIEW = {
  ok: true, status: 'preview',
  summary: { add: 1, update: 1, unchanged: 1, invalid: 0 },
  entries: [
    { itemKey: 'i:5202', itemId: 5202, name: 'Corsair\'s Overshirt', qualityId: 3, iconFileDataId: null, priority: 'high', note: 'Chest upgrade', action: 'add', changes: {} },
    { itemKey: 'i:5193', itemId: 5193, name: 'Cape of the Brotherhood', qualityId: 3, iconFileDataId: null, priority: 'high', note: '', action: 'update', changes: { priority: { from: 'normal', to: 'high' } } },
    { itemKey: 'i:5191', itemId: 5191, name: 'Cruel Barb', qualityId: 3, iconFileDataId: null, priority: 'normal', note: '', action: 'unchanged', changes: {} },
  ],
  warnings: [], errors: [],
}

const BROKEN = {
  ok: false, status: 'invalid', summary: { add: 0, update: 0, unchanged: 0, invalid: 1 }, entries: [], warnings: [], partialPossible: false,
  errors: [{ path: 'items[0].itemId', code: 'unknown_item', category: 'catalog', message: 'Item 99999 is not in the catalog.', suggestion: 'Drop it or use a listed id.' }],
  repairPrompt: 'Fix item 99999.',
}

function api({ preview = PREVIEW } = {}) {
  return mockApi([
    { path: /\/ai-prompt$/, reply: () => ({ prompt: 'PLAN PROMPT' }) },
    {
      method: 'POST', path: /\/import$/, reply: (request) => (request.body.commit
        ? { status: 'imported', applied: { added: 1, updated: request.body.updateExisting ? 1 : 0 }, wishlist: { items: [] } }
        : preview.ok ? preview : { status: 422, body: preview }),
    },
  ])
}

beforeEach(() => resetHarness())
afterEach(() => vi.restoreAllMocks())

test('choose several dungeons, copy the prompt, preview the JSON, then import', async () => {
  const calls = api()
  const onImported = vi.fn()
  renderWithSession(<PlanMyGear character={ROOK} characters={[ROOK, BRICK]} onCharacter={() => {}} dungeon={{ instanceId: 36, name: 'The Deadmines' }}
    dungeons={FIXTURE_DUNGEON_LIST} onImported={onImported} onClose={() => {}} />)
  // Scope: pick dungeons. The open dungeon starts chosen; add Wailing Caverns.
  fireEvent.click(screen.getByRole('radio', { name: 'Choose dungeons' }))
  const list = screen.getByRole('list', { name: 'Dungeons to plan' })
  expect(within(list).getByRole('checkbox', { name: /The Deadmines/ })).toHaveProperty('checked', true)
  fireEvent.click(within(list).getByRole('checkbox', { name: /Wailing Caverns/ }))
  expect(screen.getByRole('status').textContent).toContain('2 chosen')
  // No clipboard in jsdom: the prompt is shown to copy by hand.
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy AI planning prompt' })) })
  const prompt = calls.find((call) => call.path.endsWith('/ai-prompt'))
  expect(prompt.path).toBe('/api/player/wishlists/char-1/ai-prompt')
  expect(prompt.query.get('dungeons')).toBe('36,43')
  expect((await screen.findByRole('textbox', { name: 'Planning prompt' })).value).toBe('PLAN PROMPT')

  fireEvent.change(screen.getByRole('textbox', { name: 'AI wishlist JSON' }), { target: { value: '{"schemaVersion":1,"items":[]}' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check the JSON' })) })
  expect(await screen.findByText('Ready to import: 1 to add, 1 to update, 1 already on the list')).toBeTruthy()
  expect(screen.getByText(/priority normal → high/)).toBeTruthy()
  expect(calls.filter((call) => call.method === 'POST').at(-1).body).toEqual({ text: '{"schemaVersion":1,"items":[]}' })

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import 2 items' })) })
  expect(calls.filter((call) => call.method === 'POST').at(-1).body).toMatchObject({ commit: true, updateExisting: true, skipInvalid: false })
  expect(await screen.findByText(/Imported: 1 added, 1 updated/)).toBeTruthy()
  expect(onImported).toHaveBeenCalled()
})

test('choosing no dungeons cannot copy a prompt for everything by accident', () => {
  api()
  renderWithSession(<PlanMyGear character={ROOK} dungeon={{ instanceId: 36, name: 'The Deadmines' }} dungeons={FIXTURE_DUNGEON_LIST} onImported={() => {}} onClose={() => {}} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Choose dungeons' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /The Deadmines/ }))
  expect(screen.getByRole('button', { name: 'Copy AI planning prompt' })).toHaveProperty('disabled', true)
})

test('the character can be switched from the planner', () => {
  api()
  const onCharacter = vi.fn()
  renderWithSession(<PlanMyGear character={ROOK} characters={[ROOK, BRICK]} onCharacter={onCharacter} dungeons={FIXTURE_DUNGEON_LIST} onImported={() => {}} onClose={() => {}} />)
  fireEvent.change(screen.getByRole('combobox', { name: 'Plan for character' }), { target: { value: 'char-2' } })
  expect(onCharacter).toHaveBeenCalledWith('char-2')
})

test('invalid JSON saves nothing and offers the repair prompt', async () => {
  api({ preview: BROKEN })
  renderWithSession(<PlanMyGear character={ROOK} dungeons={FIXTURE_DUNGEON_LIST} onImported={() => {}} onClose={() => {}} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'AI wishlist JSON' }), { target: { value: '{"items":[{"itemId":99999}]}' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check the JSON' })) })
  await waitFor(() => expect(screen.getByText('Not imported: 1 problem found')).toBeTruthy())
  expect(screen.getByRole('button', { name: 'Copy repair prompt' })).toBeTruthy()
  expect(screen.getByText('Item 99999 is not in the catalog.')).toBeTruthy()
})
