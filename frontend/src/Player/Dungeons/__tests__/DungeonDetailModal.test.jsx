import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  FIXTURE_DEADMINES_DETAIL,
  FIXTURE_DETAIL_SPRINT1,
  FIXTURE_DETAIL_WITHOUT_ATLAS,
  FIXTURE_DUNGEON_LIST,
  FIXTURE_WISHLIST,
} from '../__fixtures__/atlas.js'
import DungeonDetailModal from '../DungeonDetailModal.jsx'
import { BRICK, ROOK, mockApi, renderWithSession, resetHarness } from './harness.jsx'

const RUN = {
  id: 7, runId: 'r7', status: 'completed', startedAt: Math.floor(Date.now() / 1000) - 7200, durationSeconds: 1500, timer: { seconds: 1450 }, deaths: 1,
  dungeon: { name: 'The Deadmines', instanceId: 36 }, character: { id: 'char-1', name: 'Rook' },
}

function api({ detail = FIXTURE_DEADMINES_DETAIL, wishlist = FIXTURE_WISHLIST, runs = [], put = null } = {}) {
  let current = structuredClone(wishlist)
  return mockApi([
    { path: '/api/player/loot/dungeons/36', reply: () => detail },
    { path: '/api/player/wishlists/char-1', reply: () => current },
    { path: '/api/player/wishlists/char-2', reply: () => ({ limit: 50, items: [] }) },
    { path: '/api/player/dungeon-runs', reply: () => ({ runs, comparisons: [], filters: {} }) },
    {
      method: 'PUT', path: /^\/api\/player\/wishlists\/char-1\/items\//, reply: (request) => {
        if (put) return put(request)
        const itemKey = decodeURIComponent(request.path.split('/').pop())
        current = { ...current, items: [...current.items, { itemKey, itemId: Number(itemKey.slice(2)), state: 'wanted', priority: 'normal', sources: [] }] }
        return current
      },
    },
    {
      method: 'DELETE', path: /^\/api\/player\/wishlists\/char-1\/items\//, reply: (request) => {
        const itemKey = decodeURIComponent(request.path.split('/').pop())
        current = { ...current, items: current.items.filter((item) => item.itemKey !== itemKey) }
        return current
      },
    },
  ])
}

function Modal(props) {
  return (
    <DungeonDetailModal instanceId={36} dungeons={FIXTURE_DUNGEON_LIST} character={ROOK} characters={[ROOK, BRICK]}
      onCharacter={() => {}} onNavigate={() => {}} onClose={() => {}} {...props} />
  )
}

// The modal over a page, opened from a button, like the real cards.
function Page({ initialOpen = false }) {
  const [open, setOpen] = useState(initialOpen)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open Deadmines</button>
      {open ? <Modal onClose={() => setOpen(false)} /> : null}
    </>
  )
}

beforeAll(() => {
  // jsdom lays nothing out: count every attached element as visible so the
  // focus trap sees the controls.
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return this.parentNode } })
})

beforeEach(() => resetHarness())
afterEach(() => vi.restoreAllMocks())

describe('opening, closing and focus', () => {
  test('Escape closes the modal and focus returns to what opened it', async () => {
    api()
    renderWithSession(<Page />)
    const opener = screen.getByRole('button', { name: 'Open Deadmines' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'The Deadmines' })
    expect(dialog).toHaveProperty('ariaModal', 'true')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }))
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(document.body.style.overflow).toBe('')
  })

  test('the close button and a backdrop click close it', async () => {
    api()
    const onClose = vi.fn()
    const { container } = renderWithSession(<Modal onClose={onClose} />)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.mouseDown(container.querySelector('.gw-atlas-modal'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  test('Tab wraps from the last control to the first, and Shift+Tab back', async () => {
    api()
    renderWithSession(<Modal />)
    const dialog = await screen.findByRole('dialog')
    await screen.findByText('Prepare for this run')
    const focusable = [...dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
    const first = focusable[0]
    const last = focusable.at(-1)
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })
})

describe('deep links and sections', () => {
  test('?section=bosses&boss= opens that boss with its quick guide first', async () => {
    api()
    const onNavigate = vi.fn()
    renderWithSession(<Modal section="bosses" boss="2747" onNavigate={onNavigate} />)
    const boss = await screen.findByRole('article', { name: 'Edwin VanCleef' })
    // Rook is a Rogue: the guide is for damage dealers by default.
    expect(within(boss).getByRole('button', { name: 'Damage' })).toHaveProperty('ariaPressed', 'true')
    const guide = within(boss).getByRole('region', { name: 'Quick guide for damage' })
    const lines = within(guide).getAllByRole('listitem')
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.length).toBeLessThanOrEqual(4)
    expect(lines[0].textContent).toContain('Summon Blackguards')
    // Battle Shout is in the interrupt category but cannot be interrupted: the guide says so.
    expect(guide.textContent).toContain('Cannot be interrupted')
    // The full list is one click away.
    expect(within(boss).getByText('All abilities (3)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Loot' }))
    expect(onNavigate).toHaveBeenLastCalledWith({ section: 'loot', boss: '' })
    fireEvent.click(screen.getByRole('button', { name: /Rhahk'Zor/ }))
    expect(onNavigate).toHaveBeenLastCalledWith({ section: 'bosses', boss: '2741' })
  })

  test('the role selector reorders the guide; unverified Classic data is labelled', async () => {
    api()
    renderWithSession(<Modal section="bosses" boss="2746" />)
    const boss = await screen.findByRole('article', { name: 'Cookie' })
    fireEvent.click(within(boss).getByRole('button', { name: 'Healer' }))
    const guide = within(boss).getByRole('region', { name: 'Quick guide for healer' })
    const [first, second] = within(guide).getAllByRole('listitem')
    expect(first.textContent).toContain('Healer danger')
    expect(first.textContent).toContain('Cookie\'s Cooking')
    expect(first.textContent).toContain('Classic reference — not verified for Forever')
    // Acid Splash is verified for Forever: no label.
    expect(second.textContent).toContain('Acid Splash')
    expect(second.textContent).not.toContain('not verified')
  })

  test('Prepare: gear targets, quests, dangerous encounters and history', async () => {
    api({ runs: [RUN] })
    renderWithSession(<Modal section="prepare" />)
    const gear = await screen.findByText('Gear targets')
    const gearBlock = gear.closest('details')
    await waitFor(() => expect(within(gearBlock).getAllByRole('listitem').length).toBeGreaterThan(0))
    // Mail is not filtered by armour type (no guessing), but the Westfall
    // quest rewards and boss loot are listed with their source.
    expect(gearBlock.textContent).toContain('Cruel Barb')
    expect(gearBlock.textContent).toContain('already on the wishlist')
    const block = (id) => document.querySelector(`[data-block="${id}"]`)
    const quests = block('quests')
    expect(quests.textContent).toContain('Gryan Stoutmantle')
    expect(quests.textContent).toContain('Bring the head of Edwin VanCleef')
    expect(quests.textContent).toContain('Westfall 56.5, 47.0')
    expect(quests.textContent).toContain('Rewards (choose one)')
    const danger = block('danger')
    expect(danger.textContent).toContain('Defias Wizard')
    expect(danger.textContent).toContain('Fireball')
    const history = block('history')
    fireEvent.click(within(history).getByText('My history'))
    await waitFor(() => expect(history.textContent).toContain('1 run, 1 completed'))
  })

  test('history has a useful empty state', async () => {
    api({ runs: [] })
    renderWithSession(<Modal section="runs" />)
    expect(await screen.findByText(/No runs of The Deadmines by Rook synced yet/)).toBeTruthy()
  })
})

describe('wishlist on boss loot', () => {
  test('one click adds a Classic reference item with the existing PUT', async () => {
    const calls = api()
    renderWithSession(<Modal section="bosses" boss="2744" />)
    const boss = await screen.findByRole('article', { name: 'Captain Greenskin' })
    const staff = await within(boss).findByRole('button', { name: 'Add Emberstone Staff to Rook\'s wishlist' })
    const line = staff.closest('li')
    expect(within(line).getByText('Classic reference')).toBeTruthy()
    await act(async () => { fireEvent.click(staff) })
    const put = calls.find((call) => call.method === 'PUT')
    expect(put.path).toBe('/api/player/wishlists/char-1/items/i:5201')
    expect(put.body).toEqual({ sourceDungeon: 'The Deadmines', sourceInstanceId: 36 })
    await waitFor(() => expect(within(line).getByRole('button', { name: /Remove Emberstone Staff/ })).toHaveProperty('ariaPressed', 'true'))
  })

  test('wanted items show as wanted and remove with DELETE; acquired ones show it', async () => {
    const wishlist = { ...FIXTURE_WISHLIST, items: [...FIXTURE_WISHLIST.items, { itemKey: 'i:872', itemId: 872, state: 'acquired', acquiredBasis: 'owned', sources: [] }] }
    const calls = api({ wishlist })
    renderWithSession(<Modal section="loot" />)
    const cape = await screen.findByRole('button', { name: 'Remove Cape of the Brotherhood from Rook\'s wishlist' })
    expect(cape).toHaveProperty('ariaPressed', 'true')
    const rockslicer = screen.getByText('Rockslicer').closest('li')
    expect(within(rockslicer).getByText('Acquired')).toBeTruthy()
    expect(within(rockslicer).queryByRole('button', { name: /wishlist/ })).toBeNull()
    await act(async () => { fireEvent.click(cape) })
    expect(calls.find((call) => call.method === 'DELETE').path).toBe('/api/player/wishlists/char-1/items/i:5193')
  })

  test('an item the backend does not know yet says so', async () => {
    api({ put: () => ({ status: 422, body: { error: 'unknown_item' } }) })
    renderWithSession(<Modal section="loot" />)
    const button = await screen.findByRole('button', { name: 'Add Emberstone Staff to Rook\'s wishlist' })
    await act(async () => { fireEvent.click(button) })
    expect((await screen.findByRole('alert')).textContent).toContain('does not know Emberstone Staff yet')
  })

  test('item facts show the record and link back to the source boss', async () => {
    api()
    const onNavigate = vi.fn()
    renderWithSession(<Modal section="loot" onNavigate={onNavigate} />)
    const barb = (await screen.findByText('Cruel Barb')).closest('li')
    fireEvent.click(within(barb).getByText('Item facts'))
    expect(barb.textContent).toContain('30–57 damage, speed 2.80, 15.5 dps')
    expect(barb.textContent).toContain('One-Handed Swords')
    expect(barb.textContent).toContain('Binds when picked up')
    expect(within(barb).getByText('Seen dropping')).toBeTruthy()
    fireEvent.click(within(barb).getByRole('button', { name: 'Edwin VanCleef' }))
    expect(onNavigate).toHaveBeenCalledWith({ section: 'bosses', boss: '2747' })
    const shirt = screen.getByText('Corsair\'s Overshirt').closest('li')
    fireEvent.click(within(shirt).getByText('Item facts'))
    expect(shirt.textContent).toContain('Classic reference — not verified for Forever. Drop chances are not published.')
  })

  test('the loot tab filters to Classic reference items and usable gear', async () => {
    api()
    renderWithSession(<Modal section="loot" />)
    await screen.findByText('Cruel Barb')
    fireEvent.change(screen.getByRole('combobox', { name: 'Which loot' }), { target: { value: 'reference' } })
    expect(screen.queryByText('Cruel Barb')).toBeNull()
    expect(screen.getByText('Corsair\'s Overshirt')).toBeTruthy()
  })

  test('switching character from the modal asks the host', async () => {
    api()
    const onCharacter = vi.fn()
    renderWithSession(<Modal onCharacter={onCharacter} />)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Character' }), { target: { value: 'char-2' } })
    expect(onCharacter).toHaveBeenCalledWith('char-2')
  })

  test('without a character, toggles are disabled and say why', async () => {
    api()
    renderWithSession(<Modal character={null} characters={[]} section="loot" />)
    const button = await screen.findByRole('button', { name: 'Add Cruel Barb to the wishlist' })
    expect(button).toHaveProperty('disabled', true)
    expect(screen.getByText('Choose a character to keep a wishlist.')).toBeTruthy()
  })
})

describe('missing data', () => {
  test('a boss without loot says why, by what is known', async () => {
    const shredder = { encounterId: 9999, name: 'Event Boss', abilities: [], loot: [], referenceLoot: [] }
    const chest = { itemId: 1, itemKey: 'i:1', name: 'Shiny', sourceName: 'Chest of The Seven', npcId: null }
    const detail = (atlas) => ({ ...FIXTURE_DEADMINES_DETAIL, atlas: { ...FIXTURE_DEADMINES_DETAIL.atlas, bosses: [shredder], ...atlas } })
    api({ detail: detail({ dungeonLoot: [chest] }) })
    const { unmount } = renderWithSession(<Modal section="bosses" boss="9999" />)
    expect(await screen.findByText('No loot linked to Event Boss. Chest loot (Chest of The Seven) is in the Loot tab.')).toBeTruthy()
    unmount()
    resetHarness()
    api({ detail: detail({ dungeonLoot: [] }) })
    renderWithSession(<Modal section="bosses" boss="9999" />)
    expect(await screen.findByText(/no Classic reference source links an item to it. That does not mean it drops nothing/)).toBeTruthy()
  })

  test('the sprint-1 backend (no reference loot, no quest details) still works', async () => {
    api({ detail: FIXTURE_DETAIL_SPRINT1 })
    renderWithSession(<Modal section="loot" />)
    await screen.findByText('Cruel Barb')
    expect(screen.queryByRole('combobox', { name: 'Which loot' })).toBeNull()
    expect(screen.queryByText('Corsair\'s Overshirt')).toBeNull()
    expect(screen.queryByText('Classic reference')).toBeNull()
  })

  test('sprint-1 quests show without objective, rewards or location', async () => {
    api({ detail: FIXTURE_DETAIL_SPRINT1 })
    renderWithSession(<Modal section="quests" />)
    const quest = (await screen.findByText('The Defias Brotherhood')).closest('details')
    fireEvent.click(within(quest).getByText('The Defias Brotherhood'))
    expect(quest.textContent).toContain('Gryan Stoutmantle')
    expect(quest.textContent).not.toContain('Rewards')
  })

  test('a WoW Forever dungeon says what is known and lists unknown drops by item id', async () => {
    const drop = (itemId, npcId) => ({ itemId, itemKey: `i:${itemId}`, npcId, factsKnown: false, verifiedForForever: false })
    const faldrim = { encounterId: null, npcId: 261306, name: 'Faldrim Anvilmar', abilities: [], loot: [], referenceLoot: [], unresolvedLoot: [drop(273805, 261306)] }
    const atlas = { ...FIXTURE_DEADMINES_DETAIL.atlas, origin: 'forever', floorNames: ['The Hall of Thanes'], bosses: [faldrim], dungeonLoot: [],
      unresolvedLoot: [drop(273805, 261306), drop(273806, null)] }
    api({ detail: { ...FIXTURE_DEADMINES_DETAIL, sources: [], atlas } })
    const { unmount } = renderWithSession(<Modal />)
    expect(await screen.findByText(/A WoW Forever dungeon: its bosses and level band come from the game client \(The Hall of Thanes\)/)).toBeTruthy()
    unmount()
    resetHarness()
    api({ detail: { ...FIXTURE_DEADMINES_DETAIL, sources: [], atlas } })
    renderWithSession(<Modal section="bosses" boss={String(261306)} />)
    expect(await screen.findByText('1 more drop is listed for Faldrim Anvilmar without item details yet (item 273805).')).toBeTruthy()
  })

  test('a dungeon without any atlas still opens with its loot', async () => {
    api({ detail: FIXTURE_DETAIL_WITHOUT_ATLAS })
    renderWithSession(<Modal dungeons={[]} />)
    expect(await screen.findByText(/not in the atlas yet/)).toBeTruthy()
  })

  test('a detail that fails to load says so', async () => {
    mockApi([])
    renderWithSession(<Modal dungeons={[]} />)
    expect((await screen.findByRole('alert')).textContent).toContain('This dungeon could not be loaded (HTTP 404, not_found).')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
