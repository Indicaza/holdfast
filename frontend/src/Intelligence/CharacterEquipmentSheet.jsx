import CharacterStats from './CharacterStats.jsx'
import EquipmentPaperDoll from './EquipmentPaperDoll.jsx'
import './CharacterEquipmentSheet.css'

// UI-Character-Info-<Class>-BG: the stat pane's class crest background.
const CLASS_ART = new Set(['druid', 'hunter', 'mage', 'paladin', 'priest', 'rogue', 'shaman', 'warlock', 'warrior'])

function statsArt(className) {
  const key = String(className || '').toLowerCase().replace(/[^a-z]/g, '')
  return `url("/armory-art/stats-${CLASS_ART.has(key) ? key : 'default'}.webp")`
}

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

      <aside className="character-sheet__stats" aria-label="Character stats" style={{ '--character-stats-art': statsArt(className) }}>
        <CharacterStats stats={stats} className={className} level={level} />
      </aside>
    </div>
  )
}
