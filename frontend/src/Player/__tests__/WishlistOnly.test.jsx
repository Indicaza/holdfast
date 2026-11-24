import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import DungeonLoot from '../DungeonLoot.jsx'

const mocks = vi.hoisted(() => ({
  urls: [],
  mutations: [],
  wishlist: {
    ownershipKnown: true,
    items: [
      { itemKey: 'i:271201', itemId: 271201, priority: 'high', note: 'Tank upgrade', state: 'wanted',
        item: { name: 'Mutant Scale Breastplate', itemId: 271201, qualityId: 3, slot: 'Chest' },
        sources: [{ source: 'Mutanus the Devourer', dungeon: 'Wailing Caverns', instanceId: 43 }] },
      { itemKey: 'i:5191', itemId: 5191, priority: 'normal', note: '', state: 'acquired', acquiredBasis: 'owned',
        item: { name: 'Cruel Barb', itemId: 5191, qualityId: 3, slot: 'One-Hand' },
        sources: [{ source: 'Edwin VanCleef', dungeon: 'Deadmines', instanceId: 36 }] },
    ],
  },
}))

vi.mock('../../Auth/sessionContext.js', () => ({ useSession: () => ({ refresh: vi.fn(), signIn: vi.fn() }) }))
vi.mock('../../Auth/authenticatedMutation.js', () => ({
  runAuthenticatedMutation: async (args) => {
    mocks.mutations.push(args)
    return mocks.wishlist
  },
}))
vi.mock('../../Live/useLiveResource.js', () => ({
  useLiveResource: (url) => {
    mocks.urls.push(url)
    return { data: mocks.wishlist, status: 'ready', mutate: vi.fn() }
  },
}))
vi.mock('../../Navigation/navigation.js', () => ({ navigate: vi.fn() }))

afterEach(() => {
  cleanup()
  mocks.urls.length = 0
  mocks.mutations.length = 0
})

describe('Wishlist tab', () => {
  const renderWishlist = () => render(<DungeonLoot server="" query={{ character: 'rook', filters: {} }}
    characters={[{ id: 'rook', name: 'Rook', className: 'Warrior', level: 20 }]} />)

  test('only loads the character wishlist; never fetches dungeon drops', () => {
    renderWishlist()
    expect(mocks.urls).toEqual(['/api/player/wishlists/rook'])
    expect(screen.getByRole('heading', { name: 'Wishlist' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Wanted items' })).toBeTruthy()
    expect(screen.getByText('Mutant Scale Breastplate')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Dungeon loot' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Dungeon' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Filter loot' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Browse dungeons' })).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Wanted items' })).getByRole('link', { name: 'Journal' })).toBeTruthy()
  })

  test('item editors remain optional and acquired entries start collapsed', () => {
    renderWishlist()
    expect(screen.queryByLabelText('Note for Mutant Scale Breastplate')).toBeNull()
    const edit = screen.getByRole('button', { name: 'Edit Mutant Scale Breastplate details' })
    expect(edit.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(edit)
    expect(screen.getByLabelText('Note for Mutant Scale Breastplate').value).toBe('Tank upgrade')
    expect(screen.getByRole('button', { name: 'Move Mutant Scale Breastplate up' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove Mutant Scale Breastplate from the wishlist' })).toBeTruthy()
    const acquired = screen.getByText('Acquired (1)').closest('details')
    expect(acquired.open).toBe(false)
    fireEvent.click(within(acquired).getByText('Acquired (1)'))
    expect(within(acquired).getByText('Cruel Barb')).toBeTruthy()
  })
})
