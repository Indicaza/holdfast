import { useMemo } from 'react'

import WishlistImport from '../WishlistImport.jsx'
import { appropriateDungeons, planScope } from './atlasModel.js'

// Plan My Gear: the existing AI wishlist builder (copy prompt → paste
// JSON → check → confirm), with the planning prompt narrowed to one
// dungeon, every dungeon the character's level suits, or everything.
export default function PlanMyGear({ character, dungeon = null, dungeons = [], onImported, onClose }) {
  const scopes = useMemo(() => {
    const list = []
    if (dungeon) list.push({ id: 'dungeon', label: `Only ${dungeon.name}`, instanceIds: planScope('dungeon', { dungeon }) })
    const fitting = appropriateDungeons(dungeons, character)
    if (fitting.length) list.push({ id: 'appropriate', label: `Dungeons for level ${character.level} (${fitting.length})`, instanceIds: planScope('appropriate', { dungeons, character }) })
    list.push({ id: 'all', label: 'Every dungeon', instanceIds: [] })
    return list
  }, [dungeon, dungeons, character])
  return (
    <WishlistImport character={character} dungeon={dungeon} scopes={scopes} initialScope={scopes[0].id} title="Plan my gear"
      onClose={onClose} onImported={onImported} />
  )
}
