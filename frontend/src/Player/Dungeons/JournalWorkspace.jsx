import { useState } from 'react'

import { Icon } from '../ui.jsx'
import { bossKey, journalMapProps } from './atlasModel.js'
import { DungeonMapPanel } from './DungeonMapPanel.jsx'
import { BossDetail, BossRail } from './JournalContent.jsx'
import { useJournalFloor } from './useJournalFloor.js'

const PANES = {
  journal: [['map', 'Map'], ['encounters', 'Encounters'], ['details', 'Details']],
  quests: [['map', 'Map'], ['checklist', 'Checklist']],
}

// A dungeon's interior map, or one quiet line where it has none.
function MapPanel({ name, map, floorId, onFloor, selectedKey, onPin }) {
  return (
    <section className={`gw-jw-map${map ? '' : ' gw-jw-map--none'}`} aria-label="Map">
      <DungeonMapPanel dungeonName={name} floors={map?.floors} pins={map?.pins} floorId={floorId} onFloorChange={onFloor} selectedKey={selectedKey} onSelectPin={onPin}
        empty={<p className="gw-jw-nomap"><Icon name="map" size={16} /><span><strong>No map of {name} yet.</strong> Its bosses are in the list.</span></p>} />
    </section>
  )
}

// The Journal's panels, the same in the Dungeons page, a dialog over the
// world map and the Studio's preview: encounters, the map and the chosen
// encounter; the map and the quest checklist; or the run history. On a narrow
// screen one panel shows at a time.
export default function JournalWorkspace({ name, section, atlas, boss, allLoot, onBoss, onOverview, onAllLoot, sourceRows, overview, loot, quests, runs, role, onRole, character, lootProps, startOnFirstBoss = true }) {
  // The dock always has a boss's loot to show, until the player asks for the
  // dungeon's overview. The Studio's preview starts on the overview.
  const [overviewChosen, setOverviewChosen] = useState(!startOnFirstBoss)
  const [mechanicsOpen, setMechanicsOpen] = useState(false)
  // A dungeon played as wings opens on its overview, where the wings are.
  const startsOnOverview = overviewChosen || (atlas.wingEntries?.length > 0 && !atlas.wing)
  const selected = atlas.bosses.find((entry) => bossKey(entry) === boss) || (startsOnOverview ? null : atlas.bosses[0] || null)
  const selectedKey = selected ? bossKey(selected) : ''
  const map = journalMapProps(atlas)
  const [floorId, setFloorId] = useJournalFloor(map, selectedKey)
  const [journalPane, setJournalPane] = useState(boss || allLoot ? 'details' : 'map')
  const [questPane, setQuestPane] = useState('checklist')
  if (section === 'runs') return <div className="gw-jw gw-jw--runs"><div className="gw-jw-scroll gw-atlas-section">{runs}</div></div>

  const quest = section === 'quests'
  const pane = quest ? questPane : journalPane
  const setPane = quest ? setQuestPane : setJournalPane
  const chooseBoss = (target) => {
    setOverviewChosen(false)
    setJournalPane('details')
    onBoss(target)
  }
  const mapPanel = <MapPanel name={name} map={map} floorId={floorId} onFloor={setFloorId} selectedKey={selectedKey} onPin={(key) => chooseBoss(atlas.bosses.find((entry) => bossKey(entry) === key))} />
  const paneBar = (
    <div className="gw-jw-panes" role="group" aria-label="Show">
      {PANES[section].map(([id, label]) => <button key={id} type="button" aria-pressed={pane === id} onClick={() => setPane(id)}>{label}</button>)}
    </div>
  )

  if (quest) {
    return (
      <div className={`gw-jw gw-jw--quests${map ? '' : ' gw-jw--nomap'}`} data-pane={pane}>
        {paneBar}
        {mapPanel}
        <section className="gw-jw-panel gw-jw-checklist" aria-label="Preparation checklist"><div className="gw-jw-scroll">{quests}</div></section>
      </div>
    )
  }

  const index = selected ? atlas.bosses.indexOf(selected) : -1
  return (
    <div className={`gw-jw gw-jw--journal${map ? '' : ' gw-jw--nomap'}${atlas.bosses.length ? '' : ' gw-jw--norail'}`} data-pane={pane}>
      {paneBar}
      {atlas.bosses.length ? (
        <div className="gw-jw-panel gw-jw-encounters">
          <BossRail bosses={atlas.bosses} selected={selected} onBoss={chooseBoss} onOverview={() => { setOverviewChosen(true); setJournalPane('details'); onOverview() }} sourceRows={sourceRows} wishes={lootProps?.wishes} numbered={Boolean(map?.pins.length)} />
        </div>
      ) : null}
      {mapPanel}
      <section className="gw-jw-panel gw-jw-details" aria-label="Encounter details">
        <div className="gw-jw-dock">
          {allLoot ? <div className="gw-jw-scroll"><h3 className="gw-jw-dock__title">All loot in {name}</h3>{loot}</div>
            : selected ? <BossDetail key={selectedKey} boss={selected} index={index} bosses={atlas.bosses} atlas={atlas} rows={sourceRows(selected)} onBoss={chooseBoss} role={role} onRole={onRole} character={character} lootProps={lootProps} mechanicsOpen={mechanicsOpen} onMechanics={setMechanicsOpen} />
              : <div className="gw-jw-scroll">{overview}</div>}
        </div>
        <button type="button" className="gw-jw-lootswitch" aria-pressed={allLoot} onClick={() => onAllLoot(!allLoot)}><Icon name="loot" size={13} /> All loot</button>
      </section>
    </div>
  )
}
