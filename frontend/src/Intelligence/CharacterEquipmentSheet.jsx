import CharacterStats from './CharacterStats.jsx'
import EquipmentPaperDoll from './EquipmentPaperDoll.jsx'
import './CharacterEquipmentSheet.css'

export default function CharacterEquipmentSheet({
  equipment = [],
  stats = {},
  className = '',
  race = '',
  level = null,
}) {
  return (
    <div className="character-sheet">
      <section className="character-sheet__equipment" aria-label="Equipped items">
        <EquipmentPaperDoll
          equipment={equipment}
          className={className}
          race={race}
          showDetail={false}
          selectOnLoad={false}
          compact
          variant="sheet"
        />
      </section>

      <aside className="character-sheet__stats" aria-label="Character stats">
        <CharacterStats stats={stats} className={className} level={level} />
      </aside>
    </div>
  )
}
