import { useMemo, useState } from 'react'

import { useLiveResource } from '../Live/useLiveResource.js'
import { PLAYER_TOPICS, charactersByServer, playerApiUrl } from './playerModel.js'
import PlayerCharacterCard from './PlayerCharacterCard.jsx'
import { EmptyState, ErrorState, Icon, SkeletonRows } from './ui.jsx'

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
    <div className="gw-stack">
      <div className="gw-toolbar">
        <label className="gw-input gw-input--search">
          <Icon name="search" size={16} />
          <input type="search" aria-label="Search your characters" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, class, spec, realm…" />
        </label>
        <p className="gw-toolbar__note">
          <strong>{characters.length}</strong> character{characters.length === 1 ? '' : 's'}{server ? ' on this server' : ''} · open one for gear, stats, talents and bags
        </p>
      </div>

      {status === 'loading' ? <SkeletonRows rows={6} label="Loading your characters" /> : null}
      {status === 'error' ? <ErrorState>Your characters could not be loaded.</ErrorState> : null}
      {status === 'ready' && !characters.length ? (
        <EmptyState title={server ? 'No characters on this server yet.' : 'No characters synced yet.'} icon="characters">
          A character appears after you <kbd>/reload</kbd> or log out with it while Guildweaver is running.
        </EmptyState>
      ) : null}
      {status === 'ready' && characters.length && !shown.length ? (
        <EmptyState title="No characters match." icon="search">Try a different name, class, specialization, race, or realm.</EmptyState>
      ) : null}
      {groups.map((group) => (
        <section key={group.server.key} className="gw-char-group" aria-label={group.server.label}>
          {server ? null : <h2 className="gw-group-title">{group.server.label} <small>{group.characters.length}</small></h2>}
          <div className="gw-char-grid">
            {group.characters.map((character) => <PlayerCharacterCard character={character} key={character.id} onOpen={onOpenCharacter} showServer={false} />)}
          </div>
        </section>
      ))}
    </div>
  )
}
