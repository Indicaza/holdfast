import { SyncBadge, UnitFrame } from './CharacterIdentity.jsx'
import { classIdentity } from './classIdentity.js'
import './CharacterCard.css'

// A synced character as a unit frame. Clicking opens the character modal in
// place (onOpen); the href keeps it a real link (new tab, copy link) that
// reopens the modal on the current page.
export default function CharacterCard({ character, onOpen, showAffiliation = true, className = '' }) {
  function handleClick(event) {
    if (!onOpen || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen(character.id)
  }

  const vitals = character.vitals || {}
  return (
    <a
      className={`character-card${className ? ` ${className}` : ''}`}
      href={`${window.location.pathname}?character=${encodeURIComponent(character.id)}`}
      onClick={handleClick}
      style={{ '--armory-class-color': classIdentity(character.className).color }}
    >
      <UnitFrame
        character={character}
        health={{ max: vitals.healthMax }}
        power={{ max: vitals.powerMax, token: vitals.powerToken }}
        nameAs="strong"
        className="unit-frame--card"
        showAffiliation={showAffiliation}
      />
      <SyncBadge lastSeenAt={character.lastSeenAt} />
    </a>
  )
}
