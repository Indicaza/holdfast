import { useEffect, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import { useSession } from '../Auth/sessionContext.js'
import Home from '../Home/Home.jsx'
import MemberAccessModal from '../Members/MemberAccessModal.jsx'
import PageShell from '../PageShell/PageShell.jsx'
import EquipmentPaperDoll from './EquipmentPaperDoll.jsx'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import ProfessionCards from './ProfessionCards.jsx'
import RecipeBrowser from './RecipeBrowser.jsx'
import TalentTree from './TalentTree.jsx'
import { formatSyncAge, normalizeArmory } from './model.js'
import './CharacterArmory.css'

const tabs = [
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
      eyebrow="Character Intelligence"
      title={title}
      intro={status === 'ready' ? `${character.race || 'Unknown race'} · ${character.className || 'Unknown class'}${character.spec ? ` · ${character.spec}` : ''}` : 'Opening the latest Guildweaver snapshot.'}
      className="armory-page"
    >
      {status === 'loading' ? <p className="armory-state">Opening the armory…</p> : null}
      {status === 'error' ? <EmptyTelemetry title="The armory could not be loaded.">Guildweaver telemetry is temporarily unavailable.</EmptyTelemetry> : null}
      {status === 'missing' ? <EmptyTelemetry title="Character not found.">This character may not have synced yet, or its telemetry was removed.</EmptyTelemetry> : null}
      {status === 'ready' ? (
        <>
          <header className="armory-hero" data-class={classKey(character.className)}>
            <div className="armory-hero__portrait" aria-hidden="true"><span>♜</span></div>
            <div className="armory-hero__identity">
              <p>{character.isMain ? 'Main character' : 'Synced character'}</p>
              <h2>{character.name}</h2>
              <div><span>Level {character.level || '?'}</span><span>{character.race || 'Race unknown'}</span><span>{character.spec || character.className || 'Class unknown'}</span></div>
            </div>
            <div className="armory-hero__guild">
              <strong>{character.guildName || character.organization?.name || 'No guild reported'}</strong>
              <span>{character.memberRank ? `${character.memberRank} · ` : ''}{character.memberName || 'Holdfast member'}</span>
              <small>{formatSyncAge(character.lastSeenAt)}</small>
            </div>
          </header>

          <nav className="armory-tabs" aria-label="Character armory sections">
            {tabs.map(([value, label]) => (
              <button key={value} type="button" className={tab === value ? 'armory-tabs__active' : ''} aria-pressed={tab === value} onClick={() => chooseTab(value)}>{label}</button>
            ))}
          </nav>

          <section className="armory-content">
            {tab === 'overview' ? <Overview armory={armory} /> : null}
            {tab === 'equipment' ? <EquipmentPaperDoll equipment={armory.equipment} className={character.className} race={character.race} /> : null}
            {tab === 'talents' ? <TalentTree talents={armory.talents} /> : null}
            {tab === 'professions' ? <ProfessionCards professions={armory.professions} /> : null}
            {tab === 'recipes' ? <RecipeBrowser recipes={armory.recipes} /> : null}
          </section>
        </>
      ) : null}
    </PageShell>
  )
}
