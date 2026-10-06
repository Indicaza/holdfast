import { useEffect, useMemo, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import { useSession } from '../Auth/sessionContext.js'
import Home from '../Home/Home.jsx'
import MemberAccessModal from '../Members/MemberAccessModal.jsx'
import PageShell from '../PageShell/PageShell.jsx'
import WowIcon from '../WowAssets/WowIcon.jsx'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import { formatSyncAge, normalizeIntelligence } from './model.js'
import './GuildIntelligence.css'

function Distribution({ title, entries }) {
  const max = Math.max(1, ...entries.map((entry) => Number(entry.count || entry.characters) || 0))
  const total = entries.reduce((sum, entry) => sum + (Number(entry.count || entry.characters) || 0), 0)

  return (
    <section className="intel-panel intel-distribution-card">
      <div className="intel-panel__heading intel-panel__heading--compact">
        <div>
          <span>Distribution</span>
          <h2>{title}</h2>
        </div>
        {entries.length ? <small>{total} represented</small> : null}
      </div>
      {entries.length ? (
        <div className="intel-bars">
          {entries.slice(0, 10).map((entry) => {
            const count = Number(entry.count || entry.characters) || 0
            return (
              <div className="intel-bar" key={entry.name}>
                <div><span>{entry.name}</span><strong>{count}</strong></div>
                <div className="intel-bar__track"><span style={{ width: `${(count / max) * 100}%` }} /></div>
              </div>
            )
          })}
        </div>
      ) : <p className="intel-muted">No telemetry yet.</p>}
    </section>
  )
}

function professionSkillLabel(crafter, professionName) {
  const current = Number(crafter?.professionSkill) || 0
  const maximum = Number(crafter?.professionMaxSkill) || 0
  const modifier = Number(crafter?.professionModifier) || 0
  if (!current && !maximum && !modifier) return ''
  return `${professionName || 'Profession'} ${current}${maximum ? `/${maximum}` : ''}${modifier ? ` +${modifier}` : ''}`
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
    <section className="craft-finder" id="recipes">
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
      {status === 'ready' && !results.length ? <EmptyTelemetry title="No synced crafter found.">Try another recipe or item name. The index only contains telemetry we have actually received.</EmptyTelemetry> : null}
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
                    <a key={crafter.id} href={`/armory/${encodeURIComponent(crafter.id)}`}>
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

export default function GuildIntelligence() {
  const session = useSession()
  const [status, setStatus] = useState('loading')
  const [data, setData] = useState(() => normalizeIntelligence({}))

  useEffect(() => {
    if (!session.authenticated) {
      setStatus('ready')
      return undefined
    }
    const controller = new AbortController()
    let active = true
    setStatus('loading')
    apiJson('/api/intelligence', { signal: controller.signal })
      .then((payload) => {
        if (!active) return
        setData(normalizeIntelligence(payload))
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
  }, [session.authenticated])

  const closeGate = () => window.location.assign('/')
  const recentCharacters = useMemo(() => data.characters.slice(0, 8), [data.characters])

  if (session.status === 'loading' || session.status === 'error' || !session.authenticated) {
    return <Home overlay={<MemberAccessModal returnTo="/intelligence" onClose={closeGate} />} />
  }

  return (
    <PageShell
      eyebrow="Guild Intelligence"
      title="The living armory."
      intro="Characters, builds, professions, and recipes reported by Guildweaver—organized for the people actually playing together."
      className="intelligence-page"
    >
      {status === 'loading' ? <p className="intel-muted">Reading the latest telemetry…</p> : null}
      {status === 'error' ? <p className="intel-error">Guild intelligence could not be loaded.</p> : null}
      {status === 'ready' ? (
        <>
          <nav className="intel-paths" aria-label="Guild intelligence sections">
            <a href="#characters"><strong>Characters</strong><span>Open synced armories</span></a>
            <a href="#professions"><strong>Professions</strong><span>See guild coverage</span></a>
            <a href="#recipes"><strong>Craft Finder</strong><span>Find who can make it</span></a>
          </nav>

          <section className="intel-scorecards" aria-label="Guild intelligence summary">
            <article><span>Synced characters</span><strong>{data.summary.characterCount}</strong><small>Armory-ready profiles</small></article>
            <article><span>Professions represented</span><strong>{data.summary.professionCount}</strong><small>Across synced characters</small></article>
            <article><span>Known recipes</span><strong>{data.summary.recipeCount}</strong><small>Searchable craft knowledge</small></article>
          </section>

          <section className="intel-panel intel-characters" id="characters">
            <div className="intel-panel__heading intel-panel__heading--split">
              <div><span>Armory</span><h2>Recently synced characters</h2><p>Open a character to inspect equipment, talents, professions, and known recipes.</p></div>
              <a href="/members">Member directory →</a>
            </div>
            {recentCharacters.length ? (
              <div className="intel-character-grid">
                {recentCharacters.map((character) => (
                  <a className="intel-character-card" href={`/armory/${encodeURIComponent(character.id)}`} key={character.id}>
                    <div className="intel-character-card__crest" aria-hidden="true">♜</div>
                    <div className="intel-character-card__identity">
                      <strong>{character.name}</strong>
                      <span>{character.level ? `Level ${character.level} · ` : ''}{character.spec || character.className || 'Class unknown'}</span>
                      <small>{character.realm || character.guildName || 'Realm not reported'}</small>
                    </div>
                    <div className="intel-character-card__meta">
                      <em>{formatSyncAge(character.lastSeenAt)}</em>
                      <span aria-hidden="true">→</span>
                    </div>
                  </a>
                ))}
              </div>
            ) : <EmptyTelemetry title="No characters synced yet.">Install Guildweaver and the first character snapshot will appear here automatically.</EmptyTelemetry>}
          </section>

          <section className="intel-section" id="professions">
            <div className="intel-section__heading">
              <span>Guild coverage</span>
              <h2>What the roster can field.</h2>
              <p>Current class, specialization, and profession coverage from synced characters.</p>
            </div>
            <div className="intel-distributions">
              <Distribution title="Classes" entries={data.classDistribution} />
              <Distribution title="Specs" entries={data.specDistribution} />
              <Distribution title="Professions" entries={data.professions} />
            </div>
          </section>

          <CraftFinder />

          <section className="intel-future">
            <span>Built to grow</span>
            <h2>More intelligence can land here without turning this into an admin console.</h2>
            <p>The same telemetry surface can expand into market, gathering, drop-rate, and item intelligence as those collectors come online.</p>
            <div><span>Auction House</span><span>Rare drops</span><span>Gathering telemetry</span><span>Craft profitability</span><span>Item intelligence</span></div>
          </section>
        </>
      ) : null}
    </PageShell>
  )
}
