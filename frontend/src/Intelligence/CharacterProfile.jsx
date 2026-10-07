import EquipmentPaperDoll from './EquipmentPaperDoll.jsx'
import ProfessionCards from './ProfessionCards.jsx'
import RecipeBrowser from './RecipeBrowser.jsx'
import TalentTree from './TalentTree.jsx'
import { formatSyncAge } from './model.js'
import './CharacterArmory.css'

const characterProfileTabs = [
  ['overview', 'Overview'],
  ['equipment', 'Equipment'],
  ['talents', 'Talents'],
  ['professions', 'Professions'],
  ['recipes', 'Recipes'],
]

function classKey(value) {
  return String(value || 'adventurer').toLowerCase().replace(/[^a-z]+/g, '-')
}

function formatValue(value) {
  if (typeof value === 'number') return new Intl.NumberFormat().format(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function Overview({ armory }) {
  const statEntries = Object.entries(armory.stats).slice(0, 12)
  return (
    <div className="armory-overview">
      <section className="armory-panel">
        <div className="armory-panel__heading"><span>Character</span><h2>At a glance</h2></div>
        <dl className="armory-facts">
          <div><dt>Realm</dt><dd>{armory.character.realm || 'Unknown'}</dd></div>
          <div><dt>Guild</dt><dd>{armory.character.guildName || 'No guild reported'}</dd></div>
          <div><dt>Game build</dt><dd>{armory.character.gameBuild || 'Not reported'}</dd></div>
          <div><dt>Telemetry</dt><dd>{formatSyncAge(armory.character.lastSeenAt)}</dd></div>
        </dl>
      </section>
      <section className="armory-panel">
        <div className="armory-panel__heading"><span>Stats</span><h2>Snapshot</h2></div>
        {statEntries.length ? (
          <dl className="armory-stats">
            {statEntries.map(([key, value]) => <div key={key}><dt>{key.replace(/([A-Z])/g, ' $1')}</dt><dd>{formatValue(value)}</dd></div>)}
          </dl>
        ) : <p className="armory-muted">No combat stats were included in this snapshot.</p>}
      </section>
      <section className="armory-panel armory-panel--wide">
        <div className="armory-panel__heading"><span>Professions</span><h2>Craft</h2></div>
        <ProfessionCards professions={armory.professions} />
      </section>
    </div>
  )
}

function CharacterHero({ character }) {
  return (
    <header className="armory-hero" data-class={classKey(character.className)}>
      <div className="armory-hero__portrait" aria-hidden="true"><span>♜</span></div>
      <div className="armory-hero__identity">
        <p>{character.isMain ? 'Main character' : 'Synced character'}</p>
        <h2>{character.name}</h2>
        <div>
          <span>Level {character.level || '?'}</span>
          <span>{character.race || 'Race unknown'}</span>
          <span>{character.spec || character.className || 'Class unknown'}</span>
        </div>
      </div>
      <div className="armory-hero__guild">
        <strong>{character.guildName || character.organization?.name || 'No guild reported'}</strong>
        <span>{character.memberRank ? `${character.memberRank} · ` : ''}{character.memberName || 'Guild member'}</span>
        <small>{formatSyncAge(character.lastSeenAt)}</small>
      </div>
    </header>
  )
}

export default function CharacterProfile({
  armory,
  tab = 'overview',
  onTabChange,
  showHero = true,
  className = '',
}) {
  const character = armory.character
  const activeTab = characterProfileTabs.some(([value]) => value === tab) ? tab : 'overview'

  return (
    <div className={`character-profile${className ? ` ${className}` : ''}`}>
      {showHero ? <CharacterHero character={character} /> : null}

      <nav className="armory-tabs" aria-label="Character profile sections">
        {characterProfileTabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={activeTab === value ? 'armory-tabs__active' : ''}
            aria-pressed={activeTab === value}
            onClick={() => onTabChange?.(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      <section className="armory-content">
        {activeTab === 'overview' ? <Overview armory={armory} /> : null}
        {activeTab === 'equipment' ? <EquipmentPaperDoll equipment={armory.equipment} className={character.className} race={character.race} /> : null}
        {activeTab === 'talents' ? <TalentTree talents={armory.talents} /> : null}
        {activeTab === 'professions' ? <ProfessionCards professions={armory.professions} /> : null}
        {activeTab === 'recipes' ? <RecipeBrowser recipes={armory.recipes} /> : null}
      </section>
    </div>
  )
}
