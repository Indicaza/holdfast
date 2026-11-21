// The dungeon view with published (or previewed) editorial content: the
// studio's fields render in the real components. Fixture data only.
import { fireEvent, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import DungeonDetailModal from '../DungeonDetailModal.jsx'
import { mockApi, renderWithSession, resetHarness } from './harness.jsx'

const detail = {
  schemaVersion: 1, revision: 0,
  instance: { instanceId: 3065, name: 'The Hall of Thanes', type: 'party' },
  difficulties: {}, sources: [], changes: [],
  atlas: {
    origin: 'forever', kind: 'dungeon', levelMin: 13, levelMax: 20, zoneName: 'Ironforge', zoneMapId: 1455, entrance: { mapId: 1455, x: 0.277, y: 0.479 },
    subtitle: 'Fixture subtitle', description: 'Fixture lore.', maps: [], creatures: [], rares: [], quests: [], provenance: [], dungeonLoot: [], floorNames: [],
    artworkUrl: '/api/atlas-media/m_fixture0001/web',
    bosses: [{ encounterId: null, npcId: 261306, name: 'Faldrim Anvilmar', atlasName: 'Faldrim Anvilmar', abilities: [], loot: [], referenceLoot: [], unresolvedLoot: [],
      strategy: { summary: 'Fixture strategy.' }, positioning: 'Fixture positioning.',
      mechanics: [{ id: 'shadow-bolt', ability: 'Shadow Bolt', type: 'interrupt', priority: 'high', instruction: 'Interrupt whenever possible.', roles: ['dps', 'tank'], verified: true }] }],
    editorial: { revision: '3', preview: true, tips: ['Fixture tip'], preparation: [], warnings: ['Fixture warning'], groupComposition: null, routeNotes: 'Fixture route.',
      questNotes: null, attribution: 'Fixture attribution', art: { card: { url: '/api/atlas-media/m_fixture0001/web', focusX: 0.25, focusY: 0.5 }, overview: null, map: null } },
  },
}

function Preview() {
  const [view, setView] = useState({ section: 'overview', boss: '' })
  return <DungeonDetailModal instanceId="3065" previewDetail={detail} embedded section={view.section || 'overview'} boss={view.boss} onNavigate={setView} onClose={() => {}} showMapLink={false} />
}

describe('editorial content in the dungeon view', () => {
  beforeEach(() => {
    resetHarness()
    mockApi([])
  })
  afterEach(() => resetHarness())

  it('renders the preview in place, without fetching, with notes and mechanics', () => {
    renderWithSession(<Preview />)
    expect(screen.getByRole('region', { name: 'The Hall of Thanes' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Fixture subtitle')).toBeTruthy()
    expect(screen.getByText('Fixture warning')).toBeTruthy()
    expect(screen.getByText('Fixture route.')).toBeTruthy()
    expect(document.body.style.overflow).toBe('', 'an embedded preview does not lock the page')
    expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/loot/dungeons/3065'), expect.anything())

    fireEvent.click(screen.getByRole('button', { name: /Faldrim Anvilmar/ }))
    const mechanics = screen.getByRole('region', { name: 'Mechanics' })
    expect(mechanics.textContent).toContain('Shadow Bolt')
    expect(mechanics.textContent).toContain('Interrupt whenever possible.')
    expect(mechanics.textContent).toContain('Verified on Forever')
    expect(screen.getByText('Fixture positioning.')).toBeTruthy()
  })
})
