import { bossKey, journalMapProps } from './atlasModel.js'
import { useJournalFloor } from './useJournalFloor.js'

// One dungeon's real map: its floors, boss pins and the selected encounter.
// Fully controlled and free of page layout, so it can sit in any panel.
//   floors: [{ floorId, name, imageUrl, width, height, attribution }]
//   pins:   [{ bossKey, name, number, floorId, x, y }] (x, y: 0–1 of the picture)
export function DungeonMapPanel({ dungeonName = '', floors = [], pins = [], floorId, onFloorChange, selectedKey = '', onSelectPin, empty = null }) {
  const floor = floors.find((entry) => entry.floorId === floorId) || floors[0]
  if (!floor) return empty
  const floorName = (entry, index) => entry.name || `Floor ${index + 1}`
  const placed = pins.filter((pin) => pin.floorId === floor.floorId)
  return (
    <figure className="gw-dmap" data-floor={floor.floorId}>
      <div className="gw-dmap__stage">
      <div className="gw-dmap__frame" style={{ '--map-ratio': (floor.width || 1002) / (floor.height || 668), aspectRatio: `${floor.width || 1002} / ${floor.height || 668}` }}>
        <img src={floor.imageUrl} alt={`Map of ${floorName(floor, floors.indexOf(floor))}`} draggable="false" />
        {floors.length > 3 ? (
          <label className="gw-dmap__floors gw-dmap__floors--select">
            <span className="gw-dmap__sr">{dungeonName || 'Dungeon'} floor</span>
            <select value={floor.floorId} onChange={(event) => onFloorChange?.(event.target.value)}>
              {floors.map((entry, index) => <option key={entry.floorId} value={entry.floorId}>{index + 1}. {floorName(entry, index)}</option>)}
            </select>
          </label>
        ) : floors.length > 1 ? (
          <div className="gw-dmap__floors" role="group" aria-label={`${dungeonName || 'Dungeon'} floors`}>
            {floors.map((entry, index) => (
              <button key={entry.floorId} type="button" aria-pressed={entry.floorId === floor.floorId} onClick={() => onFloorChange?.(entry.floorId)}>{floorName(entry, index)}</button>
            ))}
          </div>
        ) : null}
        {placed.map((pin) => (
          <button key={pin.bossKey} type="button" className={`gw-atlas-floor__marker gw-dmap__pin${pin.bossKey === selectedKey ? ' is-active' : ''}`}
            style={{ left: `${(pin.x * 100).toFixed(2)}%`, top: `${(pin.y * 100).toFixed(2)}%` }} aria-label={`${pin.name}, boss ${pin.number}, on the map`}
            aria-current={pin.bossKey === selectedKey ? 'true' : undefined} title={pin.name} onClick={() => onSelectPin?.(pin.bossKey)}>
            {pin.number}
          </button>
        ))}
        <figcaption className="gw-dmap__credit">
          {floors.length === 1 && floor.name ? `${floor.name}. ` : ''}
          {placed.length ? '' : 'No boss is placed on this floor. '}
          {floor.attribution ? `Map: ${floor.attribution}` : ''}
        </figcaption>
      </div>
      </div>
    </figure>
  )
}

// Holds the floor; choosing an encounter turns to the floor its pin is on.
export function JournalMap({ atlas, selectedKey = '', onBoss }) {
  const map = journalMapProps(atlas)
  const [floorId, setFloorId] = useJournalFloor(map, selectedKey)
  if (!map) return null
  const select = (key) => {
    const boss = atlas.bosses.find((entry) => bossKey(entry) === key)
    if (boss) onBoss?.(boss)
  }
  return <DungeonMapPanel dungeonName={atlas.name} floors={map.floors} pins={map.pins} floorId={floorId} onFloorChange={setFloorId} selectedKey={selectedKey} onSelectPin={select} />
}
