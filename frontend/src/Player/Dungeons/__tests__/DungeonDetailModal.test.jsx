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

// Loot is a grid of item slots: a slot is named by its item, and pressing it
// opens the item's details (tooltip, sources, wishlist).
const named = (name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(,|$)`)
const slot = (name, scope = document.body) => within(scope).getByRole('button', { name: named(name) })
const findSlot = (name, scope = document.body) => within(scope).findByRole('button', { name: named(name) })
function openItem(name, scope = document.body) {
  fireEvent.click(slot(name, scope))
  return screen.getByRole('dialog', { name: `${name} details` })
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
    await screen.findByText(/items? Rook can use/)
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
    expect(onNavigate).toHaveBeenLastCalledWith({ section: 'overview', boss: '2741' })
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

  test('old Prepare links land on Quests; the guide, gear and history each have their place', async () => {
    api({ runs: [RUN] })
    const { unmount } = renderWithSession(<Modal section="prepare" />)
    // Quests: preparation and readiness, with quest details.
    const quests = (await screen.findAllByText('The Defias Brotherhood')).find((element) => element.closest('.gw-atlas-quest'))
    expect(screen.getByRole('button', { name: 'Quests' })).toHaveProperty('ariaCurrent', 'page')
    fireEvent.click(quests)
    const list = quests.closest('.gw-atlas-quest')
    expect(list.textContent).toContain('Gryan Stoutmantle')
    expect(list.textContent).toContain('Bring the head of Edwin VanCleef')
    expect(list.textContent).toContain('Westfall 56.5, 47.0')
    expect(list.textContent).toContain('Rewards (choose one)')
    unmount()

    // Overview: the practical guide (dangerous trash) and the character's short answer.
    renderWithSession(<Modal section="overview" />)
    const trash = await screen.findByRole('region', { name: 'Dangerous trash' })
    expect(trash.textContent).toContain('Defias Wizard')
    expect(trash.textContent).toContain('Fireball')
    const forRook = screen.getByRole('region', { name: 'For Rook' })
    await waitFor(() => expect(forRook.textContent).toMatch(/\d+ items? Rook can use/))
    expect(forRook.textContent).toContain('on the wishlist')
    expect(screen.queryByRole('button', { name: 'Prepare' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Bosses' })).toBeNull()
    unmount()
  })

  test('loot: gear targeting and the one Plan my gear button', async () => {
    api()
    renderWithSession(<Modal section="loot" />)
    await findSlot('Cruel Barb')
    expect(screen.getAllByRole('button', { name: /Plan my gear/ })).toHaveLength(1)
    const usable = screen.getByRole('checkbox', { name: /Only what Rook can use \(\d+\)/ })
    fireEvent.click(usable)
    // A Rogue cannot use the Emberstone Staff (staves): it is filtered out.
    expect(screen.queryByRole('button', { name: named('Emberstone Staff') })).toBeNull()
    expect(slot('Cruel Barb')).toBeTruthy()
  })

  test('history lives in My runs', async () => {
    api({ runs: [RUN] })
    renderWithSession(<Modal section="runs" />)
    expect(await screen.findByText(/1 run, 1 completed/)).toBeTruthy()
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
    await findSlot('Emberstone Staff', boss)
    // Hovering never touches the wishlist: only the button in the item's details does.
    const line = openItem('Emberstone Staff', boss)
    expect(within(line).getByText('Classic reference')).toBeTruthy()
    const staff = within(line).getByRole('button', { name: 'Add Emberstone Staff to Rook\'s wishlist' })
    await act(async () => { fireEvent.click(staff) })
    const put = calls.find((call) => call.method === 'PUT')
    expect(put.path).toBe('/api/player/wishlists/char-1/items/i:5201')
    expect(put.body).toEqual({ sourceDungeon: 'The Deadmines', sourceInstanceId: 36 })
    await waitFor(() => expect(within(line).getByRole('button', { name: /Remove Emberstone Staff/ })).toHaveProperty('ariaPressed', 'true'))
    // The slot shows it as wanted.
    expect(slot('Emberstone Staff, on the wishlist', boss).className).toContain('is-wanted')
  })

  test('wanted items show as wanted and remove with DELETE; acquired ones show it', async () => {
    const wishlist = { ...FIXTURE_WISHLIST, items: [...FIXTURE_WISHLIST.items, { itemKey: 'i:872', itemId: 872, state: 'acquired', acquiredBasis: 'owned', sources: [] }] }
    const calls = api({ wishlist })
    renderWithSession(<Modal section="loot" />)
    expect(await findSlot('Cape of the Brotherhood, on the wishlist')).toBeTruthy()
    expect(slot('Rockslicer, acquired').className).toContain('is-acquired')
    const rockslicer = openItem('Rockslicer')
    expect(within(rockslicer).getByText('Acquired')).toBeTruthy()
    expect(within(rockslicer).queryByRole('button', { name: /wishlist/ })).toBeNull()
    const cape = within(openItem('Cape of the Brotherhood')).getByRole('button', { name: 'Remove Cape of the Brotherhood from Rook\'s wishlist' })
    expect(cape).toHaveProperty('ariaPressed', 'true')
    await act(async () => { fireEvent.click(cape) })
    expect(calls.find((call) => call.method === 'DELETE').path).toBe('/api/player/wishlists/char-1/items/i:5193')
  })

  test('an item the backend does not know yet says so', async () => {
    api({ put: () => ({ status: 422, body: { error: 'unknown_item' } }) })
    renderWithSession(<Modal section="loot" />)
    await findSlot('Emberstone Staff')
    const button = within(openItem('Emberstone Staff')).getByRole('button', { name: 'Add Emberstone Staff to Rook\'s wishlist' })
    await act(async () => { fireEvent.click(button) })
    expect((await screen.findByRole('alert')).textContent).toContain('does not know Emberstone Staff yet')
  })

  test('item facts show the record and link back to the source boss', async () => {
    api()
    const onNavigate = vi.fn()
    renderWithSession(<Modal section="loot" onNavigate={onNavigate} />)
    await findSlot('Cruel Barb')
    const barb = openItem('Cruel Barb')
    fireEvent.click(within(barb).getByText('Item facts'))
    expect(barb.textContent).toContain('30–57 damage, speed 2.80, 15.5 dps')
    expect(barb.textContent).toContain('One-Handed Swords')
    expect(barb.textContent).toContain('Binds when picked up')
    expect(within(barb).getByText('Seen dropping')).toBeTruthy()
    fireEvent.click(within(barb).getByRole('button', { name: 'Edwin VanCleef' }))
    expect(onNavigate).toHaveBeenCalledWith({ section: 'overview', boss: '2747' })
    const shirt = openItem('Corsair\'s Overshirt')
    fireEvent.click(within(shirt).getByText('Item facts'))
    expect(shirt.textContent).toContain('Classic reference — not verified for Forever. Drop chances are not published.')
  })

  test('the loot tab filters to Classic reference items and usable gear', async () => {
    api()
    renderWithSession(<Modal section="loot" />)
    await findSlot('Cruel Barb')
    fireEvent.change(screen.getByRole('combobox', { name: 'Which loot' }), { target: { value: 'reference' } })
    expect(screen.queryByRole('button', { name: named('Cruel Barb') })).toBeNull()
    expect(slot('Corsair\'s Overshirt')).toBeTruthy()
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
    await findSlot('Cruel Barb')
    const button = within(openItem('Cruel Barb')).getByRole('button', { name: 'Add Cruel Barb to the wishlist' })
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
    expect(await screen.findByText('No loot linked to Event Boss. Chest loot (Chest of The Seven) is in the Loot section.')).toBeTruthy()
    unmount()
    resetHarness()
    api({ detail: detail({ dungeonLoot: [] }) })
    renderWithSession(<Modal section="bosses" boss="9999" />)
    expect(await screen.findByText(/no Classic reference source links an item to it. That does not mean it drops nothing/)).toBeTruthy()
  })

  test('the sprint-1 backend (no reference loot, no quest details) still works', async () => {
    api({ detail: FIXTURE_DETAIL_SPRINT1 })
    renderWithSession(<Modal section="loot" />)
    await findSlot('Cruel Barb')
    expect(screen.queryByRole('combobox', { name: 'Which loot' })).toBeNull()
    expect(screen.queryByRole('button', { name: named('Corsair\'s Overshirt') })).toBeNull()
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

describe('loot by source', () => {
  test('drops sit under their source; an item from two sources is under both and links across', async () => {
    const barb = FIXTURE_DEADMINES_DETAIL.sources[1].items[1]
    const detail = {
      ...FIXTURE_DEADMINES_DETAIL,
      // The catalog saw Cruel Barb from a creature it knows only by ID.
      sources: [...FIXTURE_DEADMINES_DETAIL.sources, { key: 'creature:657', kind: 'creature', boss: false, name: 'Creature 657', npcIds: [657], items: [barb] }],
      atlas: { ...FIXTURE_DEADMINES_DETAIL.atlas, creatures: [...(FIXTURE_DEADMINES_DETAIL.atlas.creatures || []), { npcId: 657, name: 'Defias Pirate', abilities: [] }] },
    }
    api({ detail })
    const onNavigate = vi.fn()
    renderWithSession(<Modal section="loot" onNavigate={onNavigate} />)
    const boss = await screen.findByRole('region', { name: 'Edwin VanCleef loot' })
    // The atlas's name, not the catalog's placeholder.
    const pirate = screen.getByRole('region', { name: 'Defias Pirate loot' })
    expect(screen.queryByText(/Creature 657/)).toBeNull()
    expect(slot('Cruel Barb', boss)).toBeTruthy()
    const line = openItem('Cruel Barb', pirate)
    expect(line.textContent).toContain('Also from Edwin VanCleef (boss)')
    fireEvent.click(within(line).getByRole('button', { name: 'Edwin VanCleef' }))
    expect(onNavigate).toHaveBeenLastCalledWith({ section: 'overview', boss: '2747' })
    expect(screen.getByRole('region', { name: 'Bosses' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Trash and adds' })).toBeTruthy()
    expect(slot('Buzz Saw', screen.getByRole('region', { name: 'Unknown source' }))).toBeTruthy()
  })

  test('a boss shows its own loot with its guide, and names other sources of the same item', async () => {
    api()
    renderWithSession(<Modal section="overview" boss="2747" />)
    const boss = await screen.findByRole('article', { name: 'Edwin VanCleef' })
    const loot = within(boss).getByRole('region', { name: 'Edwin VanCleef loot' })
    expect(slot('Cruel Barb', loot)).toBeTruthy()
    expect(within(loot).queryByRole('button', { name: named('Rockslicer') })).toBeNull()
    // The boss guide uses the same item slots and details.
    expect(openItem('Cruel Barb', loot).textContent).toContain('From Edwin VanCleef')
    // Technical ids are folded away, not in the header.
    expect(within(boss).getByText('About this boss\'s data')).toBeTruthy()
    expect(boss.querySelector('.gw-atlas-boss__head').textContent).not.toMatch(/NPC|encounter/)
    expect(within(boss).getByRole('navigation', { name: 'Previous and next boss' })).toBeTruthy()
  })
})

describe('quest rewards', () => {
  test('rewards are item slots too, marked as a choice', async () => {
    api()
    renderWithSession(<Modal section="quests" character={null} characters={[]} />)
    const quest = (await screen.findAllByText('The Defias Brotherhood')).find((element) => element.closest('.gw-atlas-quest'))
    fireEvent.click(quest)
    const block = quest.closest('.gw-atlas-quest')
    expect(within(block).getByText('Rewards (choose one)')).toBeTruthy()
    const rewards = within(block).getAllByRole('button', { name: /, choose one$/ })
    expect(rewards.length).toBeGreaterThan(1)
    fireEvent.click(rewards[0])
    expect(screen.getByRole('dialog', { name: /details$/ }).textContent).toContain('Quest reward: choose one of the rewards.')
  })
})

