import { useEffect, useMemo, useState } from 'react'

import AuditLog from '../Admin/AuditLog.jsx'
import GuildweaverConsole from '../Admin/GuildweaverConsole.jsx'
import '../Admin/Admin.css'
import { apiJson } from '../Api/apiClient.js'
import { useSession } from '../Auth/sessionContext.js'
import { useLiveResource } from '../Live/useLiveResource.js'
import Home from '../Home/Home.jsx'
import MemberAccessModal from '../Members/MemberAccessModal.jsx'
import WowIcon from '../WowAssets/WowIcon.jsx'
import { SyncBadge, UnitFrame } from './CharacterIdentity.jsx'
import CharacterProfileModal from './CharacterProfileModal.jsx'
import { classIdentity } from './classIdentity.js'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import IntelligenceAppShell from './IntelligenceAppShell.jsx'
import intelligenceViews from './intelligenceViews.js'
import { formatSyncAge, normalizeIntelligence } from './model.js'
import RosterComposition from './RosterComposition.jsx'
import './GuildIntelligence.css'

const EMPTY_INTELLIGENCE = normalizeIntelligence({})

const VIEW_ALIASES = Object.freeze({
  composition: 'roster',
  professions: 'roster',
  recipes: 'craft',
  admin: 'audit',
  sync: 'guildweaver',
})

function readViewFromLocation(views) {
  const raw = window.location.hash.replace(/^#/, '').trim().toLowerCase()
  const candidate = VIEW_ALIASES[raw] || raw
  return views.some((view) => view.id === candidate) ? candidate : 'overview'
}

function professionSkillLabel(crafter, professionName) {
  const current = Number(crafter?.professionSkill) || 0
  const maximum = Number(crafter?.professionMaxSkill) || 0
  const modifier = Number(crafter?.professionModifier) || 0
  if (!current && !maximum && !modifier) return ''
  return `${professionName || 'Profession'} ${current}${maximum ? `/${maximum}` : ''}${modifier ? ` +${modifier}` : ''}`
}

function freshSyncCount(characters, hours = 24) {
  const cutoff = Date.now() - (hours * 60 * 60 * 1000)
  return characters.filter((character) => {
    const timestamp = new Date(character.lastSeenAt || '').getTime()
    return Number.isFinite(timestamp) && timestamp >= cutoff
  }).length
}

function CharacterCard({ character, onOpen }) {
  function handleClick(event) {
    if (!onOpen || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen(character.id)
  }

  const vitals = character.vitals || {}
  return (
    <a
      className="character-card"
      href={`/intelligence?character=${encodeURIComponent(character.id)}`}
      onClick={handleClick}
      style={{ '--armory-class-color': classIdentity(character.className).color }}
    >
      <UnitFrame
        character={character}
        health={{ max: vitals.healthMax }}
        power={{ max: vitals.powerMax, token: vitals.powerToken }}
        nameAs="strong"
        className="unit-frame--card"
        showAffiliation
      />
      <SyncBadge lastSeenAt={character.lastSeenAt} />
    </a>
  )
}

function RecentCharacters({ characters, limit = 6, onOpenCharacter }) {
  const recent = characters.slice(0, limit)

  return (
    <section className="intel-panel intel-characters">
      <div className="intel-panel__heading intel-panel__heading--split">
        <div>
          <span>Armory</span>
          <h2>Recently synced</h2>
          <p>Jump back into the characters reporting most recently.</p>
        </div>
        <a href="/members">Member directory →</a>
      </div>
      {recent.length ? (
        <div className="intel-character-grid">
          {recent.map((character) => <CharacterCard character={character} key={character.id} onOpen={onOpenCharacter} />)}
        </div>
      ) : (
        <EmptyTelemetry title="No characters synced yet.">
          Install Guildweaver and the first character snapshot will appear here automatically.
        </EmptyTelemetry>
      )}
    </section>
  )
}

function Overview({ availableViews, data, freshCharacters, onOpenCharacter, onSelectView }) {
  const canAudit = availableViews.some((view) => view.id === 'audit')
  const canInspectGuildweaver = availableViews.some((view) => view.id === 'guildweaver')

  return (
    <>
      <section className="intel-scorecards" aria-label="GuildOS summary">
        <article><span>Synced characters</span><strong>{data.summary.characterCount}</strong><small>Armory-ready profiles</small></article>
        <article><span>Fresh in 24h</span><strong>{freshCharacters}</strong><small>Characters reporting recently</small></article>
        <article><span>Professions represented</span><strong>{data.summary.professionCount}</strong><small>Across synced characters</small></article>
        <article><span>Known recipes</span><strong>{data.summary.recipeCount}</strong><small>Searchable craft knowledge</small></article>
      </section>

      <div className="intelligence-overview-grid">
        <RecentCharacters characters={data.characters} onOpenCharacter={onOpenCharacter} />

        <section className="intelligence-overview-tools" aria-labelledby="intelligence-tools-title">
          <span>Workspaces</span>
          <h2 id="intelligence-tools-title">Go straight to the question.</h2>
          <p>GuildOS keeps each job focused instead of stacking every tool and dataset into one long page.</p>
          <button type="button" onClick={() => onSelectView('characters')}>
            <strong>Browse characters</strong>
            <small>Search every synced armory</small>
          </button>
          <button type="button" onClick={() => onSelectView('roster')}>
            <strong>Inspect roster composition</strong>
            <small>Class, spec, and profession coverage</small>
          </button>
          <button type="button" onClick={() => onSelectView('craft')}>
            <strong>Find a crafter</strong>
            <small>Search known recipes and items</small>
          </button>
          {canAudit ? (
            <button type="button" onClick={() => onSelectView('audit')}>
              <strong>Review audit history</strong>
              <small>Inspect administrative activity and safety records</small>
            </button>
          ) : null}
          {canInspectGuildweaver ? (
            <button type="button" onClick={() => onSelectView('guildweaver')}>
              <strong>Inspect Guildweaver sync</strong>
              <small>Trace snapshots, devices, lag, and raw payloads</small>
            </button>
          ) : null}
        </section>
      </div>
    </>
  )
}

function CharacterBrowser({ characters, onOpenCharacter }) {
  const [query, setQuery] = useState('')
  const normalized = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!normalized) return characters
    return characters.filter((character) => [
      character.name,
      character.className,
      character.spec,
      character.race,
      character.realm,
      character.guildName,
    ].some((value) => String(value || '').toLowerCase().includes(normalized)))
  }, [characters, normalized])

  return (
    <section className="intelligence-character-browser">
      <div className="intelligence-character-browser__heading">
        <div>
          <span>Armory browser</span>
          <h2>Synced characters</h2>
          <p>{characters.length} character{characters.length === 1 ? '' : 's'} available. Search names, classes, specs, races, and realms.</p>
        </div>
        <label className="intelligence-character-browser__search">
          <span>Search characters</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, class, spec, realm…"
          />
        </label>
      </div>

      {!characters.length ? (
        <EmptyTelemetry title="No characters synced yet.">
          Character armories appear after Guildweaver reports its first snapshot.
        </EmptyTelemetry>
      ) : filtered.length ? (
        <div className="intel-character-grid">
          {filtered.map((character) => <CharacterCard character={character} key={character.id} onOpen={onOpenCharacter} />)}
        </div>
      ) : (
        <EmptyTelemetry title="No characters match.">
          Try a different name, class, specialization, race, or realm.
        </EmptyTelemetry>
      )}
    </section>
  )
}

function CraftFinder() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('idle')
  const [results, setResults] = useState([])

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), 180)
    return () => window.clearTimeout(timer)
  }, [input])

  useEffect(() => {
    if (query.length < 2) {
      setResults([])
      setStatus('idle')
      return undefined
    }
    const controller = new AbortController()
    let active = true
    setStatus('loading')
    apiJson(`/api/intelligence/craft-finder?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((payload) => {
        if (!active) return
        setResults(Array.isArray(payload?.results) ? payload.results : [])
        setStatus('ready')
      })
      .catch((error) => {
        if (!active || error?.name === 'AbortError') return
        setStatus('error')
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [query])

  return (
    <section className="craft-finder">
      <div className="craft-finder__heading">
        <div>
          <span>Guild Craft Finder</span>
          <h2>Who can make it?</h2>
          <p>Search synced recipes or crafted items and jump straight to the characters who know them.</p>
        </div>
      </div>
      <div className="craft-finder__search-wrap">
        <label className="craft-finder__search">
          <span>Recipe or item</span>
          <input type="search" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Mithril Spurs, potion, item ID…" />
        </label>
        {status === 'loading' ? <p className="intel-muted">Searching known recipes…</p> : null}
        {status === 'error' ? <p className="intel-error">Craft Finder is unavailable right now.</p> : null}
        {status === 'idle' ? <p className="craft-finder__hint">Type at least two characters to search the guild recipe index.</p> : null}
      </div>
      {status === 'ready' && !results.length ? (
        <EmptyTelemetry title="No synced crafter found.">
          Try another recipe or item name. The index only contains telemetry we have actually received.
        </EmptyTelemetry>
      ) : null}
      {results.length ? (
        <div className="craft-results">
          {results.map((result) => (
            <article className="craft-result" key={result.recipe?.id || `${result.recipe?.professionName}-${result.recipe?.name}`}>
              <div className="craft-result__recipe">
                <WowIcon iconFileId={result.recipe?.iconFileId} recipeId={result.recipe?.id} label={result.recipe?.name} size={50} />
                <div>
                  <strong>{result.recipe?.name || 'Unknown recipe'}</strong>
                  <span>{result.recipe?.professionName || 'Profession unknown'}{result.recipe?.requiredSkill ? ` · ${result.recipe.requiredSkill} skill required` : ''}</span>
                </div>
              </div>
              <div className="craft-result__crafters">
                {result.crafters?.map((crafter) => {
                  const skill = professionSkillLabel(crafter, result.recipe?.professionName)
                  return (
                    <a key={crafter.id} href={`/intelligence?character=${encodeURIComponent(crafter.id)}`}>
                      <span>
                        <strong>{crafter.name}</strong>
                        <small>{skill || crafter.className || 'Character'}{crafter.realm ? ` · ${crafter.realm}` : ''}</small>
                      </span>
                      <em>{formatSyncAge(crafter.lastSeenAt)}</em>
                    </a>
                  )
                })}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function Workspace({ activeView, availableViews, data, freshCharacters, onOpenCharacter, onSelectView, session }) {
  if (activeView === 'roster') return <RosterComposition data={data} />
  if (activeView === 'characters') return <CharacterBrowser characters={data.characters} onOpenCharacter={onOpenCharacter} />
  if (activeView === 'craft') return <CraftFinder />
  if (activeView === 'audit' && session.hasPermission('audit.view')) return <AuditLog />
  if (activeView === 'guildweaver' && session.hasPermission('site.admin')) return <GuildweaverConsole />
  return <Overview availableViews={availableViews} data={data} freshCharacters={freshCharacters} onOpenCharacter={onOpenCharacter} onSelectView={onSelectView} />
}

// The open character lives in the URL (?character=), so a refresh, a shared
// link or Back/Forward reopens it, and nothing else on the page can close it.
function readCharacterFromLocation() {
  return new URLSearchParams(window.location.search).get('character') || ''
}

function writeCharacterToLocation(characterId) {
  const url = new URL(window.location.href)
  if (characterId) url.searchParams.set('character', characterId)
  else url.searchParams.delete('character')
  if (url.href !== window.location.href) window.history.pushState(null, '', url)
}

export default function GuildIntelligence() {
  const session = useSession()
  const { status: summaryStatus, data: summary } = useLiveResource('/api/intelligence', {
    topics: ['intelligence', 'members'],
    select: normalizeIntelligence,
    enabled: session.authenticated,
  })
  const data = summary || EMPTY_INTELLIGENCE
  const status = summaryStatus === 'idle' ? 'ready' : summaryStatus === 'missing' ? 'error' : summaryStatus
  const [activeView, setActiveView] = useState('overview')
  const [selectedCharacterId, setSelectedCharacterId] = useState(readCharacterFromLocation)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('holdfast:intelligence:rail') === 'collapsed'
    } catch {
      return false
    }
  })

  const canAudit = session.hasPermission('audit.view')
  const canInspectGuildweaver = session.hasPermission('site.admin')
  const availableViews = useMemo(() => intelligenceViews.filter((view) => {
    if (view.permission === 'audit.view') return canAudit
    if (view.permission === 'site.admin') return canInspectGuildweaver
    return true
  }), [canAudit, canInspectGuildweaver])

  useEffect(() => {
    const syncCharacter = () => setSelectedCharacterId(readCharacterFromLocation())
    window.addEventListener('popstate', syncCharacter)
    return () => window.removeEventListener('popstate', syncCharacter)
  }, [])

  function openCharacter(characterId) {
    setSelectedCharacterId(characterId)
    writeCharacterToLocation(characterId)
  }

  useEffect(() => {
    if (!session.authenticated) return undefined

    function syncView() {
      setActiveView(readViewFromLocation(availableViews))
    }

    syncView()
    window.addEventListener('hashchange', syncView)
    window.addEventListener('popstate', syncView)
    return () => {
      window.removeEventListener('hashchange', syncView)
      window.removeEventListener('popstate', syncView)
    }
  }, [availableViews, session.authenticated])

  useEffect(() => {
    try {
      window.localStorage.setItem('holdfast:intelligence:rail', collapsed ? 'collapsed' : 'expanded')
    } catch {
      // Local preference persistence is optional.
    }
  }, [collapsed])

  function selectView(view) {
    if (!availableViews.some((candidate) => candidate.id === view)) return
    setActiveView(view)
    if (window.location.hash !== `#${view}`) {
      window.history.pushState(null, '', `#${view}`)
    }
  }

  const closeGate = () => window.location.assign('/')
  const freshCharacters = useMemo(() => freshSyncCount(data.characters), [data.characters])

  if (session.status === 'loading' || session.status === 'error' || !session.authenticated) {
    return <Home overlay={<MemberAccessModal returnTo="/intelligence" onClose={closeGate} />} />
  }

  return (
    <>
      <IntelligenceAppShell
        activeView={activeView}
        collapsed={collapsed}
        freshCharacters={freshCharacters}
        mobileOpen={mobileOpen}
        onSelectView={selectView}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        onToggleMobile={setMobileOpen}
        views={availableViews}
      >
        {status === 'loading' ? <p className="intel-muted">Reading the latest telemetry…</p> : null}
        {status === 'error' ? <p className="intel-error">GuildOS could not be loaded.</p> : null}
        {status === 'ready' ? (
          <Workspace
            activeView={activeView}
            availableViews={availableViews}
            data={data}
            freshCharacters={freshCharacters}
            onOpenCharacter={openCharacter}
            onSelectView={selectView}
            session={session}
          />
        ) : null}
      </IntelligenceAppShell>
      <CharacterProfileModal characterId={selectedCharacterId} onClose={() => openCharacter('')} />
    </>
  )
}
