import { useMemo, useState } from 'react'

import { classIdentity } from '../Intelligence/classIdentity.js'
import { useLiveResource } from '../Live/useLiveResource.js'
import { WowIcon } from '../WowAssets/WowIcon.jsx'
import { PLAYER_TOPICS, playerApiUrl, relativeTime } from './playerModel.js'
import { EmptyState, ErrorState, Icon, SkeletonRows, SortHeader, Tip } from './ui.jsx'

const COLUMNS = [
  { key: 'name', label: 'Character', defaultDirection: 'asc' },
  { key: 'level', label: 'Level', defaultDirection: 'desc', className: 'gw-col-num' },
  { key: 'class', label: 'Class', defaultDirection: 'asc', className: 'gw-hide-sm' },
  { key: 'server', label: 'Server', defaultDirection: 'asc', className: 'gw-hide-md' },
  { key: 'professions', label: 'Professions', defaultDirection: 'desc', className: 'gw-hide-md' },
  { key: 'synced', label: 'Last synced', defaultDirection: 'desc', className: 'gw-col-num' },
]

function characterName(character) {
  return [character.firstName, character.lastName].filter(Boolean).join(' ') || character.name || 'Unknown character'
}

function professionNames(character) {
  return (character.professions || []).map((entry) => (typeof entry === 'string' ? entry : entry?.name)).filter(Boolean)
}

function classLabel(character) {
  return [character.race, character.spec ? `${character.spec} ${character.className}` : character.className].filter(Boolean).join(' ')
}

const SORT_VALUE = {
  name: (character) => characterName(character).toLowerCase(),
  level: (character) => Number(character.level) || 0,
  class: (character) => `${character.className || ''} ${character.race || ''}`.toLowerCase(),
  server: (character) => `${character.realm || ''} ${characterName(character)}`.toLowerCase(),
  professions: (character) => professionNames(character).length,
  synced: (character) => Date.parse(character.lastSeenAt) || 0,
}

function sortCharacters(characters, { key, direction }) {
  const value = SORT_VALUE[key] || SORT_VALUE.level
  const sign = direction === 'asc' ? 1 : -1
  return [...characters].sort((left, right) => {
    const a = value(left)
    const b = value(right)
    if (a < b) return -sign
    if (a > b) return sign
    return characterName(left).localeCompare(characterName(right))
  })
}

// Fresh within a day, recent within a week, otherwise stale.
function freshness(lastSeenAt, now = Date.now()) {
  const time = Date.parse(lastSeenAt)
  if (!Number.isFinite(time)) return 'stale'
  const age = now - time
  if (age < 24 * 3_600_000) return 'fresh'
  if (age < 7 * 24 * 3_600_000) return 'recent'
  return 'stale'
}

function CharacterRow({ character, showServer, onOpen }) {
  const identity = classIdentity(character.className)
  const professions = professionNames(character)
  const params = new URLSearchParams(window.location.search)
  params.set('character', character.id)
  const href = `${window.location.pathname}?${params}`
  const name = characterName(character)

  function open(event) {
    if (!onOpen || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen(character.id)
  }

  return (
    <tr
      className="gw-char-row is-link"
      style={{ '--class-color': identity.color || 'var(--gw-accent)' }}
      onClick={(event) => {
        if (event.target.closest('a, button')) return
        onOpen?.(character.id)
      }}
    >
      <td>
        <a className="gw-char-row__name" href={href} onClick={open}>
          <span className="gw-char-row__icon">
            {identity.iconFileId ? <WowIcon iconFileId={identity.iconFileId} label={character.className} size={28} /> : <span aria-hidden="true">✦</span>}
          </span>
          <strong>{name}</strong>
          {character.isMain ? <Tip label="Main character"><span className="gw-char-row__main" aria-label="Main character" role="img">★</span></Tip> : null}
        </a>
      </td>
      <td className="gw-col-num">{character.level || '—'}</td>
      <td className="gw-hide-sm gw-char-row__class">{classLabel(character) || <span className="gw-muted">Not synced yet</span>}</td>
      {showServer ? <td className="gw-hide-md">{character.realm || <span className="gw-muted">—</span>}</td> : null}
      <td className="gw-hide-md">
        {professions.length ? professions.join(', ') : <span className="gw-muted">—</span>}
      </td>
      <td className="gw-col-num">
        <Tip label={character.lastSeenAt ? `Last synced ${new Date(character.lastSeenAt).toLocaleString()}` : 'Never synced'}>
          <span className={`gw-char__seen gw-char__seen--${freshness(character.lastSeenAt)}`}>
            <i aria-hidden="true" />
            {relativeTime(character.lastSeenAt)}
          </span>
        </Tip>
      </td>
    </tr>
  )
}

// The player's characters on the chosen server, as one sortable table. The
// server filters them; the search only narrows what is on screen.
export default function PlayerCharacters({ server, onOpenCharacter }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState({ key: 'level', direction: 'desc' })
  const { status, data } = useLiveResource(playerApiUrl('characters', server), { topics: PLAYER_TOPICS })
  const characters = useMemo(() => data?.characters || [], [data])
  const normalized = query.trim().toLowerCase()
  const shown = useMemo(() => {
    const matching = normalized
      ? characters.filter((character) => [characterName(character), character.className, character.spec, character.race, character.realm, character.guildName, ...professionNames(character)]
        .some((value) => String(value || '').toLowerCase().includes(normalized)))
      : characters
    return sortCharacters(matching, sort)
  }, [characters, normalized, sort])
  const columns = server ? COLUMNS.filter((column) => column.key !== 'server') : COLUMNS

  function onSort(column) {
    setSort((current) => (current.key === column.key
      ? { key: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key: column.key, direction: column.defaultDirection }))
  }

  return (
    <div className="gw-stack">
      <div className="gw-toolbar">
        <label className="gw-input gw-input--search">
          <Icon name="search" size={16} />
          <input type="search" aria-label="Filter your characters" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by name, class, realm or profession" />
        </label>
        {status === 'ready' ? (
          <p className="gw-toolbar__note">
            {normalized ? `${shown.length} of ${characters.length}` : characters.length} character{characters.length === 1 ? '' : 's'}{server ? ' on this server' : ''}
          </p>
        ) : null}
      </div>

      {status === 'loading' ? <SkeletonRows rows={6} label="Loading your characters" /> : null}
      {status === 'error' ? <ErrorState>Your characters could not be loaded.</ErrorState> : null}
      {status === 'ready' && !characters.length ? (
        <EmptyState title={server ? 'No characters on this server yet.' : 'No characters synced yet.'} icon="characters">
          A character appears after you <kbd>/reload</kbd> or log out with it while Guildweaver is running.
        </EmptyState>
      ) : null}
      {status === 'ready' && characters.length && !shown.length ? (
        <EmptyState title="No characters match." icon="search">Try a different name, class, realm or profession.</EmptyState>
      ) : null}
      {shown.length ? (
        <section className="gw-panel gw-panel--flush" aria-label="Your characters">
          <div className="gw-table-wrap">
            <table className="gw-table gw-table--chars">
              <thead>
                <tr>{columns.map((column) => <SortHeader key={column.key} column={column} sort={sort.key} direction={sort.direction} onSort={onSort} />)}</tr>
              </thead>
              <tbody>
                {shown.map((character) => <CharacterRow key={character.id} character={character} showServer={!server} onOpen={onOpenCharacter} />)}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
