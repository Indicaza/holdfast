import { useEffect, useState } from 'react'

import { apiJson } from '../../Api/apiClient.js'
import Modal from '../../Modal/Modal.jsx'
import WowIcon from '../../WowAssets/WowIcon.jsx'
import EmptyTelemetry from '../EmptyTelemetry.jsx'
import '../CharacterProfileModal.css'
import { OutputDonut, SkillRateLine } from './FarmingCharts.jsx'
import {
  CONFIDENCE_LEVELS,
  EMPTY_FILTERS,
  activeFilterCount,
  confidenceLabel,
  disciplineLabel,
  donutSegments,
  formatCount,
  formatQuantity,
  formatRate,
  rankLabel,
  rateRangeText,
  sourceDetailUrl,
  sourceKindLabel,
} from './farmingModel.js'

// Four rising bars, lit to the confidence level. The label is always in the
// accessible name and the tooltip; `showLabel` prints it too.
export function ConfidencePips({ confidence, showLabel = false }) {
  const level = Math.max(0, CONFIDENCE_LEVELS.indexOf(confidence)) + 1
  const label = `${confidenceLabel(confidence)} confidence`
  return (
    <span className={`farm-pips farm-pips--${confidence || 'low'}`} role="img" aria-label={label} title={label}>
      <span className="farm-pips__bars" aria-hidden="true">
        {CONFIDENCE_LEVELS.map((name, index) => <i key={name} className={index < level ? 'is-lit' : undefined} />)}
      </span>
      {showLabel ? <span className="farm-pips__label" aria-hidden="true">{confidenceLabel(confidence)}</span> : null}
    </span>
  )
}

// A rate is as bold as it is trustworthy; its sample is in the tooltip.
function Rate({ entry, className = '' }) {
  return (
    <span className={`farm-rate farm-rate--${entry.confidence}${className ? ` ${className}` : ''}`} title={rateRangeText(entry)}>
      {formatRate(entry.rate)}
    </span>
  )
}

function RankPips({ rank, maxRanks = 5 }) {
  if (rank === 'unknown') return <span className="farm-rank farm-rank--unknown">Unknown</span>
  return (
    <span className="farm-rank" role="img" aria-label={rankLabel(rank)} title={rankLabel(rank)}>
      <span className="farm-rank__value" aria-hidden="true">{rank}/{maxRanks}</span>
      <span className="farm-rank__pips" aria-hidden="true">
        {Array.from({ length: maxRanks }, (_, index) => <i key={index} className={index < rank ? 'is-lit' : undefined} />)}
      </span>
    </span>
  )
}

function SourceHeader({ detail, filtered }) {
  const { source, summary } = detail
  const icon = detail.outputs[0]
  const builds = summary.builds.map((build) => build.build)

  return (
    <header className="farm-header">
      <span className="farm-header__portrait">
        <WowIcon iconFileId={icon?.iconFileDataId} itemId={icon?.itemId} label={source.name} quality={icon?.qualityId} size={60} />
      </span>
      <div className="farm-header__identity">
        <h2>{source.name}</h2>
        <span>{disciplineLabel(source.discipline)}{source.kind ? ` · ${sourceKindLabel(source.kind)}` : ''}</span>
      </div>
      <dl className="farm-header__facts">
        <div>
          <dt>Gathers</dt>
          <dd>{formatCount(summary.observations)}{filtered ? <small> / {formatCount(source.totalObservations)}</small> : null}</dd>
        </div>
        <div><dt>Characters</dt><dd>{formatCount(summary.characters)}</dd></div>
        <div><dt>Zones</dt><dd>{formatCount(summary.zones)}</dd></div>
        {builds.length ? <div><dt>{builds.length === 1 ? 'Build' : 'Builds'}</dt><dd>{builds.join(' · ')}</dd></div> : null}
      </dl>
    </header>
  )
}

function SourceFilters({ facets, filters, onChange }) {
  const set = (key) => (event) => onChange({ ...filters, [key]: event.target.value })
  const active = activeFilterCount(filters)

  return (
    <div className="farm-filters" role="group" aria-label="Filter observations">
      <label className="farm-filter">
        <span>Zone</span>
        <select value={filters.zone} onChange={set('zone')}>
          <option value="">All zones</option>
          {facets.zones.map((zone) => <option key={zone.value} value={zone.value}>{zone.value} ({formatCount(zone.observations)})</option>)}
        </select>
      </label>
      <div className="farm-filter farm-filter--range" role="group" aria-label="Skill range">
        <span>Skill</span>
        <input inputMode="numeric" aria-label="Minimum skill" placeholder={facets.skill.min ?? 'min'} value={filters.skillMin} onChange={set('skillMin')} />
        <i aria-hidden="true">–</i>
        <input inputMode="numeric" aria-label="Maximum skill" placeholder={facets.skill.max ?? 'max'} value={filters.skillMax} onChange={set('skillMax')} />
      </div>
      <div className="farm-filter farm-filter--range" role="group" aria-label="Character level range">
        <span>Level</span>
        <input inputMode="numeric" aria-label="Minimum character level" placeholder={facets.level.min ?? 'min'} value={filters.levelMin} onChange={set('levelMin')} />
        <i aria-hidden="true">–</i>
        <input inputMode="numeric" aria-label="Maximum character level" placeholder={facets.level.max ?? 'max'} value={filters.levelMax} onChange={set('levelMax')} />
      </div>
      {facets.ranks.some((rank) => rank.value !== 'unknown') ? (
        <label className="farm-filter">
          <span>Bountiful Harvest</span>
          <select value={filters.rank} onChange={set('rank')}>
            <option value="">Any rank</option>
            {facets.ranks.map((rank) => <option key={rank.value} value={rank.value}>{rankLabel(rank.value)} ({formatCount(rank.observations)})</option>)}
          </select>
        </label>
      ) : null}
      <label className="farm-filter">
        <span>Build</span>
        <select value={filters.build} onChange={set('build')}>
          <option value="">All builds</option>
          {facets.builds.map((build) => <option key={build.value} value={build.value}>{build.value} ({formatCount(build.observations)})</option>)}
        </select>
      </label>
      {active ? <button type="button" className="farm-filters__reset" onClick={() => onChange({ ...EMPTY_FILTERS })}>Clear {active}</button> : null}
    </div>
  )
}

// The loot window: every observed output, its chance and how far to trust it.
function LootPanel({ detail, onSelect }) {
  const swatches = new Map(donutSegments(detail.outputs).map((segment) => [segment.key, segment.color]))
  const items = detail.outputs.reduce((sum, output) => sum + output.quantity, 0)

  return (
    <section className="farm-panel farm-loot" aria-label="Drop table">
      <header className="farm-panel__header">
        <OutputDonut outputs={detail.outputs} />
        <div>
          <h3>Loot</h3>
          <p>{formatCount(items)} items from {formatCount(detail.summary.observations)} gathers</p>
        </div>
      </header>
      <ul className="farm-loot__list">
        {detail.outputs.map((output) => {
          const selected = output.itemKey === detail.selectedItemKey
          return (
            <li key={output.itemKey}>
              <button type="button" className={`farm-loot__row${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={() => onSelect(output.itemKey)}>
                <span className="farm-loot__swatch" style={{ background: swatches.get(output.itemKey) || 'var(--farm-other)' }} aria-hidden="true" />
                <WowIcon iconFileId={output.iconFileDataId} itemId={output.itemId} label={output.name} quality={output.qualityId} size={36} />
                <span className="farm-loot__item">
                  <strong className={`farm-item farm-item--q${output.qualityId ?? 1}`}>{output.name}</strong>
                  <small>{formatCount(output.drops)} drops · ×{formatQuantity(output.avgQuantity)} each</small>
                </span>
                <span className="farm-loot__chance">
                  <Rate entry={output} />
                  <ConfidencePips confidence={output.confidence} showLabel />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="farm-panel__footnote">Chance: gathers that produced the item ÷ every gather shown.</p>
    </section>
  )
}

function SkillTab({ rows, item }) {
  if (!rows.length) return <p className="farm-empty">No skill readings for these gathers.</p>
  return (
    <>
      <SkillRateLine rows={rows} itemName={item.name} />
      <table className="farm-table">
        <thead>
          <tr><th scope="col">Skill</th><th scope="col" className="num">Chance</th><th scope="col" className="num">Gathers</th><th scope="col" className="num">Confidence</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.bucket}>
              <th scope="row">{row.bucket === 'unknown' ? 'Unknown' : row.bucket}</th>
              <td className="num"><Rate entry={row} /></td>
              <td className="num farm-muted">{formatCount(row.observations)}</td>
              <td className="num"><ConfidencePips confidence={row.confidence} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function BountifulHarvestTab({ rows }) {
  const tentative = rows.some((row) => row.confidence === 'low' || row.confidence === 'medium')
  return (
    <>
      <table className="farm-table">
        <thead>
          <tr><th scope="col">Rank</th><th scope="col" className="num">Chance</th><th scope="col" className="num">Per gather</th><th scope="col" className="num">Gathers</th><th scope="col" className="num">Confidence</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rank}>
              <th scope="row"><RankPips rank={row.rank} /></th>
              <td className="num"><Rate entry={row} /></td>
              <td className="num">{formatQuantity(row.avgQuantityPerObservation)}</td>
              <td className="num farm-muted">{formatCount(row.observations)}</td>
              <td className="num"><ConfidencePips confidence={row.confidence} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="farm-panel__footnote">
        Observed outcomes, not proven effects.{tentative ? ' Some ranks need more gathers before they can be compared.' : ''} Ranks also differ in skill and zone, so filter to compare like with like.
      </p>
    </>
  )
}

const ANALYSIS_TABS = [
  { id: 'skill', label: 'By skill' },
  { id: 'bountiful', label: 'Bountiful Harvest' },
]

// The selected output, broken down by skill and by talent rank.
function AnalysisPanel({ detail }) {
  const [tab, setTab] = useState('skill')
  const item = detail.outputs.find((output) => output.itemKey === detail.selectedItemKey)
  const hasRanks = detail.byBountifulHarvest.some((row) => row.rank !== 'unknown')
  const tabs = hasRanks ? ANALYSIS_TABS : ANALYSIS_TABS.slice(0, 1)
  const active = tabs.some((entry) => entry.id === tab) ? tab : 'skill'
  if (!item) return null

  return (
    <section className="farm-analysis" aria-label={`${item.name} breakdown`}>
      <header className="farm-analysis__item">
        <WowIcon iconFileId={item.iconFileDataId} itemId={item.itemId} label={item.name} quality={item.qualityId} size={32} />
        <span className="farm-analysis__name">
          <strong className={`farm-item farm-item--q${item.qualityId ?? 1}`}>{item.name}</strong>
          <small>{formatCount(item.drops)} of {formatCount(item.observations)} gathers</small>
        </span>
        <Rate entry={item} className="farm-analysis__rate" />
      </header>
      <div className="armory-tabs farm-tabs" role="tablist" aria-label="Breakdown">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`farm-tab-${entry.id}`}
            aria-selected={active === entry.id}
            aria-controls="farm-tab-page"
            className="armory-tabs__tab"
            onClick={() => setTab(entry.id)}
          >
            {entry.id === 'skill' ? `${disciplineLabel(detail.source.discipline)} skill` : entry.label}
          </button>
        ))}
      </div>
      <div className="farm-panel farm-analysis__page" id="farm-tab-page" role="tabpanel" aria-labelledby={`farm-tab-${active}`}>
        {active === 'skill' ? <SkillTab rows={detail.bySkill} item={item} /> : <BountifulHarvestTab rows={detail.byBountifulHarvest} />}
      </div>
    </section>
  )
}

// One source: what comes out of it and how that changes with skill, talent
// rank and context. A fixed window like the character armory: the frame never
// scrolls, its panels do.
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

  return (
    <Modal title={title} ariaLabel={title} hideHeader size="armory" align="left" onClose={onClose}>
      <div className={`farm-modal${status === 'refreshing' ? ' is-refreshing' : ''}`} aria-busy={status === 'loading' || status === 'refreshing'}>
        {detail ? (
          <>
            <SourceHeader detail={detail} filtered={detail.summary.observations !== detail.source.totalObservations} />
            <SourceFilters facets={detail.facets} filters={filters} onChange={setFilters} />
            {detail.outputs.length ? (
              <div className="farm-modal__body">
                <LootPanel detail={detail} onSelect={setItemKey} />
                <AnalysisPanel detail={detail} />
              </div>
            ) : (
              <div className="farm-modal__state">
                <EmptyTelemetry title="No gathers match these filters.">Widen or clear the filters to see this source again.</EmptyTelemetry>
              </div>
            )}
          </>
        ) : (
          <div className="farm-modal__state">
            {status === 'loading' ? <p className="armory-state">Reading observations…</p> : null}
            {status === 'missing' ? <EmptyTelemetry title="Source not found.">Nothing has been observed for this source yet.</EmptyTelemetry> : null}
            {status === 'error' ? <EmptyTelemetry title="This source could not be loaded.">Farming telemetry is temporarily unavailable.</EmptyTelemetry> : null}
          </div>
        )}
      </div>
    </Modal>
  )
}
