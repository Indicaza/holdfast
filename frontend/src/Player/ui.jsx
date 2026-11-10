// The player app's small building blocks: icons, item labels, rate bars,
// panels and states. Styles live in PlayerApp.css under .gw.

import { GameTooltipHover } from '../Intelligence/GameTooltip.jsx'
import { gameTooltipItem, itemTooltipPending } from '../Intelligence/gameTooltipModel.js'
import { CONFIDENCE_LEVELS, confidenceLabel, disciplineLabel, formatRate, rateRangeText } from '../Intelligence/Farming/farmingModel.js'
import WowIcon from '../WowAssets/WowIcon.jsx'
import Tip from './Tooltip.jsx'

export { Tip }

const ICON_PATHS = {
  overview: <><path d="M4 11.5 12 5l8 6.5" /><path d="M6 10v9h12v-9" /><path d="M10 19v-5h4v5" /></>,
  farming: <><path d="M5 19h14" /><path d="M8 19V11" /><path d="M12 19V6" /><path d="M16 19v-4" /></>,
  characters: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.6-4 3.2-6 7-6s6.4 2 7 6" /></>,
  craft: <><path d="m14 6 4 4" /><path d="M15.5 4.5 19.5 8.5 17 11l-4-4 2.5-2.5Z" /><path d="m13 7-8.5 8.5a1.4 1.4 0 0 0 0 2l2 2a1.4 1.4 0 0 0 2 0L17 11" /></>,
  gathering: <><path d="M12 20v-7" /><path d="M12 13c0-4 2.6-7 7-7 0 4.2-2.8 7-7 7Z" /><path d="M12 15c0-3.3-2.2-5.5-6-5.5 0 3.4 2.4 5.5 6 5.5Z" /></>,
  guildweaver: <><path d="M20 12a8 8 0 0 1-13.7 5.7" /><path d="M4 12a8 8 0 0 1 13.7-5.7" /><path d="M18 3v4h-4" /><path d="M6 21v-4h4" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  pin: <><path d="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z" /><circle cx="12" cy="10" r="2" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  back: <><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></>,
  close: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
  sort: <><path d="m8 9 4-4 4 4" /><path d="m8 15 4 4 4-4" /></>,
  arrowUp: <><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></>,
  arrowDown: <><path d="M12 5v14" /><path d="m6 13 6 6 6-6" /></>,
  menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
  collapse: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M9 4.5v15" /></>,
  herbalism: <><path d="M12 21v-9" /><path d="M12 12c-4 0-7-3-7-7 4 0 7 3 7 7Z" /><path d="M12 15c3.5 0 6-2.5 6-6-3.5 0-6 2.5-6 6Z" /></>,
  mining: <><path d="M4 20 14 10" /><path d="M10 4c4 0 8 2 10 6-3-1.5-6-2-9-1" /><path d="M10 4c-1 2-1.2 4-1 5" /></>,
  fishing: <><path d="M6 4v9a5 5 0 0 0 10 0v-1" /><path d="m13 15 3-3 3 3" /><circle cx="6" cy="3.5" r="1" /></>,
  skinning: <><path d="M5 19c4-1 6-4 7-8 1 4 3 7 7 8" /><path d="M12 11V4" /><path d="M8 7h8" /></>,
  loot: <><rect x="4" y="9" width="16" height="10" rx="1.5" /><path d="M4 13h16" /><path d="M7 9V7a5 5 0 0 1 10 0v2" /><path d="M11 13v2h2v-2" /></>,
  sparkle: <path d="M12 3c.6 4.5 1.5 5.4 6 6-4.5.6-5.4 1.5-6 6-.6-4.5-1.5-5.4-6-6 4.5-.6 5.4-1.5 6-6Z" />,
  bolt: <path d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z" />,
  external: <><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v5H5V6h5" /></>,
  auction: <><path d="M14 4.5 19.5 10" /><path d="m12 6.5 5.5 5.5" /><path d="m11 9-6.5 6.5a1.5 1.5 0 0 0 2 2L13 11" /><path d="M4 20.5h9" /></>,
  dungeon: <><path d="M4 20V10l8-6 8 6v10" /><path d="M9 20v-5a3 3 0 0 1 6 0v5" /><path d="M4 20h16" /></>,
  map: <><path d="m3 6.5 6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5Z" /><path d="M9 4v13.5" /><path d="M15 6.5V20" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  minus: <path d="M5 12h14" />,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17" /><path d="M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5Z" /></>,
  fullscreen: <><path d="M4 9V4h5" /><path d="M20 9V4h-5" /><path d="M4 15v5h5" /><path d="M20 15v5h-5" /></>,
  exitFullscreen: <><path d="M9 4v5H4" /><path d="M15 4v5h5" /><path d="M9 20v-5H4" /><path d="M15 20v-5h5" /></>,
  layers: <><path d="m12 4 8.5 4.5L12 13 3.5 8.5Z" /><path d="m3.5 12.5 8.5 4.5 8.5-4.5" /><path d="m3.5 16.5 8.5 4.5 8.5-4.5" /></>,
  expand: <><path d="m9 6 6 6-6 6" /><path d="M4 5v14" /></>,
  shrink: <><path d="m15 6-6 6 6 6" /><path d="M20 5v14" /></>,
  target: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2.5v3" /><path d="M12 18.5v3" /><path d="M2.5 12h3" /><path d="M18.5 12h3" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16Z" /><path d="m13.5 6.5 4 4" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" /><path d="M12 7.6v.4" /></>,
}

export function Icon({ name, size = 18, className = '' }) {
  return (
    <svg className={`gw-icon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {ICON_PATHS[name] || ICON_PATHS.sparkle}
    </svg>
  )
}

export function DisciplineTag({ discipline, compact = false }) {
  return (
    <span className={`gw-disc gw-disc--${discipline || 'loot'}${compact ? ' gw-disc--compact' : ''}`}>
      <Icon name={ICON_PATHS[discipline] ? discipline : 'loot'} size={13} />
      {compact ? null : <span>{disciplineLabel(discipline)}</span>}
    </span>
  )
}

// An item as the game shows it: icon, name in its quality colour, tooltip.
export function ItemLabel({ item, size = 22, tooltip = true, muted = false }) {
  if (!item) return null
  const quality = Number.isFinite(Number(item.qualityId)) ? Number(item.qualityId) : 1
  const body = (
    <span className="gw-item">
      <WowIcon iconFileId={item.iconFileDataId} itemId={item.itemId} label={item.name} quality={item.qualityId} size={size} />
      <span className={`gw-item__name gw-q${quality}${muted ? ' gw-item__name--muted' : ''}`}>{item.name || 'Unknown item'}</span>
    </span>
  )
  const detail = gameTooltipItem(item.item || item)
  return tooltip && detail && !itemTooltipPending(detail) ? <GameTooltipHover item={item.item || item}>{body}</GameTooltipHover> : body
}

const CONFIDENCE_HELP = {
  very_high: 'Very high confidence: thousands of samples, the rate will hardly move',
  high: 'High confidence: enough samples to trust the rate',
  medium: 'Medium confidence: the rate may still shift a little',
  low: 'Low sample: too few attempts to trust this rate yet',
}

// Four rising bars, lit to the confidence of a rate. Only a low sample says
// so in words, because that is the reading that changes the conclusion.
export function Confidence({ confidence, showLabel = false }) {
  const level = Math.max(0, CONFIDENCE_LEVELS.indexOf(confidence)) + 1
  const label = `${confidenceLabel(confidence)} confidence`
  const low = !confidence || confidence === 'low'
  return (
    <Tip label={CONFIDENCE_HELP[confidence] || CONFIDENCE_HELP.low}>
      <span className={`gw-conf gw-conf--${confidence || 'low'}`} role="img" aria-label={label}>
        <span className="gw-conf__bars" aria-hidden="true">
          {CONFIDENCE_LEVELS.map((name, index) => <i key={name} className={index < level ? 'is-lit' : undefined} />)}
        </span>
        {showLabel || low ? <span className="gw-conf__label" aria-hidden="true">{low ? 'Low sample' : confidenceLabel(confidence)}</span> : null}
      </span>
    </Tip>
  )
}

// A drop chance with its likely range drawn behind it. `max` is the scale
// shared by every bar in the same table, so bars compare at a glance. The
// bar runs on a square-root scale so a 2% drop stays visible beside a 50%
// one; the printed number is exact.
export function RateBar({ entry, max = 1, compact = false }) {
  const scale = Math.max(Number(max) || 0, 0.0001)
  const pct = (value) => `${(Math.sqrt(Math.min(1, Math.max(0, (Number(value) || 0) / scale))) * 100).toFixed(2)}%`
  const hasRange = Number.isFinite(Number(entry.low)) && Number.isFinite(Number(entry.high))
  return (
    <Tip label={rateRangeText(entry)}>
      <span className={`gw-rate gw-rate--${entry.confidence || 'low'}${compact ? ' gw-rate--compact' : ''}`}>
        <span className="gw-rate__value">{formatRate(entry.rate)}</span>
        <span className="gw-rate__track" aria-hidden="true">
          {hasRange ? <span className="gw-rate__range" style={{ left: pct(entry.low), width: `calc(${pct(entry.high)} - ${pct(entry.low)})` }} /> : null}
          <span className="gw-rate__fill" style={{ width: pct(entry.rate) }} />
        </span>
      </span>
    </Tip>
  )
}

export function Panel({ title, description, actions, children, className = '', id, flush = false, as: Tag = 'section', ...rest }) {
  const headingId = id ? `${id}-title` : undefined
  return (
    <Tag className={`gw-panel${flush ? ' gw-panel--flush' : ''}${className ? ` ${className}` : ''}`} aria-labelledby={title ? headingId : undefined} id={id} {...rest}>
      {title ? (
        <header className="gw-panel__head">
          <div>
            <h2 id={headingId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="gw-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </Tag>
  )
}

// A column header that sorts its table: click again to reverse.
export function SortHeader({ column, sort, direction, onSort }) {
  const active = sort === column.key
  return (
    <th scope="col" className={column.className} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`gw-th-sort${active ? ' is-active' : ''}`} onClick={() => onSort(column)}>
        {column.label}
        <Icon name={active ? (direction === 'asc' ? 'arrowUp' : 'arrowDown') : 'sort'} size={12} />
      </button>
    </th>
  )
}

export function Stat({ label, value, foot, tone, icon }) {
  return (
    <article className={`gw-stat${tone ? ` gw-stat--${tone}` : ''}`}>
      <span className="gw-stat__label">{icon ? <Icon name={icon} size={14} /> : null}{label}</span>
      <strong className="gw-stat__value">{value}</strong>
      {foot ? <small className="gw-stat__foot">{foot}</small> : null}
    </article>
  )
}

export function EmptyState({ title, children, icon = 'sparkle', action = null }) {
  return (
    <div className="gw-empty">
      <span className="gw-empty__icon"><Icon name={icon} size={20} /></span>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  )
}

export function SkeletonRows({ rows = 6, label = 'Loading' }) {
  return (
    <div className="gw-skeleton" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => <span key={index} className="gw-skeleton__row" style={{ '--i': index }} />)}
    </div>
  )
}

export function ErrorState({ children, onRetry }) {
  return (
    <div className="gw-callout gw-callout--warning" role="alert">
      <strong>{children}</strong>
      {onRetry ? <button type="button" className="gw-btn gw-btn--sm" onClick={onRetry}>Try again</button> : null}
    </div>
  )
}

export function Zone({ name, extra = 0 }) {
  const label = String(name || '').trim()
  return (
    <Tip label={extra ? `Mostly ${label || 'in an unknown zone'}, and in ${extra} more zone${extra === 1 ? '' : 's'}` : null}>
      <span className={`gw-zone${label ? '' : ' gw-zone--unknown'}`}>
        <Icon name="pin" size={13} />
        <span>{label || 'Zone unknown'}</span>
        {extra ? <em>+{extra}</em> : null}
      </span>
    </Tip>
  )
}
