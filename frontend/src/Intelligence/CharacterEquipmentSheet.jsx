import CharacterStats from './CharacterStats.jsx'
import EquipmentPaperDoll from './EquipmentPaperDoll.jsx'
import './CharacterEquipmentSheet.css'

export default function CharacterEquipmentSheet({
  equipment = [],
  stats = {},
  className = '',
  race = '',
}) {
  return (
    <div className="character-sheet">
      <section className="character-sheet__equipment" aria-label="Equipped items">
        <div className="character-sheet__section-heading">
          <span>Character</span>
          <h2>Equipment</h2>
        </div>
        <EquipmentPaperDoll
          equipment={equipment}
          className={className}
          race={race}
          showDetail
          selectOnLoad={false}
          compactDetail
          compact
        />
      </section>

      <aside className="character-sheet__stats" aria-label="Character stats">
        <CharacterStats stats={stats} variant="sheet" />
      </aside>
    </div>
  )
}
