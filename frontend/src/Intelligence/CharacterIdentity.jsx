import { useState } from 'react'

import WowIcon, { FloatingTooltip } from '../WowAssets/WowIcon.jsx'
import { classIdentity } from './classIdentity.js'
import { formatSyncAge } from './model.js'
import './CharacterIdentity.css'

const POWER_KINDS = { MANA: 'mana', RAGE: 'rage', ENERGY: 'energy', FOCUS: 'focus' }

// Characters sync when their player logs in or out, so freshness follows play
// habits: played today, played this week, or gone quiet.
const DAY = 24 * 60 * 60 * 1000
const FRESHNESS = {
  fresh: { bars: 3, label: 'Up to date', detail: 'Synced within the last day.' },
  recent: { bars: 2, label: 'May be out of date', detail: 'Last synced within the past week.' },
  stale: { bars: 1, label: 'Out of date', detail: 'Not synced in over a week. Gear and talents may have changed.' },
}

function syncFreshness(value) {
  const time = new Date(value || 0).getTime()
  if (!time) return 'stale'
  const age = Date.now() - time
  if (age < DAY) return 'fresh'
  if (age < 7 * DAY) return 'recent'
  return 'stale'
}

function ResourceBar({ kind, current, max }) {
  const total = Number(max) || Number(current) || 0
  const value = Number.isFinite(Number(current)) ? Number(current) : total
  const percent = total ? Math.round((Math.max(0, Math.min(value, total)) / total) * 100) : 0
  return (
    <div className={`unit-frame__bar unit-frame__bar--${kind}`} role="img" aria-label={total ? `${kind} ${value.toLocaleString()} of ${total.toLocaleString()}` : `${kind} unknown`}>
      <span className="unit-frame__fill" style={{ width: `${percent}%` }} />
      {total ? (
        <span className="unit-frame__bar-text" aria-hidden="true">
          <span>{percent}%</span>
          <span>{total.toLocaleString()}</span>
        </span>
      ) : null}
    </div>
  )
}

function displayName(character) {
  const full = [character?.firstName, character?.lastName].filter(Boolean).join(' ')
  return full || character?.fullName || character?.name || ''
}

// The in-game player frame, layer by layer: a round portrait in a thin gold
// ring; a separate level bubble at its bottom left; and a frame body tucked
// behind the portrait holding a tinted name strip over a bronze-edged bar
// group (tall health bar, thin power bar). Bar numbers appear on hover, as the
// game's status text does.
export function UnitFrame({ character, health = {}, power = {}, nameAs: Name = 'h2', className = '', showAffiliation = false }) {
  const identity = classIdentity(character?.className)
  const powerKind = POWER_KINDS[String(power?.token || '').toUpperCase()] || 'mana'
  const guild = character?.guildName || character?.organization?.name || character?.organizationName
  const affiliation = [guild, character?.memberRank].filter(Boolean).join(': ')
  return (
    <div className={`unit-frame${className ? ` ${className}` : ''}`}>
      <span className="unit-frame__portrait">
        {identity.iconFileId ? <WowIcon iconFileId={identity.iconFileId} label={character?.className} size={64} /> : <span aria-hidden="true">♜</span>}
      </span>
      {character?.level ? <b className="unit-frame__level" aria-label={`Level ${character.level}`}>{character.level}</b> : null}
      {character?.isMain ? <span className="unit-frame__main" title="Main character" role="img" aria-label="Main character">★</span> : null}
      <div className="unit-frame__body">
        <div className="unit-frame__nameplate">
          <Name className="unit-frame__name">{displayName(character)}</Name>
        </div>
        <div className="unit-frame__bars">
          <ResourceBar kind="health" current={health?.current} max={health?.max} />
          <ResourceBar kind={powerKind} current={power?.current} max={power?.max} />
        </div>
        {showAffiliation && affiliation ? <span className="unit-frame__affiliation">{affiliation}</span> : null}
      </div>
    </div>
  )
}

export function CharacterFacts({ character, classAs: ClassName = 'h3' }) {
  const guild = character?.guildName || character?.organization?.name || character?.organizationName
  return (
    <div className="character-facts">
      <ClassName className="character-facts__class">{[character?.race, character?.spec || character?.className].filter(Boolean).join(' ') || 'Unknown class'}</ClassName>
      <dl className="character-facts__list">
        {guild ? <div><dt>Guild</dt><dd>{guild}</dd></div> : null}
        {character?.memberRank ? <div><dt>Rank</dt><dd>{character.memberRank}</dd></div> : null}
      </dl>
    </div>
  )
}

// The in-game latency meter: three bars, green/yellow/red, beside the sync age.
// Hovering shows the exact time and what the color means.
export function SyncBadge({ lastSeenAt, showLabel = false, focusable = false }) {
  const [anchor, setAnchor] = useState(null)
  const freshness = syncFreshness(lastSeenAt)
  const meaning = FRESHNESS[freshness]
  const age = formatSyncAge(lastSeenAt).replace(/^Synced /, '')
  const date = new Date(lastSeenAt || 0)
  const exact = lastSeenAt && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : null
  const show = (event) => setAnchor(event.currentTarget.getBoundingClientRect())
  const hide = () => setAnchor(null)

  return (
    <div
      className={`sync-badge sync-badge--${freshness}`}
      tabIndex={focusable ? 0 : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={focusable ? show : undefined}
      onBlur={focusable ? hide : undefined}
      aria-label={`Last synced ${age}. ${meaning.label}.`}
    >
      {showLabel ? <span className="sync-badge__label">Last sync</span> : null}
      <span className="sync-badge__value">
        <span className="sync-badge__meter" aria-hidden="true">
          {[1, 2, 3].map((bar) => <i key={bar} className={bar <= meaning.bars ? 'is-lit' : undefined} />)}
        </span>
        {age}
      </span>
      {anchor ? (
        <FloatingTooltip anchor={anchor} side="left" className="sync-tooltip">
          <strong className="sync-tooltip__title">{meaning.label}</strong>
          {exact ? <span className="sync-tooltip__time">Last synced {exact}</span> : null}
          <span className="sync-tooltip__detail">{meaning.detail}</span>
          <span className="sync-tooltip__hint">Guildweaver syncs when this character logs in or out.</span>
        </FloatingTooltip>
      ) : null}
    </div>
  )
}
