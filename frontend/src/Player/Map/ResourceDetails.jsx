import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { SkillRateLine } from '../../Intelligence/Farming/FarmingCharts.jsx'
import {
  EMPTY_FILTERS,
  disciplineLabel,
  formatCount,
  formatRate,
  observationLabel,
  sourceKindLabel,
} from '../../Intelligence/Farming/farmingModel.js'
import '../../Intelligence/Farming/FarmingIntelligence.css'
import WowIcon from '../../WowAssets/WowIcon.jsx'
import { rateScale } from '../exploreModel.js'
import { relativeTime } from '../playerModel.js'
import { Confidence, DisciplineTag, Icon, ItemLabel, RateBar } from '../ui.jsx'
import { useSourceDetail } from '../useSourceDetail.js'
import { formatCoords, sourceSpots, sourceZones, wayCommand } from './mapModel.js'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function useCopy() {
  const [copied, setCopied] = useState('')
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  function copy(text) {
    const done = () => {
      setCopied(text)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(''), 1600)
    }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => {})
  }
  return [copied, copy]
}

function CopyWay({ zone, x, y, copied, onCopy, compact = false }) {
  const command = wayCommand(zone, x, y)
  const done = copied === command
  return (
    <button
      type="button"
      className={`gw-rmap__copy${done ? ' is-done' : ''}${compact ? ' gw-rmap__copy--compact' : ''}`}
      onClick={() => onCopy(command)}
      title={`Copy “${command}” for TomTom`}
      aria-label={done ? 'Waypoint copied' : `Copy waypoint ${command}`}
    >
      <Icon name={done ? 'check' : 'copy'} size={13} />
      {compact ? null : <span>{done ? 'Copied' : 'Copy waypoint'}</span>}
    </button>
  )
}

function DropRows({ detail, selected, onSelect }) {
  const max = rateScale(detail.outputs)
  return (
    <table className="gw-rmap__drops" aria-label="Drop table">
      <thead>
        <tr>
          <th scope="col">Item</th>
          <th scope="col">Chance</th>
          <th scope="col" className="gw-rmap__num">Drops</th>
          <th scope="col"><span className="visually-hidden">Confidence</span></th>
        </tr>
      </thead>
      <tbody>
        {detail.outputs.map((output) => {
          const active = output.itemKey === selected
          return (
            <tr key={output.itemKey} className={active ? 'is-selected' : undefined} onClick={() => onSelect(output.itemKey)}>
              <td>
                <button type="button" className="gw-rmap__drop-name" aria-pressed={active} onClick={(event) => { event.stopPropagation(); onSelect(output.itemKey) }}>
                  <ItemLabel item={output} size={24} />
                </button>
              </td>
              <td><RateBar entry={output} max={max} compact /></td>
              <td className="gw-rmap__num">{formatCount(output.drops)}</td>
              <td><Confidence confidence={output.confidence} /></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// A resource's details, opened from the map and drawn over it: what it drops
// (here or everywhere), where it is found and its best spots. Everything it
// links to is a place on this map, so nobody has to leave the map.
export default function ResourceDetails({
  source, spot = null, initialItemKey = '', placed, color, shown, onClose, onFlyToZone, onFlyToSpot, onSolo, onToggle,
}) {
  const titleId = useId()
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })
  const [scope, setScope] = useState(spot ? 'here' : 'all')
  const [itemKey, setItemKey] = useState(initialItemKey)
  const zoneFilter = scope === 'here' && spot ? spot.zone.name : ''
  const filters = useMemo(() => ({ ...EMPTY_FILTERS, zone: zoneFilter }), [zoneFilter])
  const [{ status, detail }, retry] = useSourceDetail(source.sourceKey, filters, itemKey)
  const [copied, copy] = useCopy()

  const zones = useMemo(() => sourceZones(placed, source.sourceKey), [placed, source.sourceKey])
  const spots = useMemo(() => sourceSpots(placed, source.sourceKey, { limit: 5 }), [placed, source.sourceKey])
  const topZone = zones[0]?.observations || 1

  // A dialog: focus starts inside, Tab stays inside, Escape closes, and focus
  // goes back where it was.
  useEffect(() => {
    const panel = panelRef.current
    const previous = document.activeElement
    panel?.querySelector('.gw-rmap__modal-close')?.focus({ preventScroll: true })
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const focusable = [...panel.querySelectorAll(FOCUSABLE)]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    panel?.addEventListener('keydown', onKeyDown)
    return () => {
      panel?.removeEventListener('keydown', onKeyDown)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  // A drop every gather gives has nothing to chart: start on the most
  // common chance-based drop instead, unless the reader picked one.
  const autoPicked = useRef(Boolean(initialItemKey))
  useEffect(() => {
    if (autoPicked.current || !detail?.outputs.length) return
    autoPicked.current = true
    const current = detail.outputs.find((output) => output.itemKey === detail.selectedItemKey)
    if (current && current.rate < 0.995) return
    const chance = detail.outputs.filter((output) => output.rate < 0.995).sort((a, b) => b.drops - a.drops)[0]
    if (chance) setItemKey(chance.itemKey)
  }, [detail])

  const summary = detail?.summary
  const selected = detail?.outputs.find((output) => output.itemKey === (detail.selectedItemKey || itemKey)) || null
  const skillRows = detail?.bySkill || []
  const plotted = skillRows.filter((row) => row.bucket !== 'unknown' && row.observations > 0).length >= 2
  const noun = observationLabel(source.discipline, 2)
  // The header always speaks for every zone; the drop table can narrow.
  const totalObservations = source.observations || zones.reduce((sum, entry) => sum + entry.observations, 0) || summary?.observations || 0
  const zoneCount = zones.length || source.zones || 0
  const kind = detail?.source?.kind

  return (
    <div className="gw-rmap__modal-layer" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={panelRef} className="gw-rmap__modal" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ '--swatch': color }}>
        <header className="gw-rmap__modal-head">
          <span className="gw-rmap__modal-icon">
            <WowIcon iconFileId={source.icon?.iconFileDataId} itemId={source.icon?.itemId} label={source.name} quality={source.icon?.qualityId} size={52} />
          </span>
          <div className="gw-rmap__modal-title">
            <div className="gw-rmap__modal-tags">
              <DisciplineTag discipline={source.discipline} />
              {kind ? <span className="gw-tag">{sourceKindLabel(kind)}</span> : null}
            </div>
            <h2 id={titleId}>{source.name}</h2>
            <p>
              <strong>{formatCount(totalObservations)}</strong> {noun}
              {' · '}<strong>{formatCount(zoneCount)}</strong> zone{zoneCount === 1 ? '' : 's'}
              {summary?.lastObservedAt ? <> · last seen {relativeTime(summary.lastObservedAt)}</> : null}
            </p>
          </div>
          <button type="button" className="gw-rmap__modal-close" onClick={onClose} aria-label="Close details">
            <Icon name="close" size={16} />
          </button>
        </header>

        {spot ? (
          <div className="gw-rmap__modal-spot">
            <span className="gw-rmap__modal-spot-pin"><Icon name="pin" size={16} /></span>
            <div>
              <strong>{spot.zone.name} <code>{formatCoords(spot.x, spot.y)}</code></strong>
              <small>{formatCount(spot.observations)} {observationLabel(source.discipline, spot.observations)} at this spot</small>
            </div>
            <CopyWay zone={spot.zone} x={spot.x} y={spot.y} copied={copied} onCopy={copy} />
          </div>
        ) : null}

        <div className="gw-rmap__modal-body">
          <section className="gw-rmap__modal-section gw-rmap__modal-section--drops" aria-labelledby={`${titleId}-drops`}>
            <header>
              <h3 id={`${titleId}-drops`}>What it drops</h3>
              {spot ? (
                <div className="gw-rmap__seg" role="group" aria-label="Drop rates from">
                  <button type="button" aria-pressed={scope === 'here'} onClick={() => setScope('here')}>{spot.zone.name}</button>
                  <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All zones</button>
                </div>
              ) : null}
            </header>
            {status === 'loading' && !detail ? <div className="gw-rmap__modal-loading" role="status"><span className="gw-rmap__spinner" />Loading drop rates…</div> : null}
            {status === 'error' && !detail ? (
              <div className="gw-rmap__modal-loading" role="alert">
                Drop rates could not load.
                <button type="button" className="gw-btn gw-btn--sm" onClick={retry}>Try again</button>
              </div>
            ) : null}
            {status === 'missing' ? <p className="gw-rmap__modal-empty">No drops recorded for this resource yet.</p> : null}
            {detail ? (
              <div className={status === 'refreshing' ? 'is-refreshing' : undefined}>
                {detail.outputs.length ? (
                  <DropRows detail={detail} selected={selected?.itemKey} onSelect={setItemKey} />
                ) : <p className="gw-rmap__modal-empty">Nothing recorded{zoneFilter ? ` in ${zoneFilter}` : ''} yet.</p>}
                {selected && plotted ? (
                  <figure className="gw-rmap__modal-chart">
                    <figcaption>
                      <ItemLabel item={selected} size={18} tooltip={false} />
                      <span>by {disciplineLabel(source.discipline)} skill · {formatRate(selected.rate)} overall</span>
                    </figcaption>
                    <SkillRateLine rows={skillRows} itemName={selected.name} />
                  </figure>
                ) : null}
                {summary ? (
                  <p className="gw-rmap__modal-foot">
                    From {formatCount(summary.observations)} {noun}{zoneFilter ? ` in ${zoneFilter}` : ' in every zone'} by {formatCount(summary.characters)} players
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="gw-rmap__modal-section" aria-labelledby={`${titleId}-where`}>
            <header><h3 id={`${titleId}-where`}>Where to find it</h3></header>
            {zones.length ? (
              <ul className="gw-rmap__modal-zones">
                {zones.map((entry) => (
                  <li key={entry.zone.mapId}>
                    <button type="button" onClick={() => onFlyToZone(entry.zone)} title={`Show ${entry.zone.name} on the map`}>
                      <span className="gw-rmap__modal-zone-name">{entry.zone.name}</span>
                      <span className="gw-rmap__modal-bar" aria-hidden="true"><i style={{ width: `${Math.max(4, (entry.observations / topZone) * 100)}%` }} /></span>
                      <small>{formatCount(entry.observations)}</small>
                      <Icon name="target" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="gw-rmap__modal-empty">No positions recorded on the map yet.</p>}

            {spots.length ? (
              <>
                <h4>Best spots</h4>
                <ol className="gw-rmap__modal-spots">
                  {spots.map((entry, index) => (
                    <li key={`${entry.mapId}-${index}`}>
                      <button type="button" className="gw-rmap__modal-spot-go" onClick={() => onFlyToSpot(entry)} title="Show this spot on the map">
                        <span className="gw-rmap__spot-rank">{index + 1}</span>
                        <span className="gw-rmap__modal-zone-name">{entry.zone.name}</span>
                        <code>{formatCoords(entry.x, entry.y)}</code>
                        <small>{formatCount(entry.observations)}</small>
                      </button>
                      <CopyWay zone={entry.zone} x={entry.x} y={entry.y} copied={copied} onCopy={copy} compact />
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
          </section>
        </div>

        <footer className="gw-rmap__modal-actions">
          <button type="button" className="gw-btn gw-btn--sm gw-btn--primary" onClick={onSolo}>
            <Icon name="target" size={14} /> Show only {source.name}
          </button>
          <button type="button" className="gw-btn gw-btn--sm" onClick={onToggle} aria-pressed={!shown}>
            {shown ? 'Hide on map' : 'Show on map'}
          </button>
          <span className="gw-rmap__modal-note">Pooled from every Guildweaver player, without names.</span>
        </footer>
      </section>
    </div>
  )
}
