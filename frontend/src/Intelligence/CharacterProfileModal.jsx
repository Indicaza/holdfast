import { useEffect, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import Modal from '../Modal/Modal.jsx'
import CharacterProfile, { CharacterHeader } from './CharacterProfile.jsx'
import { classIdentity } from './classIdentity.js'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import { normalizeArmory } from './model.js'
import './CharacterProfileModal.css'

export default function CharacterProfileModal({ characterId, onClose }) {
  const [status, setStatus] = useState('loading')
  const [armory, setArmory] = useState(() => normalizeArmory({}))
  const [tab, setTab] = useState('equipment')

  useEffect(() => {
    if (!characterId) return undefined
    const controller = new AbortController()
    let active = true
    setStatus('loading')
    setTab('equipment')

    apiJson(`/api/intelligence/characters/${encodeURIComponent(characterId)}`, { signal: controller.signal })
      .then((payload) => {
        if (!active) return
        setArmory(normalizeArmory(payload))
        setStatus('ready')
      })
      .catch((error) => {
        if (!active || error?.name === 'AbortError') return
        setStatus(error?.status === 404 ? 'missing' : 'error')
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [characterId])

  if (!characterId) return null

  const character = armory.character
  const title = status === 'ready' ? character.name : 'Character profile'

  return (
    <Modal title={title} ariaLabel={title} hideHeader size="armory" align="left" onClose={onClose}>
      <div className="armory-shell" style={status === 'ready' ? { '--armory-class-color': classIdentity(character.className).color } : undefined}>
        <CharacterHeader character={character} stats={armory.stats} loading={status !== 'ready'} />
        {status === 'ready' ? <CharacterProfile armory={armory} tab={tab} onTabChange={setTab} /> : (
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
