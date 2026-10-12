import { useEffect, useState } from 'react'

import { apiJson } from '../../Api/apiClient.js'
import { useLiveRefresh } from '../../Live/liveUpdatesContext.js'
import Modal from '../../Modal/Modal.jsx'
import WowIcon from '../../WowAssets/WowIcon.jsx'
import EmptyTelemetry from '../EmptyTelemetry.jsx'
import { GameTooltipHover } from '../GameTooltip.jsx'
import '../CharacterProfileModal.css'
import { OutputDonut, RankRateBars, SkillRateLine } from './FarmingCharts.jsx'
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
  observationLabel,
  rankLabel,
  rateRangeText,
  sourceDetailUrl,
  sourceKindLabel,
} from './farmingModel.js'

// Four rising bars, lit to the confidence level. The full label is in the
// accessible name and tooltip; only a low sample says so out loud, because
// that is the one reading that changes what you should conclude.
export function ConfidencePips({ confidence }) {
  const level = Math.max(0, CONFIDENCE_LEVELS.indexOf(confidence)) + 1
  const label = `${confidenceLabel(confidence)} confidence`
  return (
    <span className={`farm-pips farm-pips--${confidence || 'low'}`} role="img" aria-label={label} title={label}>
      <span className="farm-pips__bars" aria-hidden="true">
        {CONFIDENCE_LEVELS.map((name, index) => <i key={name} className={index < level ? 'is-lit' : undefined} />)}
      </span>
      {confidence === 'low' || !confidence ? <span className="farm-pips__label" aria-hidden="true">Low sample</span> : null}
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

function TooltipItem({ item, size = 28, strong = true }) {
  const content = (
    <span className="farm-item-hover">
      <WowIcon iconFileId={item.iconFileDataId} itemId={item.itemId} label={item.name} quality={item.qualityId} size={size} />
      {strong ? <strong className={`farm-item farm-item--q${item.qualityId ?? 1}`}>{item.name}</strong> : <span className={`farm-item farm-item--q${item.qualityId ?? 1}`}>{item.name}</span>}
    </span>
  )
  return <GameTooltipHover item={item.item || item}>{content}</GameTooltipHover>
}

function SourceHeader({ detail, filtered }) {
  const { source, summary } = detail
  const icon = detail.outputs[0]
  const onlyZone = detail.facets?.zones?.length === 1 ? detail.facets.zones[0].value : ''
  const shownZone = detail.filters?.zone || onlyZone

  return (
    <header className="farm-header">
      <span className="farm-header__portrait">
        <WowIcon iconFileId={icon?.iconFileDataId} itemId={icon?.itemId} label={source.name} quality={icon?.qualityId} size={56} />
      </span>
      <div className="farm-header__identity">
        <h2>{source.name}</h2>
        <span>{disciplineLabel(source.discipline)}{source.kind ? ` · ${sourceKindLabel(source.kind)}` : ''}</span>
        {shownZone ? (
          <span className="farm-header__location">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z" /><circle cx="12" cy="10" r="2" /></svg>
            {shownZone}
          </span>
        ) : null}
      </div>
      <p className="farm-header__gathers">
        <strong>{formatCount(summary.observations)}</strong>
        <span>{filtered ? `of ${formatCount(source.totalObservations)} ${observationLabel(source.discipline, source.totalObservations)}` : observationLabel(source.discipline, summary.observations)}</span>
      </p>
    </header>
  )
}

function SourceFilters({ facets, filters, onChange }) {
  const set = (key) => (event) => onChange({ ...filters, [key]: event.target.value })
  const active = activeFilterCount(filters)
  const chip = (...keys) => `farm-chip${keys.some((key) => String(filters[key] ?? '').trim()) ? ' is-active' : ''}`

  return (
    <div className="farm-filters" role="group" aria-label="Filter observations">
      {facets.zones.length > 1 ? (
        <label className={chip('zone')}>
          <span>Zone</span>
          <select value={filters.zone} onChange={set('zone')}>
            <option value="">All</option>
            {facets.zones.map((zone) => <option key={zone.value} value={zone.value}>{zone.value} ({formatCount(zone.observations)})</option>)}
          </select>
        </label>
      ) : null}
      <div className={chip('skillMin', 'skillMax')} role="group" aria-label="Skill range">
        <span>Skill</span>
        <input inputMode="numeric" aria-label="Minimum skill" placeholder={facets.skill.min ?? 'min'} value={filters.skillMin} onChange={set('skillMin')} />
        <i aria-hidden="true">–</i>
        <input inputMode="numeric" aria-label="Maximum skill" placeholder={facets.skill.max ?? 'max'} value={filters.skillMax} onChange={set('skillMax')} />
      </div>
      <div className={chip('levelMin', 'levelMax')} role="group" aria-label="Character level range">
        <span>Level</span>
        <input inputMode="numeric" aria-label="Minimum character level" placeholder={facets.level.min ?? 'min'} value={filters.levelMin} onChange={set('levelMin')} />
        <i aria-hidden="true">–</i>
        <input inputMode="numeric" aria-label="Maximum character level" placeholder={facets.level.max ?? 'max'} value={filters.levelMax} onChange={set('levelMax')} />
      </div>
      {facets.ranks.some((rank) => rank.value !== 'unknown') ? (
        <label className={chip('rank')}>
          <span>Bountiful Harvest</span>
          <select value={filters.rank} onChange={set('rank')}>
            <option value="">Any</option>
            {facets.ranks.map((rank) => <option key={rank.value} value={rank.value}>{rankLabel(rank.value)} ({formatCount(rank.observations)})</option>)}
          </select>
        </label>
      ) : null}
      {facets.builds.length > 1 || filters.build ? (
        <label className={chip('build')}>
          <span>Build</span>
          <select value={filters.build} onChange={set('build')}>
            <option value="">All</option>
            {facets.builds.map((build) => <option key={build.value} value={build.value}>{build.value} ({formatCount(build.observations)})</option>)}
          </select>
        </label>
      ) : null}
      {active ? <button type="button" className="farm-filters__reset" onClick={() => onChange({ ...EMPTY_FILTERS })}>Clear</button> : null}
    </div>
  )
}

// Every observed output: the drop table the rest of the window explains.
// Selecting a row drives the breakdown below it.
function DropsPanel({ detail, onSelect }) {
  const swatches = new Map(donutSegments(detail.outputs).map((segment) => [segment.key, segment.color]))
  const items = detail.outputs.reduce((sum, output) => sum + output.quantity, 0)
  const showDonut = detail.summary.observations >= 8 && detail.outputs.length >= 3
  const noun = observationLabel(detail.source.discipline, detail.summary.observations)

  return (
    <section className="farm-panel farm-drops" aria-label="Drop table">
      <header className="farm-section-head">
        <div>
          <h3>Drops</h3>
          <p>{formatCount(items)} items from {formatCount(detail.summary.observations)} {noun} · select one to see what changes its chance</p>
        </div>
        {showDonut ? <OutputDonut outputs={detail.outputs} /> : null}
      </header>
      <div className="farm-drops__columns" aria-hidden="true">
        <span>Item</span><span>Chance</span><span>Drops</span><span>Avg qty</span><span>Confidence</span>
      </div>
      <ul className="farm-drops__list">
        {detail.outputs.map((output) => {
          const selected = output.itemKey === detail.selectedItemKey
          return (
            <li key={output.itemKey}>
              <button type="button" className={`farm-loot__row${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={() => onSelect(output.itemKey)}>
                <span className="farm-loot__item">
                  <span className="farm-loot__swatch" style={{ background: swatches.get(output.itemKey) || 'var(--farm-other)' }} aria-hidden="true" />
                  <TooltipItem item={output} />
                </span>
                <Rate entry={output} className="farm-loot__chance" />
                <span className="farm-loot__num">{formatCount(output.drops)}</span>
                <span className="farm-loot__num">{formatQuantity(output.avgQuantity)}</span>
                <ConfidencePips confidence={output.confidence} />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function BreakdownTable({ rows, label, renderKey, observationHeading = 'Observations', quantity = false }) {
  return (
    <table className="farm-table">
      <thead>
        <tr>
          <th scope="col">{label}</th>
          <th scope="col" className="num">Chance</th>
          {quantity ? <th scope="col" className="num">Per attempt</th> : null}
          <th scope="col" className="num">{observationHeading}</th>
          <th scope="col" className="num"><span className="farm-sr">Confidence</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.bucket ?? row.rank}>
            <th scope="row">{renderKey(row)}</th>
            <td className="num"><Rate entry={row} /></td>
            {quantity ? <td className="num">{formatQuantity(row.avgQuantityPerObservation)}</td> : null}
            <td className="num farm-muted">{formatCount(row.observations)}</td>
            <td className="num"><ConfidencePips confidence={row.confidence} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SkillTab({ rows, item, discipline }) {
  if (!rows.length) return <p className="farm-empty">No skill readings for these observations.</p>
  const plotted = rows.filter((row) => row.bucket !== 'unknown' && row.observations > 0)
  const samples = rows.reduce((sum, row) => sum + Number(row.observations || 0), 0)
  const showChart = samples >= 12 && plotted.length >= 2
  return (
    <div className="farm-breakdown">
      {showChart ? <SkillRateLine rows={rows} itemName={item.name} /> : <p className="farm-analysis-hint">More observations across multiple skill bands will unlock the trend chart.</p>}
      <BreakdownTable rows={rows} label="Skill" observationHeading={observationLabel(discipline, 2)} renderKey={(row) => (row.bucket === 'unknown' ? 'Unknown' : row.bucket)} />
    </div>
  )
}

function BountifulHarvestTab({ rows, item, discipline }) {
  const tentative = rows.some((row) => row.confidence === 'low' || row.confidence === 'medium')
  const ranked = rows.filter((row) => row.rank !== 'unknown' && row.observations > 0)
  const samples = rows.reduce((sum, row) => sum + Number(row.observations || 0), 0)
  const showChart = samples >= 12 && ranked.length >= 2
  return (
    <div className="farm-breakdown">
      <div className="farm-breakdown__chart">
        {showChart ? <RankRateBars rows={rows} itemName={item.name} /> : <p className="farm-analysis-hint">More observations across multiple ranks will unlock the comparison chart.</p>}
        <p className="farm-note">
          Observed outcomes, not proven effects.{tentative ? ' Some ranks need more observations to compare.' : ''} Ranks also differ in skill and zone; filter to compare like with like.
        </p>
      </div>
      <BreakdownTable rows={rows} label="Rank" observationHeading={observationLabel(discipline, 2)} quantity renderKey={(row) => <RankPips rank={row.rank} />} />
    </div>
  )
}

const ANALYSIS_TABS = [
  { id: 'skill', label: 'By skill' },
  { id: 'bountiful', label: 'Bountiful Harvest' },
]

// The selected drop, broken down by skill and by talent rank.
function BreakdownPanel({ detail }) {
  const [tab, setTab] = useState('skill')
  const item = detail.outputs.find((output) => output.itemKey === detail.selectedItemKey)
  const hasRanks = detail.byBountifulHarvest.some((row) => row.rank !== 'unknown')
  const tabs = hasRanks ? ANALYSIS_TABS : ANALYSIS_TABS.slice(0, 1)
  const active = tabs.some((entry) => entry.id === tab) ? tab : 'skill'
  if (!item) return null

  return (
    <section className="farm-breakdown-panel" aria-label={`${item.name} breakdown`}>
      <div className="farm-breakdown-panel__bar">
        <h3 className="farm-breakdown-panel__title">
          <TooltipItem item={item} size={24} />
          <small>drop chance</small>
        </h3>
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
      </div>
      <div className="farm-panel farm-breakdown-panel__page" id="farm-tab-page" role="tabpanel" aria-labelledby={`farm-tab-${active}`}>
        {active === 'skill'
          ? <SkillTab rows={detail.bySkill} item={item} discipline={detail.source.discipline} />
          : <BountifulHarvestTab rows={detail.byBountifulHarvest} item={item} discipline={detail.source.discipline} />}
      </div>
    </section>
  )
}

// One source: what comes out of it and how that changes with skill, talent
// rank and context. Built on the character armory's frame, sized to its
// content: the window never scrolls; if a long drop table outgrows the
// screen, the table scrolls inside itself.
export default function FarmingSourceModal({ sourceKey, initialItemKey = '', initialZone = '', onClose }) {
  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS, zone: initialZone }))
  const [itemKey, setItemKey] = useState(initialItemKey)
  const [state, setState] = useState({ status: 'loading', detail: null })
  const url = sourceKey ? sourceDetailUrl(sourceKey, { filters, item: itemKey }) : ''
  // A new gather of this source refreshes the open window in place.
  const [version, setVersion] = useState(0)
  useLiveRefresh(['farming'], () => setVersion((current) => current + 1), {
    matches: (event) => event.detail?.sourceKey === sourceKey,
    debounceMs: 1000,
  })

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
  }, [url, version])

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
                <DropsPanel detail={detail} onSelect={setItemKey} />
                <BreakdownPanel detail={detail} />
              </div>
            ) : (
              <div className="farm-modal__state">
                <EmptyTelemetry title="No observations match these filters.">Widen or clear the filters to see this source again.</EmptyTelemetry>
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
