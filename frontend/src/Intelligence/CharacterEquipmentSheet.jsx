import CharacterStats from './CharacterStats.jsx'
import EquipmentPaperDoll from './EquipmentPaperDoll.jsx'
import { statsArt } from './characterArt.js'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import './CharacterEquipmentSheet.css'

export default function CharacterEquipmentSheet({
  equipment = [],
  stats = {},
  className = '',
  race = '',
  level = null,
}) {
  // With nothing synced, an empty paper doll is 19 blank slots: say so instead.
  const hasGear = (equipment || []).some((entry) => entry?.itemId || entry?.name)
  const hasStats = ['attributes', 'offense', 'defense'].some((group) => Object.keys(stats?.[group] || {}).length)
  if (!hasGear && !hasStats) {
    return (
      <EmptyTelemetry title="No gear or stats synced yet.">
        Log in with this character, open the character sheet, then <kbd>/reload</kbd>.
      </EmptyTelemetry>
    )
  }
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
