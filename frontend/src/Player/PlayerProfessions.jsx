import { useEffect, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import EmptyTelemetry from '../Intelligence/EmptyTelemetry.jsx'
import { useLiveResource } from '../Live/useLiveResource.js'
import WowIcon from '../WowAssets/WowIcon.jsx'
import { PLAYER_TOPICS, playerApiUrl, relativeTime } from './playerModel.js'

function skillLabel(profession) {
  if (!profession.skill && !profession.maxSkill) return ''
  return `${profession.skill}${profession.maxSkill ? `/${profession.maxSkill}` : ''}${profession.modifier ? ` +${profession.modifier}` : ''}`
}

// "Which of my characters can make this?" over the player's own recipes on
// the chosen server.
function CraftSearch({ server, onOpenCharacter }) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [state, setState] = useState({ status: 'idle', results: [] })

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), 180)
    return () => window.clearTimeout(timer)
  }, [input])

  useEffect(() => {
    if (query.length < 2) {
      setState({ status: 'idle', results: [] })
      return undefined
    }
    const controller = new AbortController()
    setState((current) => ({ ...current, status: 'loading' }))
    apiJson(playerApiUrl('craft-finder', server, { q: query }), { signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) setState({ status: 'ready', results: Array.isArray(payload?.results) ? payload.results : [] })
      })
      .catch((error) => {
        if (!controller.signal.aborted && error?.name !== 'AbortError') setState({ status: 'error', results: [] })
      })
    return () => controller.abort()
  }, [query, server])

  return (
    <section className="craft-finder">
      <div className="craft-finder__heading">
        <div>
          <span>Crafting</span>
          <h2>Which of your characters can make it?</h2>
          <p>Search your characters&apos; known recipes by recipe or item name, or item ID.</p>
        </div>
      </div>
      <div className="craft-finder__search-wrap">
        <label className="craft-finder__search">
          <span>Recipe or item</span>
          <input type="search" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Mithril Spurs, potion, item ID…" />
        </label>
        {state.status === 'loading' ? <p className="intel-muted" role="status">Searching your recipes…</p> : null}
        {state.status === 'error' ? <p className="intel-error" role="alert">Recipe search is unavailable right now.</p> : null}
        {state.status === 'idle' ? <p className="craft-finder__hint">Type at least two characters.</p> : null}
      </div>
      {state.status === 'ready' && !state.results.length ? (
        <EmptyTelemetry title="None of your characters know that recipe.">
          Only recipes from your synced profession windows are searchable. Open the profession in game, then /reload to sync it.
        </EmptyTelemetry>
      ) : null}
      {state.results.length ? (
        <div className="craft-results">
          {state.results.map((result) => (
            <article className="craft-result" key={result.recipe?.id || `${result.recipe?.professionName}-${result.recipe?.name}`}>
              <div className="craft-result__recipe">
                <WowIcon iconFileId={result.recipe?.iconFileId} recipeId={result.recipe?.id} label={result.recipe?.name} size={50} />
                <div>
                  <strong>{result.recipe?.name || 'Unknown recipe'}</strong>
                  <span>{result.recipe?.professionName || 'Profession unknown'}{result.recipe?.requiredSkill ? ` · ${result.recipe.requiredSkill} skill required` : ''}</span>
                </div>
              </div>
              <div className="craft-result__crafters">
                {result.crafters?.map((crafter) => (
                  <a
                    key={crafter.id}
                    href={`${window.location.pathname}?character=${encodeURIComponent(crafter.id)}`}
                    onClick={(event) => {
                      event.preventDefault()
                      onOpenCharacter(crafter.id)
                    }}
                  >
                    <span>
                      <strong>{crafter.name}</strong>
                      <small>{crafter.professionSkill ? `${result.recipe?.professionName || 'Skill'} ${crafter.professionSkill}` : crafter.className || 'Character'}{crafter.realm ? ` · ${crafter.realm}` : ''}</small>
                    </span>
                    <em>{relativeTime(crafter.lastSeenAt)}</em>
                  </a>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}

export default function PlayerProfessions({ server, onOpenCharacter }) {
  const { status, data } = useLiveResource(playerApiUrl('professions', server), { topics: PLAYER_TOPICS })
  const characters = (data?.characters || []).filter((character) => character.professions.length)

  return (
    <>
      <section className="intel-panel player-professions" aria-labelledby="player-professions-title">
        <div className="intel-panel__heading">
          <span>Professions</span>
          <h2 id="player-professions-title">Your professions</h2>
          <p>Skill levels and known recipes from each character&apos;s latest snapshot.</p>
        </div>
        {status === 'loading' ? <p className="intel-muted" role="status">Loading your professions…</p> : null}
        {status === 'error' ? <p className="intel-error" role="alert">Your professions could not be loaded.</p> : null}
        {status === 'ready' && !characters.length ? (
          <EmptyTelemetry title="No professions synced yet.">Open a profession window in game, then /reload so Guildweaver can send it.</EmptyTelemetry>
        ) : null}
        {characters.length ? (
          <ul className="player-professions__list">
            {characters.map((character) => (
              <li key={character.id}>
                <button type="button" className="player-professions__character" onClick={() => onOpenCharacter(character.id)}>
                  <strong>{character.name}</strong>
                  <span>Level {character.level || '?'} {character.className}{character.realm ? ` · ${character.realm}` : ''}</span>
                </button>
                <ul>
                  {character.professions.map((profession) => (
                    <li key={profession.key}>
                      <span>{profession.name}</span>
                      <strong>{skillLabel(profession)}</strong>
                      <small>{profession.recipeCount ? `${profession.recipeCount} recipes` : 'No recipes synced'}</small>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <CraftSearch server={server} onOpenCharacter={onOpenCharacter} />
    </>
  )
}
