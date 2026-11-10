import { classIdentity } from '../Intelligence/classIdentity.js'
import { WowIcon } from '../WowAssets/WowIcon.jsx'
import { relativeTime } from './playerModel.js'
import Tip from './Tooltip.jsx'

function characterName(character) {
  return [character.firstName, character.lastName].filter(Boolean).join(' ') || character.name || 'Unknown character'
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

// One of the player's characters: class icon, level, race and class, server,
// professions and how fresh the snapshot is. Clicking opens the armory in
// place; the href keeps it a real link (new tab, copy link).
export default function PlayerCharacterCard({ character, onOpen, showServer = true, compact = false }) {
  const identity = classIdentity(character.className)
  const professions = (character.professions || []).map((entry) => (typeof entry === 'string' ? entry : entry?.name)).filter(Boolean)
  const kind = [character.race, character.spec ? `${character.spec} ${character.className}` : character.className].filter(Boolean).join(' ')
  const state = freshness(character.lastSeenAt)

  function handleClick(event) {
    if (!onOpen || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen(character.id)
  }

  return (
    <a
      className={`gw-char${compact ? ' gw-char--compact' : ''}`}
      href={`${window.location.pathname}?character=${encodeURIComponent(character.id)}`}
      onClick={handleClick}
      style={{ '--class-color': identity.color || 'var(--gw-accent)' }}
    >
      <span className="gw-char__portrait">
        {identity.iconFileId ? <WowIcon iconFileId={identity.iconFileId} label={character.className} size={compact ? 36 : 48} /> : <span className="gw-char__glyph" aria-hidden="true">✦</span>}
        {character.level ? <b className="gw-char__level" aria-label={`Level ${character.level}`}>{character.level}</b> : null}
      </span>
      <span className="gw-char__body">
        <strong className="gw-char__name">{characterName(character)}</strong>
        <span className="gw-char__kind">{kind || 'Class not synced yet'}</span>
        {!compact && (showServer || professions.length) ? (
          <span className="gw-char__meta">
            {showServer && character.realm ? <span>{character.realm}</span> : null}
            {professions.slice(0, 2).map((name) => <span key={name} className="gw-char__prof">{name}</span>)}
          </span>
        ) : null}
      </span>
      <Tip label={character.lastSeenAt ? `Last synced ${new Date(character.lastSeenAt).toLocaleString()}` : 'Never synced'}>
        <span className={`gw-char__seen gw-char__seen--${state}`}>
          <i aria-hidden="true" />
          {relativeTime(character.lastSeenAt)}
        </span>
      </Tip>
    </a>
  )
}
