import { useMemo, useState } from 'react'

import './RosterComposition.css'

const chartColors = [
  'var(--intel-chart-1)',
  'var(--intel-chart-2)',
  'var(--intel-chart-3)',
  'var(--intel-chart-4)',
  'var(--intel-chart-5)',
  'var(--intel-chart-6)',
  'var(--intel-chart-7)',
  'var(--intel-chart-8)',
  'var(--intel-chart-9)',
  'var(--intel-chart-10)',
  'var(--intel-chart-11)',
  'var(--intel-chart-12)',
]

const modes = [
  { key: 'classes', label: 'Classes', totalLabel: 'synced characters' },
  { key: 'specs', label: 'Specs', totalLabel: 'synced characters' },
  { key: 'professions', label: 'Professions', totalLabel: 'profession observations' },
]

function entryValue(entry) {
  return Math.max(0, Number(entry?.count ?? entry?.characters) || 0)
}

function normalizeEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => ({ name: String(entry?.name || 'Unknown'), value: entryValue(entry) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
}

function tuneEntries(entries, limit) {
  if (limit === 'all' || entries.length <= Number(limit)) return entries

  const keep = Math.max(1, Number(limit) - 1)
  const visible = entries.slice(0, keep)
  const other = entries.slice(keep).reduce((sum, entry) => sum + entry.value, 0)
  return other ? [...visible, { name: 'Other', value: other }] : visible
}

function buildSegments(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.value, 0)
  let offset = 0
  const gap = entries.length > 1 ? 0.9 : 0

  const segments = entries.map((entry, index) => {
    const percent = total ? (entry.value / total) * 100 : 0
    const segment = {
      ...entry,
      color: chartColors[index % chartColors.length],
      percent,
      offset,
      dash: Math.max(0, percent - gap),
    }
    offset += percent
    return segment
  })

  return { total, segments }
}

function modeEntries(mode, data) {
  if (mode === 'specs') return data.specDistribution
  if (mode === 'professions') return data.professions
  return data.classDistribution
}

function percentLabel(value) {
  if (value >= 10) return `${Math.round(value)}%`
  return `${value.toFixed(1)}%`
}

export default function RosterComposition({ data }) {
  const [mode, setMode] = useState('classes')
  const [limit, setLimit] = useState('8')
  const [hoveredName, setHoveredName] = useState('')
  const [pinnedName, setPinnedName] = useState('')

  const modeConfig = modes.find((entry) => entry.key === mode) || modes[0]
  const normalized = useMemo(() => normalizeEntries(modeEntries(mode, data)), [data, mode])
  const visible = useMemo(() => tuneEntries(normalized, limit), [normalized, limit])
  const chart = useMemo(() => buildSegments(visible), [visible])
  const activeName = hoveredName || pinnedName
  const active = chart.segments.find((entry) => entry.name === activeName) || null
  const largest = normalized[0] || null

  function chooseMode(nextMode) {
    setMode(nextMode)
    setHoveredName('')
    setPinnedName('')
  }

  function togglePinned(name) {
    setPinnedName((current) => current === name ? '' : name)
  }

  return (
    <section className="roster-composition" id="composition" aria-labelledby="roster-composition-title">
      <div className="roster-composition__heading">
        <div>
          <span>Roster composition</span>
          <h2 id="roster-composition-title">See what the guild can field.</h2>
          <p>Switch the same live chart between classes, specializations, and professions. Tune the slice count to expose the long tail or keep the view compact.</p>
        </div>
        <div className="roster-composition__controls">
          <div className="roster-composition__mode" role="group" aria-label="Composition dimension">
            {modes.map((entry) => (
              <button
                className={entry.key === mode ? 'is-active' : ''}
                key={entry.key}
                type="button"
                aria-pressed={entry.key === mode}
                onClick={() => chooseMode(entry.key)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <label className="roster-composition__limit">
            <span>Slice detail</span>
            <select value={limit} onChange={(event) => { setLimit(event.target.value); setPinnedName('') }}>
              <option value="5">Top 5</option>
              <option value="8">Top 8</option>
              <option value="12">Top 12</option>
              <option value="all">All</option>
            </select>
          </label>
        </div>
      </div>

      {chart.total ? (
        <div className="roster-composition__body">
          <div className="roster-composition__chart-wrap">
            <svg
              className="roster-composition__chart"
              viewBox="0 0 120 120"
              role="img"
              aria-label={`${modeConfig.label} composition from ${chart.total} ${modeConfig.totalLabel}`}
              onMouseLeave={() => setHoveredName('')}
            >
              <circle className="roster-composition__track" cx="60" cy="60" r="43" pathLength="100" />
              {chart.segments.map((segment) => (
                <circle
                  className={`roster-composition__segment${activeName === segment.name ? ' is-active' : ''}`}
                  key={segment.name}
                  cx="60"
                  cy="60"
                  r="43"
                  pathLength="100"
                  stroke={segment.color}
                  strokeDasharray={`${segment.dash} ${100 - segment.dash}`}
                  strokeDashoffset={-segment.offset}
                  transform="rotate(-90 60 60)"
                  onMouseEnter={() => setHoveredName(segment.name)}
                  onClick={() => togglePinned(segment.name)}
                />
              ))}
            </svg>
            <div className="roster-composition__center" aria-live="polite">
              {active ? (
                <>
                  <span>{active.name}</span>
                  <strong>{active.value}</strong>
                  <small>{percentLabel(active.percent)} of {modeConfig.totalLabel}</small>
                </>
              ) : (
                <>
                  <span>{modeConfig.label}</span>
                  <strong>{chart.total}</strong>
                  <small>{modeConfig.totalLabel}</small>
                </>
              )}
            </div>
          </div>

          <div className="roster-composition__legend" aria-label={`${modeConfig.label} breakdown`}>
            {chart.segments.map((segment) => (
              <button
                className={pinnedName === segment.name ? 'is-active' : ''}
                key={segment.name}
                type="button"
                aria-pressed={pinnedName === segment.name}
                onMouseEnter={() => setHoveredName(segment.name)}
                onMouseLeave={() => setHoveredName('')}
                onFocus={() => setHoveredName(segment.name)}
                onBlur={() => setHoveredName('')}
                onClick={() => togglePinned(segment.name)}
              >
                <span className="roster-composition__swatch" style={{ background: segment.color }} aria-hidden="true" />
                <span className="roster-composition__legend-name">{segment.name}</span>
                <strong>{segment.value}</strong>
                <small>{percentLabel(segment.percent)}</small>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="roster-composition__empty">
          <strong>No {modeConfig.label.toLowerCase()} telemetry yet.</strong>
          <span>The chart will populate from synced character snapshots.</span>
        </div>
      )}

      <div className="roster-composition__facts" aria-label={`${modeConfig.label} composition summary`}>
        <article>
          <span>Largest group</span>
          <strong>{largest?.name || 'None yet'}</strong>
          <small>{largest ? `${largest.value} represented` : 'Waiting for telemetry'}</small>
        </article>
        <article>
          <span>Distinct</span>
          <strong>{normalized.length}</strong>
          <small>{modeConfig.label.toLowerCase()} represented</small>
        </article>
        <article>
          <span>Observed</span>
          <strong>{normalized.reduce((sum, entry) => sum + entry.value, 0)}</strong>
          <small>{modeConfig.totalLabel}</small>
        </article>
      </div>
    </section>
  )
}
