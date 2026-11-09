import { useCallback, useEffect, useMemo, useState } from 'react'

import { useLiveResource } from '../Live/useLiveResource.js'
import Modal from '../Modal/Modal.jsx'
import CharacterProfile, { CharacterHeader } from './CharacterProfile.jsx'
import { classIdentity } from './classIdentity.js'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import { formatSyncAge, normalizeArmory } from './model.js'
import WowIcon from '../WowAssets/WowIcon.jsx'
import './CharacterProfileModal.css'

const EMPTY_ARMORY = normalizeArmory({})
const RECIPE_SECTIONS = new Set(['profession_books', 'professions'])

function mergeGameData(base = {}, extra = {}) {
  const merged = { ...base }
  for (const [bucket, entries] of Object.entries(extra || {})) {
    const current = merged[bucket]
    merged[bucket] = current && typeof current === 'object' && !Array.isArray(current) && entries && typeof entries === 'object' && !Array.isArray(entries)
      ? { ...entries, ...current }
      : current ?? entries
  }
  return merged
}

// The player dashboard's header: the same facts in the app's own type and
// colours, without the game frame's decorative health and power bars.
function AppCharacterHeader({ character, loading }) {
  if (loading) return <header className="armory-app-head" aria-hidden="true"><span className="armory-app-head__icon" /></header>
  const identity = classIdentity(character.className)
  const kind = [character.race, character.spec ? `${character.spec} ${character.className}` : character.className].filter(Boolean).join(' ')
  const facts = [character.level ? `Level ${character.level}` : '', kind, character.realm].filter(Boolean)
  const synced = character.lastSeenAt ? new Date(character.lastSeenAt) : null
  return (
    <header className="armory-app-head">
      <span className="armory-app-head__icon">
        {identity.iconFileId ? <WowIcon iconFileId={identity.iconFileId} label={character.className} size={44} /> : <span aria-hidden="true">✦</span>}
      </span>
      <div className="armory-app-head__text">
        <h2>
          {character.name}
          {character.isMain ? <span className="armory-app-head__main" role="img" aria-label="Main character">★</span> : null}
        </h2>
        <p>{facts.join(' · ')}</p>
      </div>
      <p className="armory-app-head__sync" title={synced && !Number.isNaN(synced.getTime()) ? synced.toLocaleString() : undefined}>
        {formatSyncAge(character.lastSeenAt)}
      </p>
    </header>
  )
}

// The character modal. Its armory refreshes in place whenever this character's
// telemetry changes (live "character changed" events name the character), so
// the open tab and scroll position survive while new data streams in.
//
// Recipe books are most of a character's data, so they load separately the
// first time the professions tab opens, and refresh only when profession
// telemetry changes.
// apiBase: the guild workspace reads /api/intelligence/characters; the player
// dashboard reads the player's own characters from /api/player/characters.
// appearance: 'game' (the guild workspace's WoW-style frame) or 'app' (the
// player dashboard's own look).
export default function CharacterProfileModal({ characterId, onClose, apiBase = '/api/intelligence/characters', appearance = 'game' }) {
  const [tab, setTab] = useState('equipment')
  const [recipesWanted, setRecipesWanted] = useState(false)
  const url = characterId ? `${apiBase}/${encodeURIComponent(characterId)}` : null
  const matches = useCallback((event) => event.entityId === characterId, [characterId])
  const matchesRecipes = useCallback(
    (event) => event.entityId === characterId && (event.detail?.sections || []).some((section) => RECIPE_SECTIONS.has(section)),
    [characterId],
  )
  const { status, data } = useLiveResource(url, { topics: ['armory'], matches })
  const recipeBook = useLiveResource(url && `${url}/recipes`, { topics: ['armory'], matches: matchesRecipes, enabled: recipesWanted })

  useEffect(() => {
    setTab('equipment')
    setRecipesWanted(false)
  }, [characterId])

  useEffect(() => {
    if (tab === 'professions' || tab === 'recipes') setRecipesWanted(true)
  }, [tab])

  const armory = useMemo(() => {
    if (!data) return EMPTY_ARMORY
    const recipes = recipeBook.data
    return {
      ...normalizeArmory(recipes ? { ...data, recipes: recipes.recipes, gameData: mergeGameData(data.gameData, recipes.gameData) } : data),
      recipesStatus: recipes ? 'ready' : recipeBook.status === 'idle' ? 'loading' : recipeBook.status,
    }
  }, [data, recipeBook.data, recipeBook.status])

  if (!characterId) return null

  const ready = status === 'ready'
  const character = armory.character
  const title = ready ? character.name : 'Character profile'

  return (
    <Modal title={title} ariaLabel={title} hideHeader size="armory" align="left" onClose={onClose}>
      <div className={`armory-shell${appearance === 'app' ? ' armory-shell--app' : ''}`} style={ready ? { '--armory-class-color': classIdentity(character.className).color } : undefined}>
        {appearance === 'app'
          ? <AppCharacterHeader character={character} loading={!ready} />
          : <CharacterHeader character={character} stats={armory.stats} loading={!ready} />}
        {ready ? <CharacterProfile armory={armory} tab={tab} onTabChange={setTab} /> : (
          <div className="armory-shell__state">
            {status === 'loading' ? <p className="armory-state">Opening the latest character snapshot…</p> : null}
            {status === 'error' ? <EmptyTelemetry title="The profile could not be loaded.">Try again in a moment.</EmptyTelemetry> : null}
            {status === 'missing' ? <EmptyTelemetry title="Character not found.">This character may not have synced yet, or it was removed.</EmptyTelemetry> : null}
          </div>
        )}
      </div>
    </Modal>
  )
}
