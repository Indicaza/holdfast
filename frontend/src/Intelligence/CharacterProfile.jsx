import { useId, useRef } from 'react'

import CharacterEquipmentSheet from './CharacterEquipmentSheet.jsx'
import InventoryPane from './InventoryPane.jsx'
import ProfessionsPane from './ProfessionsPane.jsx'
import TalentTree from './TalentTree.jsx'
import { CharacterFacts, SyncBadge, UnitFrame } from './CharacterIdentity.jsx'
import './CharacterArmory.css'

function talentPoints(talents) {
  const nodes = Array.isArray(talents?.nodes) ? talents.nodes : []
  return nodes.reduce((sum, node) => sum + (Number(node?.rank) || 0), 0)
}

// Each tab is one entry: add a section by adding a row here.
const characterProfileTabs = [
  {
    id: 'equipment',
    label: 'Equipment',
    render: ({ armory, character }) => (
      <CharacterEquipmentSheet equipment={armory.equipment} stats={armory.stats} className={character.className} race={character.race} level={character.level} />
    ),
  },
  {
    id: 'talents',
    label: 'Talents',
    badge: (armory) => talentPoints(armory.talents) || null,
    render: ({ armory, character }) => <TalentTree talents={armory.talents} className={character.className} level={character.level} />,
  },
  {
    id: 'professions',
    label: 'Professions',
    badge: (armory) => armory.professions.length || null,
    render: ({ armory }) => <ProfessionsPane professions={armory.professions} recipes={armory.recipes} />,
  },
  {
    id: 'inventory',
    label: 'Inventory',
    badge: (armory) => armory.inventory?.usedSlots || null,
    render: ({ armory, character }) => <InventoryPane inventory={armory.inventory} className={character.className} />,
  },
]

export function CharacterHeader({ character, stats, loading = false }) {
  if (loading) {
    return (
      <header className="armory-header armory-header--loading" aria-hidden="true">
        <div className="unit-frame unit-frame--card">
          <span className="unit-frame__portrait" />
          <div className="unit-frame__body">
            <div className="unit-frame__nameplate"><span className="character-skeleton" /></div>
            <div className="unit-frame__bars" />
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className="armory-header">
      {/* The same frame as the character list cards, guild and rank along the bottom. */}
      <UnitFrame
        character={character}
        health={stats?.resources?.health}
        power={stats?.resources?.power}
        className="unit-frame--card"
        showAffiliation
      />
      <CharacterFacts character={character} />
      <SyncBadge lastSeenAt={character.lastSeenAt} showLabel focusable />
    </header>
  )
}

export default function CharacterProfile({ armory, tab = 'equipment', onTabChange }) {
  const character = armory.character
  const baseId = useId()
  const tabRefs = useRef(new Map())
  const requestedTab = tab === 'stats' || tab === 'overview' ? 'equipment' : tab === 'recipes' ? 'professions' : tab
  const active = characterProfileTabs.find((entry) => entry.id === requestedTab) || characterProfileTabs[0]

  function focusTab(index) {
    const next = characterProfileTabs[(index + characterProfileTabs.length) % characterProfileTabs.length]
    onTabChange?.(next.id)
    tabRefs.current.get(next.id)?.focus()
  }

  function handleKeyDown(event) {
    const index = characterProfileTabs.findIndex((entry) => entry.id === active.id)
    const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: characterProfileTabs.length - 1 }
    if (!(event.key in moves)) return
    event.preventDefault()
    focusTab(moves[event.key])
  }

  return (
    <div className="character-profile" data-active-tab={active.id}>
      <div className="armory-tabs" role="tablist" aria-label="Character sections" onKeyDown={handleKeyDown}>
        {characterProfileTabs.map((entry) => {
          const selected = entry.id === active.id
          const badge = entry.badge?.(armory)
          return (
            <button
              key={entry.id}
              ref={(element) => (element ? tabRefs.current.set(entry.id, element) : tabRefs.current.delete(entry.id))}
              id={`${baseId}-tab-${entry.id}`}
              type="button"
              role="tab"
              className="armory-tabs__tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onTabChange?.(entry.id)}
            >
              <span>{entry.label}</span>
              {badge !== null && badge !== undefined ? <span className="armory-tabs__badge">{badge}</span> : null}
            </button>
          )
        })}
      </div>

      <section
        id={`${baseId}-panel`}
        className={`armory-content armory-content--${active.id}`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${active.id}`}
        data-tab={active.id}
      >
        {active.render({ armory, character })}
      </section>
    </div>
  )
}
