import { useMemo, useState } from 'react'

import { RankRateBars, SkillRateLine } from '../Intelligence/Farming/FarmingCharts.jsx'
import {
  EMPTY_FILTERS,
  activeFilterCount,
  disciplineLabel,
  formatCount,
  formatQuantity,
  formatRate,
  observationLabel,
  rankLabel,
  sourceKindLabel,
} from '../Intelligence/Farming/farmingModel.js'
import '../Intelligence/Farming/FarmingIntelligence.css'
import { rateScale } from './exploreModel.js'
import ResourceMap from './Map/ResourceMap.jsx'
import { dashboardHref, relativeTime } from './playerModel.js'
import { Confidence, DisciplineTag, EmptyState, ErrorState, Icon, ItemLabel, Panel, RateBar, SkeletonRows, Zone } from './ui.jsx'
import { useSourceDetail } from './useSourceDetail.js'

function formatDate(value) {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(time)) : '—'
}

function SourceHeader({ detail }) {
  const { source, summary } = detail
  const icon = detail.outputs[0]
  const zones = detail.facets?.zones || []
  // Two builds can share a client version; show each version once.
  const builds = [...new Map((summary.builds || []).map((build) => [build.version || build.build, build])).values()]
  return (
    <header className={`gw-source-head gw-source-head--${source.discipline}`}>
      <div className="gw-source-head__identity">
        <span className="gw-source-head__icon">
          <ItemLabel item={{ ...(icon || {}), name: '' }} size={64} tooltip={false} />
        </span>
        <div>
          <div className="gw-source-head__tags">
            <DisciplineTag discipline={source.discipline} />
            {source.kind ? <span className="gw-tag">{sourceKindLabel(source.kind)}</span> : null}
            {builds.map((build) => <span className="gw-tag gw-tag--quiet" key={build.version || build.build}>v{build.version || build.build}</span>)}
          </div>
          <h2>{source.name}</h2>
          <p className="gw-source-head__zones">
            {zones.slice(0, 4).map((zone) => <Zone key={zone.value} name={zone.value} />)}
            {zones.length > 4 ? <span className="gw-muted">+{zones.length - 4} more</span> : null}
          </p>
        </div>
      </div>
      <dl className="gw-source-head__facts">
        <div><dt>{observationLabel(source.discipline, 2)}</dt><dd>{formatCount(summary.observations)}</dd></div>
        <div><dt>Contributors</dt><dd>{formatCount(summary.characters)}</dd></div>
        <div><dt>Zones</dt><dd>{formatCount(summary.zones)}</dd></div>
        <div><dt>Observed</dt><dd>{formatDate(summary.firstObservedAt)} – {formatDate(summary.lastObservedAt)}</dd></div>
      </dl>
    </header>
  )
}

function FilterBar({ facets, filters, onChange }) {
  const set = (key) => (event) => onChange({ ...filters, [key]: event.target.value })
  const active = activeFilterCount(filters)
  const on = (...keys) => (keys.some((key) => String(filters[key] ?? '').trim()) ? ' is-active' : '')
  return (
    <div className="gw-filterbar" role="group" aria-label="Filter observations">
      <span className="gw-filterbar__label">Filter</span>
      {facets.zones.length > 1 ? (
        <label className={`gw-filter${on('zone')}`}>
          <span>Zone</span>
          <select value={filters.zone} onChange={set('zone')}>
            <option value="">All</option>
            {facets.zones.map((zone) => <option key={zone.value} value={zone.value}>{zone.value} ({formatCount(zone.observations)})</option>)}
          </select>
        </label>
      ) : null}
      <div className={`gw-filter gw-filter--range${on('skillMin', 'skillMax')}`} role="group" aria-label="Skill range">
        <span>Skill</span>
        <input inputMode="numeric" aria-label="Minimum skill" placeholder={String(facets.skill.min ?? 'min')} value={filters.skillMin} onChange={set('skillMin')} />
        <i aria-hidden="true">–</i>
        <input inputMode="numeric" aria-label="Maximum skill" placeholder={String(facets.skill.max ?? 'max')} value={filters.skillMax} onChange={set('skillMax')} />
      </div>
      <div className={`gw-filter gw-filter--range${on('levelMin', 'levelMax')}`} role="group" aria-label="Character level range">
        <span>Level</span>
        <input inputMode="numeric" aria-label="Minimum character level" placeholder={String(facets.level.min ?? 'min')} value={filters.levelMin} onChange={set('levelMin')} />
        <i aria-hidden="true">–</i>
        <input inputMode="numeric" aria-label="Maximum character level" placeholder={String(facets.level.max ?? 'max')} value={filters.levelMax} onChange={set('levelMax')} />
      </div>
      {facets.ranks.some((rank) => rank.value !== 'unknown') ? (
        <label className={`gw-filter${on('rank')}`}>
          <span>Bountiful Harvest</span>
          <select value={filters.rank} onChange={set('rank')}>
            <option value="">Any</option>
            {facets.ranks.map((rank) => <option key={rank.value} value={rank.value}>{rankLabel(rank.value)} ({formatCount(rank.observations)})</option>)}
          </select>
        </label>
      ) : null}
      {facets.builds.length > 1 || filters.build ? (
        <label className={`gw-filter${on('build')}`}>
          <span>Build</span>
          <select value={filters.build} onChange={set('build')}>
            <option value="">All</option>
            {facets.builds.map((build) => <option key={build.value} value={build.value}>{build.value} ({formatCount(build.observations)})</option>)}
          </select>
        </label>
      ) : null}
      {active ? <button type="button" className="gw-btn gw-btn--ghost gw-btn--sm" onClick={() => onChange({ ...EMPTY_FILTERS })}>Clear {active}</button> : null}
    </div>
  )
}

// Every observed output. Selecting a row drives the breakdown below.
function DropTable({ detail, onSelect }) {
  const max = rateScale(detail.outputs)
  const noun = observationLabel(detail.source.discipline, detail.summary.observations)
  const items = detail.outputs.reduce((sum, output) => sum + (Number(output.quantity) || 0), 0)
  return (
    <Panel
      id="gw-drops"
      title="What it drops"
      description={`${formatCount(items)} items from ${formatCount(detail.summary.observations)} ${noun}. Select a drop to see what changes its chance.`}
      flush
    >
      <div className="gw-table-wrap">
        <table className="gw-table gw-table--select" aria-label="Drop table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="gw-col-rate">Chance</th>
              <th scope="col" className="gw-col-num">Drops</th>
              <th scope="col" className="gw-col-num gw-hide-sm">Avg qty</th>
              <th scope="col" className="gw-col-conf">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {detail.outputs.map((output) => {
              const selected = output.itemKey === detail.selectedItemKey
              return (
                <tr key={output.itemKey} className={`is-link${selected ? ' is-selected' : ''}`} aria-selected={selected} onClick={() => onSelect(output.itemKey)}>
                  <td>
                    <button type="button" className="gw-row-button" aria-pressed={selected} onClick={(event) => { event.stopPropagation(); onSelect(output.itemKey) }}>
                      <ItemLabel item={output} size={28} />
                    </button>
                  </td>
                  <td className="gw-col-rate"><RateBar entry={output} max={max} /></td>
                  <td className="gw-col-num">{formatCount(output.drops)}</td>
                  <td className="gw-col-num gw-hide-sm">{formatQuantity(output.avgQuantity)}</td>
                  <td className="gw-col-conf"><Confidence confidence={output.confidence} showLabel /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function BreakdownTable({ rows, label, renderKey, discipline }) {
  const max = rateScale(rows)
  return (
    <table className="gw-table gw-table--compact">
      <thead>
        <tr>
          <th scope="col">{label}</th>
          <th scope="col" className="gw-col-rate">Chance</th>
          <th scope="col" className="gw-col-num">{observationLabel(discipline, 2)}</th>
          <th scope="col" className="gw-col-conf"><span className="visually-hidden">Confidence</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.bucket ?? row.rank}>
            <th scope="row">{renderKey(row)}</th>
            <td className="gw-col-rate"><RateBar entry={row} max={max} compact /></td>
            <td className="gw-col-num">{formatCount(row.observations)}</td>
            <td className="gw-col-conf"><Confidence confidence={row.confidence} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Breakdown({ detail }) {
  const [tab, setTab] = useState('skill')
  const item = detail.outputs.find((output) => output.itemKey === detail.selectedItemKey)
  if (!item) return null
  const discipline = detail.source.discipline
  const skillRows = detail.bySkill || []
  const rankRows = detail.byBountifulHarvest || []
  const hasRanks = rankRows.some((row) => row.rank !== 'unknown')
  const active = hasRanks ? tab : 'skill'
  const skillPlotted = skillRows.filter((row) => row.bucket !== 'unknown' && row.observations > 0).length >= 2
  const rankPlotted = rankRows.filter((row) => row.rank !== 'unknown' && row.observations > 0).length >= 2
  return (
    <Panel
      id="gw-breakdown"
      title={<span className="gw-breakdown-title"><ItemLabel item={item} size={24} /> <span>{formatRate(item.rate)} overall</span></span>}
      description="Observed outcomes, not proven effects. Groups also differ in zone and level; filter to compare like with like."
    >
      {hasRanks ? (
        <div className="gw-seg gw-seg--full" role="tablist" aria-label="Breakdown">
          <button type="button" role="tab" aria-selected={active === 'skill'} onClick={() => setTab('skill')}>{disciplineLabel(discipline)} skill</button>
          <button type="button" role="tab" aria-selected={active === 'rank'} onClick={() => setTab('rank')}>Bountiful Harvest</button>
        </div>
      ) : null}
      {active === 'skill' ? (
        <section className="gw-breakdown" aria-label={`By ${disciplineLabel(discipline)} skill`}>
          {skillPlotted ? <SkillRateLine rows={skillRows} itemName={item.name} /> : null}
          {skillRows.length
            ? <BreakdownTable rows={skillRows} label="Skill" discipline={discipline} renderKey={(row) => (row.bucket === 'unknown' ? 'Unknown' : row.bucket)} />
            : <p className="gw-muted">No skill readings for these observations.</p>}
        </section>
      ) : (
        <section className="gw-breakdown" aria-label="By Bountiful Harvest rank">
          {rankPlotted ? <RankRateBars rows={rankRows} itemName={item.name} /> : null}
          <BreakdownTable rows={rankRows} label="Rank" discipline={discipline} renderKey={(row) => rankLabel(row.rank)} />
        </section>
      )}
    </Panel>
  )
}

// One source's page: what it drops, where it is, and what changes the odds.
// Where this source is gathered, on the resource map, starting in its
// busiest zone.
function SourceMap({ detail, sourceKey }) {
  const filter = useMemo(() => ({ sources: [sourceKey] }), [sourceKey])
  return (
    <Panel
      id="gw-source-map"
      title="Resource map"
      description={`Every spot where players gathered ${detail.source?.name || 'this source'}. Coordinates match the in-game map; the numbered spots are the busiest in the zone you're viewing.`}
      flush
    >
      <ResourceMap
        variant="card"
        filter={filter}
        focus="busiest"
        defaultLegend="expanded"
        fullHref={`/map?source=${encodeURIComponent(sourceKey)}`}
        label={`${detail.source?.name || 'Source'} map`}
      />
    </Panel>
  )
}

export default function SourcePage({ sourceKey, initialItemKey = '', initialZone = '', server = '' }) {
  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS, zone: initialZone }))
  const [itemKey, setItemKey] = useState(initialItemKey)
  const [state, retry] = useSourceDetail(sourceKey, filters, itemKey)
  const { detail, status } = state
  const back = dashboardHref('farming', server)

  function select(next) {
    setItemKey(next)
    const url = new URL(window.location.href)
    url.searchParams.set('item', next)
    window.history.replaceState(window.history.state, '', url)
  }

  return (
    <div className={`gw-stack gw-source${status === 'refreshing' ? ' is-refreshing' : ''}`} aria-busy={status === 'loading' || status === 'refreshing'}>
      <nav className="gw-crumbs" aria-label="Breadcrumb">
        <a href={back}><Icon name="back" size={14} /> Drop rates</a>
        {detail ? <><span aria-hidden="true">/</span><span>{disciplineLabel(detail.source.discipline)}</span><span aria-hidden="true">/</span><span aria-current="page">{detail.source.name}</span></> : null}
      </nav>

      {status === 'loading' && !detail ? <SkeletonRows rows={8} label="Loading source" /> : null}
      {status === 'missing' ? <EmptyState title="Source not found." icon="pin" action={<a className="gw-btn" href={back}>Back to drop rates</a>}>Nothing has been observed for this source yet.</EmptyState> : null}
      {status === 'error' && !detail ? <ErrorState onRetry={retry}>This source could not be loaded.</ErrorState> : null}

      {detail ? (
        <>
          <SourceHeader detail={detail} />
          <FilterBar facets={detail.facets} filters={filters} onChange={setFilters} />
          {detail.outputs.length ? (
            <>
              <div className="gw-grid gw-grid--source">
                <DropTable detail={detail} onSelect={select} />
                <Breakdown detail={detail} />
              </div>
              <SourceMap detail={detail} sourceKey={sourceKey} />
            </>
          ) : (
            <EmptyState title="No observations match these filters." icon="farming" action={<button type="button" className="gw-btn" onClick={() => setFilters({ ...EMPTY_FILTERS })}>Clear filters</button>}>
              Widen or clear the filters to see this source again.
            </EmptyState>
          )}
          <p className="gw-footnote">Last observed {relativeTime(detail.summary.lastObservedAt)} · pooled from every Guildweaver player, without names or accounts.</p>
        </>
      ) : null}
    </div>
  )
}
