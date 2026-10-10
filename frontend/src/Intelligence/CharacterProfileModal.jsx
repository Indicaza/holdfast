import { useCallback, useEffect, useMemo, useState } from 'react'

import { useLiveResource } from '../Live/useLiveResource.js'
import Modal from '../Modal/Modal.jsx'
import CharacterProfile, { CharacterHeader } from './CharacterProfile.jsx'
import { classIdentity } from './classIdentity.js'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import { normalizeArmory } from './model.js'
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

// The character modal. Its armory refreshes in place whenever this character's
// telemetry changes (live "character changed" events name the character), so
// the open tab and scroll position survive while new data streams in.
//
// Recipe books are most of a character's data, so they load separately the
// first time the professions tab opens, and refresh only when profession
// telemetry changes.
export default function CharacterProfileModal({ characterId, onClose }) {
  const [tab, setTab] = useState('equipment')
  const [recipesWanted, setRecipesWanted] = useState(false)
  const url = characterId ? `/api/intelligence/characters/${encodeURIComponent(characterId)}` : null
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
