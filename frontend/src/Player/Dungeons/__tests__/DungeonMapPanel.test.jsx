import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { journalMapProps } from '../atlasModel.js'
import { DungeonMapPanel, JournalMap } from '../DungeonMapPanel.jsx'

const floor = (index, name) => ({ floorId: `journal-36-${index}`, index, name, imageUrl: `/map-${index}.png`, width: 1002, height: 668, attribution: 'Fixture' })
const ATLAS = {
  name: 'The Deadmines',
  bosses: [{ encounterId: 1, name: "Rhahk'Zor" }, { encounterId: 2, name: 'Sneed' }, { encounterId: 3, name: 'Edwin VanCleef' }, { encounterId: 4, name: 'Unplaced' }],
  journalMap: {
    floors: [floor(1, 'The Deadmines'), floor(2, 'Ironclad Cove')],
    pins: [{ bossKey: '1', floorId: 'journal-36-1', x: 0.3653, y: 0.6123 }, { bossKey: '2', floorId: 'journal-36-1', x: 0.502, y: 0.8683 }, { bossKey: '3', floorId: 'journal-36-2', x: 0.6076, y: 0.4489 }],
  },
}

describe('the dungeon map', () => {
  afterEach(cleanup)

  test('pins are numbered as in the encounter list, on their own floor, placed in percent', () => {
    const { floors, pins } = journalMapProps(ATLAS)
    render(<DungeonMapPanel dungeonName="The Deadmines" floors={floors} pins={pins} floorId="journal-36-2" />)
    expect(screen.getByRole('img', { name: 'Map of Ironclad Cove' }).getAttribute('src')).toBe('/map-2.png')
    const pin = screen.getByRole('button', { name: 'Edwin VanCleef, boss 3, on the map' })
    expect(pin.style.left).toBe('60.76%')
    expect(pin.style.top).toBe('44.89%')
    expect(screen.queryByRole('button', { name: /Sneed/ })).toBeNull()
  })

  test('switching floors changes the picture and pins', () => {
    render(<JournalMap atlas={ATLAS} />)
    expect(screen.getByRole('button', { name: /Sneed/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ironclad Cove' }))
    expect(screen.getByRole('img', { name: 'Map of Ironclad Cove' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Sneed/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Ironclad Cove' }).getAttribute('aria-pressed')).toBe('true')
  })

  test('a pin selects its boss; selecting a boss turns to its floor and highlights its pin', () => {
    const onBoss = vi.fn()
    function Host() {
      const [selected, setSelected] = useState('1')
      return (
        <>
          <button type="button" onClick={() => setSelected('3')}>choose VanCleef</button>
          <JournalMap atlas={ATLAS} selectedKey={selected} onBoss={(boss) => { onBoss(boss.name); setSelected(String(boss.encounterId)) }} />
        </>
      )
    }
    render(<Host />)
    expect(screen.getByRole('button', { name: /Rhahk/ }).getAttribute('aria-current')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /Sneed/ }))
    expect(onBoss).toHaveBeenCalledWith('Sneed')
    expect(screen.getByRole('button', { name: /Sneed/ }).className).toContain('is-active')
    fireEvent.click(screen.getByRole('button', { name: 'choose VanCleef' }))
    expect(screen.getByRole('img', { name: 'Map of Ironclad Cove' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Edwin/ }).getAttribute('aria-current')).toBe('true')
  })

  test('no map shows the fallback, never another picture', () => {
    render(<DungeonMapPanel floors={[]} empty={<p>No map</p>} />)
    expect(screen.getByText('No map')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    expect(journalMapProps({ bosses: [] })).toBeNull()
  })
})
