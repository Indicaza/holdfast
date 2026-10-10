import { useCallback, useEffect, useState } from 'react'

import { useLiveResource } from '../Live/useLiveResource.js'
import Modal from '../Modal/Modal.jsx'
import CharacterProfile, { CharacterHeader } from './CharacterProfile.jsx'
import { classIdentity } from './classIdentity.js'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import { normalizeArmory } from './model.js'
import './CharacterProfileModal.css'

const EMPTY_ARMORY = normalizeArmory({})

// The character modal. Its armory refreshes in place whenever this character's
// telemetry changes (live "character changed" events name the character), so
// the open tab and scroll position survive while new data streams in.
export default function CharacterProfileModal({ characterId, onClose }) {
  const [tab, setTab] = useState('equipment')
  const matches = useCallback((event) => event.entityId === characterId, [characterId])
  const { status, data } = useLiveResource(
    characterId ? `/api/intelligence/characters/${encodeURIComponent(characterId)}` : null,
    { topics: ['armory'], matches, select: normalizeArmory },
  )

  useEffect(() => {
    setTab('equipment')
  }, [characterId])

  if (!characterId) return null

  const armory = data || EMPTY_ARMORY
  const ready = status === 'ready'
  const character = armory.character
  const title = ready ? character.name : 'Character profile'

  return (
    <Modal title={title} ariaLabel={title} hideHeader size="armory" align="left" onClose={onClose}>
      <div className="armory-shell" style={ready ? { '--armory-class-color': classIdentity(character.className).color } : undefined}>
        <CharacterHeader character={character} stats={armory.stats} loading={!ready} />
        {ready ? <CharacterProfile armory={armory} tab={tab} onTabChange={setTab} /> : (
          <div className="armory-shell__state">
            {status === 'loading' ? <p className="armory-state">Opening the latest character snapshot…</p> : null}
            {status === 'error' ? <EmptyTelemetry title="The profile could not be loaded.">Guildweaver telemetry is temporarily unavailable.</EmptyTelemetry> : null}
            {status === 'missing' ? <EmptyTelemetry title="Character not found.">This character may not have synced yet, or its telemetry was removed.</EmptyTelemetry> : null}
          </div>
        )}
      </div>
    </Modal>
  )
}
