import { useState } from 'react'

import WowIcon, { FloatingTooltip } from '../WowAssets/WowIcon.jsx'
import { classIdentity } from './classIdentity.js'
import { formatSyncAge } from './model.js'
import './CharacterIdentity.css'
import './CharacterCardPolish.css'

const POWER_KINDS = { MANA: 'mana', RAGE: 'rage', ENERGY: 'energy', FOCUS: 'focus' }

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

// Bars are always drawn full: cards show what a character has (health and
// their power type), not their state at capture time. Exact maximums appear on
// hover when telemetry reported them.
function ResourceBar({ kind, max }) {
  const total = Number(max) > 0 ? Number(max) : null
  return (
    <div className={`unit-frame__bar unit-frame__bar--${kind}`} role="img" aria-label={total ? `${kind} ${total.toLocaleString()}` : kind}>
      <span className="unit-frame__fill" style={{ width: '100%' }} />
      {total ? (
        <span className="unit-frame__bar-text" aria-hidden="true">
          <span />
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

export function UnitFrame({ character, health = {}, power = {}, nameAs: Name = 'h2', className = '', showAffiliation = false }) {
  const identity = classIdentity(character?.className)
  const vitals = character?.vitals || {}
  const healthState = { max: health?.max ?? vitals.healthMax }
  const powerState = {
    max: power?.max ?? vitals.powerMax,
    token: power?.token ?? vitals.powerToken,
  }
  const powerKind = POWER_KINDS[String(powerState.token || '').toUpperCase()]
    || POWER_KINDS[identity.power]
    || 'mana'
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
          <ResourceBar kind="health" max={healthState.max} />
          <ResourceBar kind={powerKind} max={powerState.max} />
        </div>
        {showAffiliation && affiliation ? <span className="unit-frame__affiliation">{affiliation}</span> : null}
      </div>
    </div>
  )
}

// Race and class beside the unit frame; guild and rank live on the frame.
export function CharacterFacts({ character, classAs: ClassName = 'h3' }) {
  return (
    <div className="character-facts">
      <ClassName className="character-facts__class">{[character?.race, character?.spec || character?.className].filter(Boolean).join(' ') || 'Unknown class'}</ClassName>
    </div>
  )
}

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
