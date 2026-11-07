import { useMemo, useState } from 'react'

import EmptyTelemetry from '../Intelligence/EmptyTelemetry.jsx'
import { useLiveResource } from '../Live/useLiveResource.js'
import { PLAYER_TOPICS, charactersByServer, playerApiUrl } from './playerModel.js'
import PlayerCharacterCard from './PlayerCharacterCard.jsx'

// The player's characters on the chosen server, grouped under each server
// when showing all of them. The server filters them; the search only
// narrows what is on screen.
export default function PlayerCharacters({ server, servers, onOpenCharacter }) {
  const [query, setQuery] = useState('')
  const { status, data } = useLiveResource(playerApiUrl('characters', server), { topics: PLAYER_TOPICS })
  const characters = useMemo(() => data?.characters || [], [data])
  const normalized = query.trim().toLowerCase()
  const shown = useMemo(() => (normalized
    ? characters.filter((character) => [character.name, character.className, character.spec, character.race, character.realm, character.guildName]
      .some((value) => String(value || '').toLowerCase().includes(normalized)))
    : characters), [characters, normalized])
  const groups = charactersByServer(shown, data?.servers || servers)

  return (
    <section className="intelligence-character-browser">
      <div className="intelligence-character-browser__heading">
        <div>
          <span>Armory</span>
          <h2>Your characters</h2>
          <p>{characters.length} character{characters.length === 1 ? '' : 's'}{server ? ' on this server' : ''}. Open one for equipment, stats, talents, professions and bags.</p>
        </div>
        <label className="intelligence-character-browser__search">
          <span>Search your characters</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, class, spec, realm…" />
        </label>
      </div>

      {status === 'loading' ? <p className="intel-muted" role="status">Loading your characters…</p> : null}
      {status === 'error' ? <p className="intel-error" role="alert">Your characters could not be loaded.</p> : null}
      {status === 'ready' && !characters.length ? (
        <EmptyTelemetry title={server ? 'No characters on this server yet.' : 'No characters synced yet.'}>
          A character appears after you /reload or log out with it while Guildweaver is running.
        </EmptyTelemetry>
      ) : null}
      {status === 'ready' && characters.length && !shown.length ? (
        <EmptyTelemetry title="No characters match.">Try a different name, class, specialization, race, or realm.</EmptyTelemetry>
      ) : null}
      {groups.map((group) => (
        <section key={group.server.key} className="player-server-group" aria-label={group.server.label}>
          {server ? null : <h3 className="player-server-group__title">{group.server.label} <small>{group.characters.length}</small></h3>}
          <div className="player-character-grid">
            {group.characters.map((character) => <PlayerCharacterCard character={character} key={character.id} onOpen={onOpenCharacter} showServer={false} />)}
          </div>
        </section>
      ))}
    </section>
  )
}
