import { SyncBadge } from '../Intelligence/CharacterIdentity.jsx'
import { classIdentity } from '../Intelligence/classIdentity.js'
import '../Intelligence/CharacterCard.css'
import { WowIcon } from '../WowAssets/WowIcon.jsx'

function characterName(character) {
  return [character.firstName, character.lastName].filter(Boolean).join(' ') || character.name || 'Unknown character'
}

// One of the player's characters: class portrait, level, race and class, its
// server and how fresh the snapshot is. Clicking opens the armory in place;
// the href keeps it a real link (new tab, copy link).
export default function PlayerCharacterCard({ character, onOpen, showServer = true }) {
  const identity = classIdentity(character.className)
  const professions = (character.professions || []).map((entry) => (typeof entry === 'string' ? entry : entry?.name)).filter(Boolean)
  const kind = [character.race, character.spec ? `${character.spec} ${character.className}` : character.className].filter(Boolean).join(' ')
  const meta = [
    showServer ? character.realm : '',
    professions.length ? professions.slice(0, 2).join(' · ') : '',
  ].filter(Boolean)

  function handleClick(event) {
    if (!onOpen || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen(character.id)
  }

  return (
    <a
      className="character-card player-card"
      href={`${window.location.pathname}?character=${encodeURIComponent(character.id)}`}
      onClick={handleClick}
      style={{ '--armory-class-color': identity.color }}
    >
      <span className="player-card__portrait">
        {identity.iconFileId ? <WowIcon iconFileId={identity.iconFileId} label={character.className} size={56} /> : <span className="player-card__glyph" aria-hidden="true">✦</span>}
        {character.level ? <b className="player-card__level" aria-label={`Level ${character.level}`}>{character.level}</b> : null}
      </span>
      <span className="player-card__body">
        <strong className="player-card__name">{characterName(character)}</strong>
        <span className="player-card__kind">{kind || 'Class not synced yet'}</span>
        {meta.length ? <span className="player-card__meta">{meta.join(' · ')}</span> : null}
      </span>
      <SyncBadge lastSeenAt={character.lastSeenAt} />
    </a>
  )
}
