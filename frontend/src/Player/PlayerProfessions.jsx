import { useEffect, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import { classIdentity } from '../Intelligence/classIdentity.js'
import { useLiveResource } from '../Live/useLiveResource.js'
import WowIcon from '../WowAssets/WowIcon.jsx'
import { PLAYER_TOPICS, playerApiUrl, relativeTime } from './playerModel.js'
import { EmptyState, ErrorState, Icon, Panel, SkeletonRows } from './ui.jsx'

function SkillMeter({ profession }) {
  const skill = Number(profession.skill) || 0
  const max = Number(profession.maxSkill) || 0
  const share = max ? Math.min(1, skill / max) : 0
  return (
    <span className={`gw-skill${max && skill >= max ? ' is-capped' : ''}`}>
      <span className="gw-skill__value">
        <strong>{skill}</strong>{max ? <small>/{max}</small> : null}{profession.modifier ? <em>+{profession.modifier}</em> : null}
      </span>
      <span className="gw-skill__track" aria-hidden="true"><i style={{ width: `${share * 100}%` }} /></span>
    </span>
  )
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
    <Panel
      id="gw-craft"
      title="Which of your characters can make it?"
      description="Search your characters' known recipes by recipe or item name, or item ID."
    >
      <label className="gw-input gw-input--search gw-input--lg">
        <Icon name="search" size={18} />
        <input type="search" aria-label="Recipe or item" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Mithril Spurs, potion, item ID…" />
      </label>
      {state.status === 'loading' ? <p className="gw-muted" role="status">Searching your recipes…</p> : null}
      {state.status === 'error' ? <ErrorState>Recipe search is unavailable right now.</ErrorState> : null}
      {state.status === 'idle' ? <p className="gw-hint">Type at least two characters.</p> : null}
      {state.status === 'ready' && !state.results.length ? (
        <EmptyState title="None of your characters know that recipe." icon="craft">
          Only recipes from your synced profession windows are searchable. Open the profession in game, then <kbd>/reload</kbd> to sync it.
        </EmptyState>
      ) : null}
      {state.results.length ? (
        <ul className="gw-craft-results">
          {state.results.map((result) => (
            <li className="gw-craft-result" key={result.recipe?.id || `${result.recipe?.professionName}-${result.recipe?.name}`}>
              <div className="gw-craft-result__recipe">
                <WowIcon iconFileId={result.recipe?.iconFileId} recipeId={result.recipe?.id} label={result.recipe?.name} size={40} />
                <div>
                  <strong>{result.recipe?.name || 'Unknown recipe'}</strong>
                  <span>{result.recipe?.professionName || 'Profession unknown'}{result.recipe?.requiredSkill ? ` · ${result.recipe.requiredSkill} skill required` : ''}</span>
                </div>
              </div>
              <div className="gw-craft-result__crafters">
                {result.crafters?.map((crafter) => (
                  <a
                    key={crafter.id}
                    href={`${window.location.pathname}?character=${encodeURIComponent(crafter.id)}`}
                    onClick={(event) => {
                      event.preventDefault()
                      onOpenCharacter(crafter.id)
                    }}
                  >
                    <strong>{crafter.name}</strong>
                    <small>{crafter.professionSkill ? `${result.recipe?.professionName || 'Skill'} ${crafter.professionSkill}` : crafter.className || 'Character'}{crafter.realm ? ` · ${crafter.realm}` : ''}</small>
                    <em>{relativeTime(crafter.lastSeenAt)}</em>
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  )
}

export default function PlayerProfessions({ server, onOpenCharacter }) {
  const { status, data } = useLiveResource(playerApiUrl('professions', server), { topics: PLAYER_TOPICS })
  const characters = (data?.characters || []).filter((character) => character.professions.length)

  return (
    <div className="gw-stack">
      <CraftSearch server={server} onOpenCharacter={onOpenCharacter} />

      <Panel id="player-professions" title="Your professions" description="Skill levels and known recipes from each character's latest snapshot.">
        {status === 'loading' ? <SkeletonRows rows={4} label="Loading your professions" /> : null}
        {status === 'error' ? <ErrorState>Your professions could not be loaded.</ErrorState> : null}
        {status === 'ready' && !characters.length ? (
          <EmptyState title="No professions synced yet." icon="craft">Open a profession window in game, then <kbd>/reload</kbd> so Guildweaver can send it.</EmptyState>
        ) : null}
        {characters.length ? (
          <div className="gw-prof-grid">
            {characters.map((character) => (
              <article key={character.id} className="gw-prof-card" style={{ '--class-color': classIdentity(character.className).color || 'var(--gw-accent)' }}>
                <button type="button" className="gw-prof-card__head" onClick={() => onOpenCharacter(character.id)}>
                  <strong>{character.name}</strong>
                  <span>Level {character.level || '?'} {character.className}{character.realm ? ` · ${character.realm}` : ''}</span>
                  <Icon name="chevron" size={14} />
                </button>
                <ul>
                  {character.professions.map((profession) => (
                    <li key={profession.key}>
                      <WowIcon iconFileId={profession.iconFileId} label={profession.name} size={28} />
                      <span className="gw-prof-card__name">
                        <strong>{profession.name}</strong>
                        <small>{profession.recipeCount ? `${profession.recipeCount} recipes` : 'No recipes synced'}</small>
                      </span>
                      {profession.skill || profession.maxSkill ? <SkillMeter profession={profession} /> : null}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : null}
      </Panel>
    </div>
  )
}
