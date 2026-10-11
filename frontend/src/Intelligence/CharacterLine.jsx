import WowIcon from '../WowAssets/WowIcon.jsx'
import { classIdentity } from './classIdentity.js'
import './CharacterLine.css'

// A synced character as one quiet line: class portrait, name in class colour,
// level, race and class. Opens the armory like a character card does.
export default function CharacterLine({ character, onOpen, portrait = true, className = '' }) {
  const identity = classIdentity(character.className)
  function handleClick(event) {
    if (!onOpen || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen(character.id)
  }

  return (
    <a
      className={`character-line${className ? ` ${className}` : ''}`}
      href={`${window.location.pathname}?character=${encodeURIComponent(character.id)}`}
      onClick={handleClick}
      style={{ '--class-color': identity.color }}
    >
      {portrait ? (
        <span className="character-line__portrait">
          {identity.iconFileId ? <WowIcon iconFileId={identity.iconFileId} label={character.className} size={56} /> : null}
        </span>
      ) : (
        <span className="character-line__mark" aria-hidden="true" />
      )}
      <span className="character-line__text">
        <strong>{character.name}</strong>
        <small>
          {[character.level ? `Level ${character.level}` : '', character.race, character.spec || character.className].filter(Boolean).join(' ')}
        </small>
      </span>
      <span className="character-line__open" aria-hidden="true">›</span>
    </a>
  )
}
