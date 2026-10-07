import { useEffect, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import { useSession } from '../Auth/sessionContext.js'
import Home from '../Home/Home.jsx'
import MemberAccessModal from '../Members/MemberAccessModal.jsx'
import PageShell from '../PageShell/PageShell.jsx'
import CharacterProfile from './CharacterProfile.jsx'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import { normalizeArmory } from './model.js'
import './CharacterArmory.css'

export default function CharacterArmory({ characterId }) {
  const session = useSession()
  const [status, setStatus] = useState('loading')
  const [armory, setArmory] = useState(() => normalizeArmory({}))
  const [tab, setTab] = useState(() => window.location.hash.replace('#', '') || 'overview')

  useEffect(() => {
    if (!session.authenticated) {
      setStatus('ready')
      return undefined
    }

    const controller = new AbortController()
    let active = true
    setStatus('loading')

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
  }, [characterId, session.authenticated])

  const closeGate = () => window.location.assign('/')
  if (session.status === 'loading' || session.status === 'error' || !session.authenticated) {
    return <Home overlay={<MemberAccessModal returnTo={`/armory/${encodeURIComponent(characterId)}`} onClose={closeGate} />} />
  }

  const character = armory.character
  const title = status === 'ready' ? character.name : 'Character Armory'

  function chooseTab(next) {
    setTab(next)
    window.history.replaceState(null, '', `${window.location.pathname}#${next}`)
  }

  return (
    <PageShell
      eyebrow="GuildOS Armory"
      title={title}
      intro={status === 'ready' ? `${character.race || 'Unknown race'} · ${character.className || 'Unknown class'}${character.spec ? ` · ${character.spec}` : ''}` : 'Opening the latest Guildweaver snapshot.'}
      className="armory-page"
    >
      {status === 'loading' ? <p className="armory-state">Opening the armory…</p> : null}
      {status === 'error' ? <EmptyTelemetry title="The armory could not be loaded.">Guildweaver telemetry is temporarily unavailable.</EmptyTelemetry> : null}
      {status === 'missing' ? <EmptyTelemetry title="Character not found.">This character may not have synced yet, or its telemetry was removed.</EmptyTelemetry> : null}
      {status === 'ready' ? <CharacterProfile armory={armory} tab={tab} onTabChange={chooseTab} /> : null}
    </PageShell>
  )
}
