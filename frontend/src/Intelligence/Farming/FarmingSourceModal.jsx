import { useEffect, useState } from 'react'

import { apiJson } from '../../Api/apiClient.js'
import Modal from '../../Modal/Modal.jsx'
import WowIcon from '../../WowAssets/WowIcon.jsx'
import EmptyTelemetry from '../EmptyTelemetry.jsx'
import { OutputDonut, SkillRateLine } from './FarmingCharts.jsx'
import {
  EMPTY_FILTERS,
  activeFilterCount,
  confidenceLabel,
  disciplineLabel,
  formatCount,
  formatQuantity,
  formatRate,
  rankLabel,
  rateRangeText,
  sourceDetailUrl,
  sourceKindLabel,
} from './farmingModel.js'

export function ConfidenceTag({ confidence }) {
  return <span className={`farm-confidence farm-confidence--${confidence || 'low'}`}>{confidenceLabel(confidence)}</span>
}

// A rate always travels with its sample: the number, how many observations
// it rests on, and how far to trust it.
function Rate({ entry }) {
  return (
    <span className={`farm-rate farm-rate--${entry.confidence}`} title={rateRangeText(entry)}>
      {formatRate(entry.rate)}
    </span>
  )
}

function SourceFilters({ facets, filters, onChange }) {
  const set = (key) => (event) => onChange({ ...filters, [key]: event.target.value })
  const active = activeFilterCount(filters)

  return (
    <div className="farm-filters" role="group" aria-label="Filter observations">
      <label>
        <span>Zone</span>
        <select value={filters.zone} onChange={set('zone')}>
          <option value="">All zones</option>
          {facets.zones.map((zone) => <option key={zone.value} value={zone.value}>{zone.value} ({formatCount(zone.observations)})</option>)}
        </select>
      </label>
      <label className="farm-filters__range">
        <span>Skill</span>
        <input inputMode="numeric" aria-label="Minimum skill" placeholder={facets.skill.min ?? 'min'} value={filters.skillMin} onChange={set('skillMin')} />
        <input inputMode="numeric" aria-label="Maximum skill" placeholder={facets.skill.max ?? 'max'} value={filters.skillMax} onChange={set('skillMax')} />
      </label>
      <label className="farm-filters__range">
        <span>Level</span>
        <input inputMode="numeric" aria-label="Minimum character level" placeholder={facets.level.min ?? 'min'} value={filters.levelMin} onChange={set('levelMin')} />
        <input inputMode="numeric" aria-label="Maximum character level" placeholder={facets.level.max ?? 'max'} value={filters.levelMax} onChange={set('levelMax')} />
      </label>
      <label>
        <span>Bountiful Harvest</span>
        <select value={filters.rank} onChange={set('rank')}>
          <option value="">Any rank</option>
          {facets.ranks.map((rank) => <option key={rank.value} value={rank.value}>{rankLabel(rank.value)} ({formatCount(rank.observations)})</option>)}
        </select>
      </label>
      <label>
        <span>Build</span>
        <select value={filters.build} onChange={set('build')}>
          <option value="">All builds</option>
          {facets.builds.map((build) => <option key={build.value} value={build.value}>{build.value} ({formatCount(build.observations)})</option>)}
        </select>
      </label>
      {active ? <button type="button" className="farm-filters__reset" onClick={() => onChange({ ...EMPTY_FILTERS })}>Reset {active}</button> : null}
    </div>
  )
}

function SourceHeader({ detail, filtered }) {
  const { source, summary } = detail
  const icon = detail.outputs[0]
  const builds = summary.builds.map((build) => build.build)

  return (
    <header className="farm-modal__header">
      <WowIcon iconFileId={icon?.iconFileDataId} itemId={icon?.itemId} label={source.name} quality={icon?.qualityId} size={56} />
      <div>
        <span className="farm-modal__eyebrow">{disciplineLabel(source.discipline)}{source.kind ? ` · ${sourceKindLabel(source.kind)}` : ''}</span>
        <h2>{source.name}</h2>
        <dl className="farm-modal__facts">
          <div><dt>Gathers</dt><dd>{formatCount(summary.observations)}{filtered ? <small> of {formatCount(source.totalObservations)}</small> : null}</dd></div>
          <div><dt>Contributing characters</dt><dd>{formatCount(summary.characters)}</dd></div>
          <div><dt>Zones</dt><dd>{formatCount(summary.zones)}</dd></div>
          {builds.length ? <div><dt>{builds.length === 1 ? 'Build' : 'Builds'}</dt><dd>{builds.join(', ')}</dd></div> : null}
        </dl>
      </div>
    </header>
  )
}

function DropTable({ outputs, selectedItemKey, onSelect }) {
  return (
    <table className="farm-table farm-drops">
      <thead>
        <tr>
          <th scope="col">Item</th>
          <th scope="col" className="num">Drops</th>
          <th scope="col" className="num">Chance</th>
          <th scope="col" className="num">Avg qty</th>
          <th scope="col">Confidence</th>
        </tr>
      </thead>
      <tbody>
        {outputs.map((output) => (
          <tr key={output.itemKey} className={output.itemKey === selectedItemKey ? 'is-selected' : undefined}>
            <th scope="row">
              <button type="button" onClick={() => onSelect(output.itemKey)} aria-pressed={output.itemKey === selectedItemKey}>
                <WowIcon iconFileId={output.iconFileDataId} itemId={output.itemId} label={output.name} quality={output.qualityId} size={24} />
                <span className={`farm-item farm-item--q${output.qualityId ?? 1}`}>{output.name}</span>
              </button>
            </th>
            <td className="num">{formatCount(output.drops)}</td>
            <td className="num"><Rate entry={output} /></td>
            <td className="num">{formatQuantity(output.avgQuantity)}</td>
            <td><ConfidenceTag confidence={output.confidence} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SkillBreakdown({ rows, itemName, discipline }) {
  if (!rows.length) return null
  return (
    <section className="farm-section">
      <h3>{itemName} by {disciplineLabel(discipline)} skill</h3>
      <SkillRateLine rows={rows} itemName={itemName} />
      <div className="farm-scroll">
      <table className="farm-table farm-table--compact">
        <thead><tr><th scope="col">Skill</th><th scope="col" className="num">Chance</th><th scope="col" className="num">Gathers</th><th scope="col">Confidence</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.bucket}>
              <th scope="row">{row.bucket === 'unknown' ? 'Unknown' : row.bucket}</th>
              <td className="num"><Rate entry={row} /></td>
              <td className="num">{formatCount(row.observations)}</td>
              <td><ConfidenceTag confidence={row.confidence} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  )
}

function BountifulHarvest({ rows, itemName }) {
  if (!rows.length || rows.every((row) => row.rank === 'unknown')) return null
  const tentative = rows.some((row) => row.confidence === 'low' || row.confidence === 'medium')
  return (
    <section className="farm-section">
      <h3>Bountiful Harvest</h3>
      <div className="farm-scroll">
      <table className="farm-table farm-table--compact">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col" className="num">{itemName}</th>
            <th scope="col" className="num">Per gather</th>
            <th scope="col" className="num">Gathers</th>
            <th scope="col">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rank}>
              <th scope="row">{rankLabel(row.rank)}</th>
              <td className="num"><Rate entry={row} /></td>
              <td className="num">{formatQuantity(row.avgQuantityPerObservation)}</td>
              <td className="num">{formatCount(row.observations)}</td>
              <td><ConfidenceTag confidence={row.confidence} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="farm-note">
        Observed outcomes by rank, not proven effects.{tentative ? ' Some ranks have too few gathers to compare yet.' : ''} Skill and zone also differ between ranks; filter them to compare like with like.
      </p>
    </section>
  )
}

// One source: what comes out of it and how that changes with skill, talent
// rank and context. Filters live here and recompute everything below them.
export default function FarmingSourceModal({ sourceKey, initialItemKey = '', onClose }) {
  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS }))
  const [itemKey, setItemKey] = useState(initialItemKey)
  const [state, setState] = useState({ status: 'loading', detail: null })
  const url = sourceKey ? sourceDetailUrl(sourceKey, { filters, item: itemKey }) : ''

  useEffect(() => {
    if (!url) return undefined
    const controller = new AbortController()
    let active = true
    // Typing a skill range should not fire a request per keystroke.
    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, status: current.detail ? 'refreshing' : 'loading' }))
      apiJson(url, { signal: controller.signal })
        .then((detail) => { if (active) setState({ status: 'ready', detail }) })
        .catch((error) => {
          if (!active || error?.name === 'AbortError') return
          setState((current) => ({ ...current, status: error?.status === 404 ? 'missing' : 'error' }))
        })
    }, 200)
    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [url])

  if (!sourceKey) return null
  const { detail, status } = state
  const title = detail?.source?.name || 'Farming source'
  const selected = detail?.outputs.find((output) => output.itemKey === detail.selectedItemKey)

  return (
    <Modal title={title} ariaLabel={title} hideHeader size="farming" align="left" onClose={onClose}>
      <div className={`farm-modal${status === 'refreshing' ? ' is-refreshing' : ''}`} aria-busy={status === 'loading' || status === 'refreshing'}>
        {detail ? (
          <>
            <SourceHeader detail={detail} filtered={detail.summary.observations !== detail.source.totalObservations} />
            <SourceFilters facets={detail.facets} filters={filters} onChange={setFilters} />
            {detail.outputs.length ? (
              <>
                <section className="farm-section farm-section--drops">
                  <h3>Drop table</h3>
                  <div className="farm-drops__layout">
                    <div className="farm-scroll"><DropTable outputs={detail.outputs} selectedItemKey={detail.selectedItemKey} onSelect={setItemKey} /></div>
                    <OutputDonut outputs={detail.outputs} />
                  </div>
                  <p className="farm-note">Chance is gathers that produced the item over all {formatCount(detail.summary.observations)} gathers shown. Select an item to break it down below.</p>
                </section>
                <div className="farm-breakdowns">
                  <SkillBreakdown rows={detail.bySkill} itemName={selected?.name || 'Item'} discipline={detail.source.discipline} />
                  <BountifulHarvest rows={detail.byBountifulHarvest} itemName={selected?.name || 'Item'} />
                </div>
              </>
            ) : (
              <EmptyTelemetry title="No gathers match these filters.">Widen or reset the filters to see this source again.</EmptyTelemetry>
            )}
          </>
        ) : null}
        {status === 'loading' ? <p className="intel-muted">Reading observations…</p> : null}
        {status === 'missing' ? <EmptyTelemetry title="Source not found.">Nothing has been observed for this source yet.</EmptyTelemetry> : null}
        {status === 'error' ? <p className="intel-error">This source could not be loaded.</p> : null}
      </div>
    </Modal>
  )
}
