import { useEffect, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import Modal from '../Modal/Modal.jsx'
import CharacterProfile from './CharacterProfile.jsx'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import { formatSyncAge, normalizeArmory } from './model.js'
import './CharacterProfileModal.css'

export default function CharacterProfileModal({ characterId, onClose }) {
  const [status, setStatus] = useState('loading')
  const [armory, setArmory] = useState(() => normalizeArmory({}))
  const [tab, setTab] = useState('overview')

  useEffect(() => {
    if (!characterId) return undefined
    const controller = new AbortController()
    let active = true
    setStatus('loading')
    setTab('overview')

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
  const intro = status === 'ready'
    ? `${character.level ? `Level ${character.level} · ` : ''}${character.race || 'Race unknown'} · ${character.spec || character.className || 'Class unknown'} · ${formatSyncAge(character.lastSeenAt)}`
    : 'Opening the latest Guildweaver snapshot.'

  return (
    <Modal eyebrow="GuildOS Armory" title={title} intro={intro} size="armory" align="left" onClose={onClose}>
      <div className="character-profile-modal">
        {status === 'loading' ? <p className="armory-state">Opening the latest character snapshot…</p> : null}
        {status === 'error' ? <EmptyTelemetry title="The profile could not be loaded.">Guildweaver telemetry is temporarily unavailable.</EmptyTelemetry> : null}
        {status === 'missing' ? <EmptyTelemetry title="Character not found.">This character may not have synced yet, or its telemetry was removed.</EmptyTelemetry> : null}
        {status === 'ready' ? (
          <>
            <div className="character-profile-modal__meta">
              <span>{character.guildName || character.organization?.name || 'No guild reported'}</span>
              <span>{character.realm || 'Realm unknown'}</span>
              <a href={`/armory/${encodeURIComponent(character.id)}`}>Open full profile ↗</a>
            </div>
            <CharacterProfile armory={armory} tab={tab} onTabChange={setTab} showHero={false} />
          </>
        ) : null}
      </div>
    </Modal>
  )
}
