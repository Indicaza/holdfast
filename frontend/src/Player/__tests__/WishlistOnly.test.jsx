import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import DungeonLoot from '../DungeonLoot.jsx'

const mocks = vi.hoisted(() => ({
  urls: [],
  mutations: [],
  failNext: false,
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

const originalWishlist = mocks.wishlist

vi.mock('../../Auth/sessionContext.js', () => ({ useSession: () => ({ refresh: vi.fn(), signIn: vi.fn() }) }))
vi.mock('../../Auth/authenticatedMutation.js', () => ({
  runAuthenticatedMutation: async (args) => {
    mocks.mutations.push(args)
    if (mocks.failNext) {
      mocks.failNext = false
      throw new Error('A simulated network failure')
    }
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
  mocks.failNext = false
  mocks.wishlist = originalWishlist
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
    expect(within(screen.getByRole('list', { name: 'Wanted items' })).getByRole('link', { name: /Mutanus the Devourer/ })).toBeTruthy()
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

  test('a failed note save leaves the draft and offers an inline retry', async () => {
    mocks.failNext = true
    renderWishlist()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Mutant Scale Breastplate details' }))
    const field = screen.getByLabelText('Note for Mutant Scale Breastplate')
    fireEvent.change(field, { target: { value: 'Need this for tanking' } })
    expect(screen.getByText('Unsaved note')).toBeTruthy()
    fireEvent.blur(field)
    await waitFor(() => expect(screen.getByText('Note not saved.')).toBeTruthy())
    expect(field.value).toBe('Need this for tanking')
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
    await waitFor(() => expect(screen.getByText('Note saved')).toBeTruthy())
    expect(mocks.mutations).toHaveLength(2)
  })

  test('multiple drop sources can all open their dungeon journal', () => {
    mocks.wishlist = {
      ...originalWishlist,
      items: [{
        ...originalWishlist.items[0],
        sources: [
          originalWishlist.items[0].sources[0],
          { source: 'Cavern Creeper', dungeon: 'Wailing Caverns', instanceId: 43 },
          { source: 'Defias Pirate', dungeon: 'Deadmines', instanceId: 36 },
          { source: 'Unknown', dungeon: 'Unmapped' },
        ],
      }],
    }
    renderWishlist()
    const firstSource = screen.getAllByRole('link', { name: /Mutanus the Devourer/ })[0]
    expect(firstSource.getAttribute('href')).toContain('open=43')
    const summary = screen.getByText('All 4 drop sources')
    fireEvent.click(summary)
    const sourceList = summary.closest('details')
    expect(within(sourceList).getByRole('link', { name: /Defias Pirate/ }).getAttribute('href')).toContain('open=36')
    expect(within(sourceList).getByText('Unknown · Unmapped')).toBeTruthy()
  })

  test('completed wishlists acknowledge acquired items instead of claiming to be empty', () => {
    mocks.wishlist = { ...originalWishlist, items: [originalWishlist.items[1]] }
    renderWishlist()
    expect(screen.getByText('All caught up — every wishlisted item is acquired.')).toBeTruthy()
    expect(screen.queryByText('No items on your wishlist yet.')).toBeNull()
    expect(screen.getByText('Acquired (1)')).toBeTruthy()
  })
})
