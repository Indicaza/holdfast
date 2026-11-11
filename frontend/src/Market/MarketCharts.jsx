import { useEffect, useMemo, useRef, useState } from 'react'

import {
  CHART_COLORS,
  RANGES,
  SOURCE_LABELS,
  chartGaps,
  chartSegments,
  formatCoins,
  formatCoinsShort,
  formatDateTime,
  formatDayLabel,
  formatTick,
  niceMax,
  rollingMedian,
  seriesSummary,
  timeTicks,
} from './marketFormat.js'

const SURFACE = '#101318'
const PAD = { top: 10, right: 12, bottom: 22, left: 52 }

function useWidth(fallback = 640) {
  const ref = useRef(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

function linear(domain, range) {
  const [d0, d1] = domain
  const [r0, r1] = range
  return (value) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((value - d0) / (d1 - d0)) * (r1 - r0))
}

function pathOf(segment, x, y) {
  return segment.map((point, index) => `${index ? 'L' : 'M'}${x(point.t).toFixed(1)},${y(point.value).toFixed(1)}`).join('')
}

function nearestIndex(points, t) {
  let best = -1
  let distance = Infinity
  points.forEach((point, index) => {
    const d = Math.abs(point.t - t)
    if (d < distance) { distance = d; best = index }
  })
  return best
}

const PRICE_LINES = [
  { key: 'min', label: 'Lowest ask', color: CHART_COLORS.min },
  { key: 'typical', label: 'Typical ask', color: CHART_COLORS.typical },
  { key: 'median', label: 'Rolling median', color: CHART_COLORS.median, dashed: true },
]

// Price history over supply, sharing one time axis and one crosshair.
// Values are observed asking prices per unit; gaps stay gaps.
export function MarketCharts({ history, range, onRange, compact = false, status = 'ready' }) {
  const all = useMemo(() => history?.series || [], [history])
  const [sourceIndex, setSourceIndex] = useState(0)
  useEffect(() => { setSourceIndex(0) }, [history?.itemKey, history?.marketKey])
  const active = all[Math.min(sourceIndex, Math.max(0, all.length - 1))] || null
  const points = useMemo(() => active?.points || [], [active])
  const windowSeconds = history?.resolution === 'hour' ? 24 * 3600 : history?.resolution === 'day' ? 7 * 86400 : 4 * 7 * 86400
  const withMedian = useMemo(() => {
    const medians = rollingMedian(points, windowSeconds)
    return points.map((point, index) => ({ ...point, median: medians[index].median }))
  }, [points, windowSeconds])
  const [shown, setShown] = useState({ min: true, typical: true, median: !compact })
  const [measure, setMeasure] = useState('quantity')
  const [hover, setHover] = useState(null)
  const [zoom, setZoom] = useState(null)
  const [drag, setDrag] = useState(null)
  useEffect(() => { setZoom(null); setHover(null) }, [history?.range, history?.itemKey, sourceIndex])
  const [wrapRef, width] = useWidth()
  const priceHeight = compact ? 150 : 230
  const supplyHeight = compact ? 64 : 96

  const gap = active?.gapSeconds ?? Infinity
  const resolution = history?.resolutionSeconds || 3600
  const firstT = points[0]?.t
  const domain = useMemo(() => {
    const to = history?.to ?? (points.at(-1)?.t ?? 0)
    let from = history?.from ?? firstT ?? to - resolution
    // Adapt to the data actually there: a 1-year range with ten days of
    // history shows those ten days.
    if (firstT !== undefined && firstT > from) from = Math.max(from, firstT - resolution)
    return zoom || [from, Math.max(to, from + resolution)]
  }, [history, firstT, resolution, zoom, points])
  const visible = withMedian.filter((point) => point.t >= domain[0] - resolution && point.t <= domain[1])
  const priceKeys = PRICE_LINES.filter((line) => shown[line.key]).map((line) => line.key)
  const values = visible.flatMap((point) => priceKeys.map((key) => point[key])).filter((value) => value !== null && value !== undefined)
  const top = niceMax(values.length ? Math.max(...values) * 1.06 : 1)
  const bottom = values.length ? Math.max(0, Math.floor(Math.min(...values) * 0.9)) : 0
  const x = linear(domain, [PAD.left, width - PAD.right])
  const yPrice = linear([bottom, top], [priceHeight - PAD.bottom, PAD.top])
  const supplyValues = visible.map((point) => point[measure]).filter((value) => value !== null && value !== undefined)
  const supplyTop = niceMax(Math.max(1, ...supplyValues))
  const ySupply = linear([0, supplyTop], [supplyHeight - 4, 6])
  const { step, ticks } = timeTicks(domain[0], domain[1], Math.max(3, Math.floor(width / 85)))
  const priceTicks = [bottom, (bottom + top) / 2, top]
  const gaps = chartGaps(visible, gap)
  const hoverPoint = hover === null ? null : withMedian[hover] || null
  const barWidth = Math.max(2, Math.min(14, (x(domain[0] + resolution) - x(domain[0])) * 0.7))
  const summary = seriesSummary(visible)
  const lastSeen = points.at(-1)?.lastAt ?? points.at(-1)?.t
  const staleFor = lastSeen && history?.to ? history.to - lastSeen : 0

  function timeAt(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * width
    return domain[0] + ((px - PAD.left) / (width - PAD.left - PAD.right)) * (domain[1] - domain[0])
  }
  function move(event) {
    const t = timeAt(event)
    setHover(nearestIndex(withMedian, t))
    if (drag) setDrag({ ...drag, to: t })
  }
  function key(event) {
    const indices = withMedian.map((point, index) => (point.t >= domain[0] - resolution && point.t <= domain[1] ? index : -1)).filter((index) => index >= 0)
    if (!indices.length) return
    const position = hover === null ? -1 : indices.indexOf(hover)
    if (event.key === 'ArrowRight') setHover(indices[Math.min(indices.length - 1, position + 1)])
    else if (event.key === 'ArrowLeft') setHover(indices[Math.max(0, position === -1 ? indices.length - 1 : position - 1)])
    else if (event.key === 'Home') setHover(indices[0])
    else if (event.key === 'End') setHover(indices.at(-1))
    else if (event.key === 'Escape') { setHover(null); setZoom(null) }
    else return
    event.preventDefault()
  }
  function endDrag() {
    if (drag && Math.abs(x(drag.to) - x(drag.from)) > 12) {
      const from = Math.min(drag.from, drag.to)
      const to = Math.max(drag.from, drag.to)
      if (to - from >= resolution * 2) setZoom([from, to])
    }
    setDrag(null)
  }

  const header = (
    <div className="gw-mc__bar">
      <div className="gw-seg gw-seg--xs" role="group" aria-label="Time range">
        {RANGES.map((entry) => (
          <button type="button" key={entry.id} className={range === entry.id ? 'is-active' : ''} aria-pressed={range === entry.id} onClick={() => onRange?.(entry.id)}>{entry.label}</button>
        ))}
      </div>
      <div className="gw-mc__legend" role="group" aria-label="Lines">
        {PRICE_LINES.map((line) => (
          <button type="button" key={line.key} className={`gw-mc__key${shown[line.key] ? '' : ' is-off'}`} aria-pressed={shown[line.key]}
            onClick={() => setShown((current) => ({ ...current, [line.key]: !current[line.key] }))}>
            <i style={{ background: line.dashed ? 'transparent' : line.color, borderTop: line.dashed ? `2px dashed ${line.color}` : undefined }} />{line.label}
          </button>
        ))}
      </div>
      {all.length > 1 ? (
        <label className="gw-mc__source">
          <span className="gw-sr">Source</span>
          <select value={sourceIndex} onChange={(event) => setSourceIndex(Number(event.target.value))} aria-label="History source">
            {all.map((entry, index) => <option key={`${entry.marketKey}:${entry.source}`} value={index}>{SOURCE_LABELS[entry.source] || entry.source}{entry.marketKey !== history.marketKey ? ' (linked)' : ''} · {entry.points.length}</option>)}
          </select>
        </label>
      ) : null}
      {zoom ? <button type="button" className="gw-btn gw-btn--xs" onClick={() => setZoom(null)}>Reset zoom</button> : null}
    </div>
  )

  if (status === 'loading' && !points.length) {
    return <figure className="gw-mc" aria-busy="true">{header}<div className="gw-mc__empty" style={{ height: priceHeight + supplyHeight }}>Loading history…</div></figure>
  }
  if (!points.length) {
    return (
      <figure className="gw-mc">
        {header}
        <div className="gw-mc__empty" style={{ height: compact ? 90 : 160 }}>
          No complete observations in this range{range !== 'all' ? '. Try a longer range.' : '.'}
        </div>
      </figure>
    )
  }

  const notices = []
  if (points.length < 3) notices.push(`Only ${points.length} observation${points.length === 1 ? '' : 's'} in this range: too few to read a trend.`)
  if (staleFor > 24 * 3600) notices.push(`Nothing observed in the last ${Math.round(staleFor / 3600) >= 48 ? `${Math.round(staleFor / 86400)} days` : `${Math.round(staleFor / 3600)} hours`}.`)
  if (gaps.length) notices.push(`${gaps.length} gap${gaps.length === 1 ? '' : 's'} without observations, left blank.`)

  const tooltipLeft = hoverPoint ? Math.min(Math.max(x(hoverPoint.t) / width, 0.12), 0.88) * 100 : 0
  return (
    <figure className={`gw-mc${compact ? ' gw-mc--compact' : ''}`}>
      {header}
      <p className="gw-sr">
        {summary ? `${SOURCE_LABELS[active.source] || active.source}: typical ask from ${formatCoins(summary.first)} to ${formatCoins(summary.last)}, low ${formatCoins(summary.low)}, high ${formatCoins(summary.high)}, ${summary.observations} observations.` : ''}
      </p>
      <div className="gw-mc__plot" ref={wrapRef}>
        <svg width={width} height={priceHeight} role="img" aria-label="Asking price per unit over time. Arrow keys step through observations." tabIndex={0}
          onPointerMove={move} onPointerLeave={() => { setHover(null); setDrag(null) }} onKeyDown={key}
          onPointerDown={(event) => { const t = timeAt(event); setDrag({ from: t, to: t }) }} onPointerUp={endDrag} onDoubleClick={() => setZoom(null)}>
          {gaps.map(([from, to]) => (
            <rect key={from} x={x(from)} y={PAD.top} width={Math.max(0, x(to) - x(from))} height={priceHeight - PAD.top - PAD.bottom} className="gw-mc__gap" />
          ))}
          {priceTicks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={width - PAD.right} y1={yPrice(tick)} y2={yPrice(tick)} className="gw-mc__grid" />
              <text x={PAD.left - 6} y={yPrice(tick) + 4} textAnchor="end" className="gw-mc__axis">{formatCoinsShort(tick)}</text>
            </g>
          ))}
          {ticks.map((tick) => <text key={tick} x={x(tick)} y={priceHeight - 6} textAnchor="middle" className="gw-mc__axis">{formatTick(tick, step)}</text>)}
          {PRICE_LINES.filter((line) => shown[line.key]).map((line) => chartSegments(visible, line.key, gap).map((segment) => (
            segment.length === 1
              ? <circle key={`${line.key}${segment[0].t}`} cx={x(segment[0].t)} cy={yPrice(segment[0].value)} r="3" fill={line.color} />
              : <path key={`${line.key}${segment[0].t}`} d={pathOf(segment, x, yPrice)} stroke={line.color} strokeWidth={line.dashed ? 1.5 : 2}
                strokeDasharray={line.dashed ? '5 4' : undefined} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          )))}
          {drag && Math.abs(x(drag.to) - x(drag.from)) > 4 ? (
            <rect x={Math.min(x(drag.from), x(drag.to))} y={PAD.top} width={Math.abs(x(drag.to) - x(drag.from))} height={priceHeight - PAD.top - PAD.bottom} className="gw-mc__brush" />
          ) : null}
          {hoverPoint ? (
            <g>
              <line x1={x(hoverPoint.t)} x2={x(hoverPoint.t)} y1={PAD.top} y2={priceHeight - PAD.bottom} className="gw-mc__cross" />
              {PRICE_LINES.filter((line) => shown[line.key] && hoverPoint[line.key] !== null && hoverPoint[line.key] !== undefined).map((line) => (
                <circle key={line.key} cx={x(hoverPoint.t)} cy={yPrice(hoverPoint[line.key])} r="4" fill={line.color} stroke={SURFACE} strokeWidth="2" />
              ))}
            </g>
          ) : null}
        </svg>
        {hoverPoint ? (
          <div className="gw-mc__tip" style={{ left: `${tooltipLeft}%` }} role="status">
            <strong>{history.resolution === 'hour' ? formatDateTime(hoverPoint.lastAt ?? hoverPoint.t) : formatDayLabel(hoverPoint.label, history.resolution)}</strong>
            {hoverPoint.samples > 1 ? <small>{hoverPoint.samples} observations{history.resolution === 'hour' ? ' this hour' : history.resolution === 'day' ? ' that day' : ''}</small> : null}
            {PRICE_LINES.map((line) => (
              <span key={line.key}><i style={{ background: line.color }} />{line.label}<b>{formatCoins(hoverPoint[line.key])}</b></span>
            ))}
            {history.resolution !== 'hour' && hoverPoint.minLow !== undefined && hoverPoint.minLow !== hoverPoint.min ? <span className="gw-muted">Lowest seen<b>{formatCoins(hoverPoint.minLow)}</b></span> : null}
            <span className="gw-muted">Listed<b>{hoverPoint.quantity?.toLocaleString('en-US') ?? '—'}{hoverPoint.listings ? ` in ${hoverPoint.listings}` : ''}</b></span>
          </div>
        ) : null}
      </div>
      <div className="gw-mc__supplyhead">
        <span>Supply</span>
        <div className="gw-seg gw-seg--xs" role="group" aria-label="Supply measure">
          {[['quantity', 'Quantity listed'], ['listings', 'Auctions']].map(([value, label]) => (
            <button type="button" key={value} className={measure === value ? 'is-active' : ''} aria-pressed={measure === value} onClick={() => setMeasure(value)}>{label}</button>
          ))}
        </div>
        <span className="gw-muted">scale 0–{supplyTop.toLocaleString('en-US')}</span>
      </div>
      <svg width={width} height={supplyHeight} role="img" aria-label={`${measure === 'quantity' ? 'Quantity listed' : 'Number of auctions'} over time`}
        onPointerMove={move} onPointerLeave={() => setHover(null)} className="gw-mc__supply">
        <line x1={PAD.left} x2={width - PAD.right} y1={supplyHeight - 4} y2={supplyHeight - 4} className="gw-mc__grid" />
        {visible.map((point) => {
          const value = point[measure]
          if (value === null || value === undefined) return null
          const h = Math.max(value > 0 ? 2 : 1, supplyHeight - 4 - ySupply(value))
          const isHover = hoverPoint && hoverPoint.t === point.t
          return <rect key={point.t} x={x(point.t) - barWidth / 2} y={supplyHeight - 4 - h} width={barWidth} height={h} rx={Math.min(2, barWidth / 3)}
            fill={value === 0 ? 'transparent' : CHART_COLORS.supply} stroke={value === 0 ? CHART_COLORS.supply : 'none'} strokeWidth={value === 0 ? 1 : 0}
            opacity={hoverPoint && !isHover ? 0.45 : 0.9} />
        })}
        {hoverPoint ? <line x1={x(hoverPoint.t)} x2={x(hoverPoint.t)} y1={0} y2={supplyHeight - 4} className="gw-mc__cross" /> : null}
      </svg>
      {notices.length ? <ul className="gw-mc__notes">{notices.map((note) => <li key={note}>{note}</li>)}</ul> : null}
      <figcaption className="gw-mc__caption">
        {SOURCE_LABELS[active.source] || active.source} · {history.resolution === 'hour' ? 'hourly' : history.resolution === 'day' ? 'daily' : 'weekly'} points · asking prices per unit, not sales{!compact ? ' · drag to zoom' : ''}
      </figcaption>
      {!compact ? (
        <details className="gw-mc__table">
          <summary>Table</summary>
          <div className="gw-table-wrap">
            <table className="gw-table gw-table--dense">
              <thead><tr><th scope="col">{history.resolution === 'hour' ? 'Hour' : history.resolution === 'day' ? 'Day' : 'Week of'}</th><th scope="col" className="gw-col-num">Lowest</th>
                <th scope="col" className="gw-col-num">Typical</th><th scope="col" className="gw-col-num">Listed</th><th scope="col" className="gw-col-num">Auctions</th><th scope="col" className="gw-col-num">Observations</th></tr></thead>
              <tbody>{[...visible].reverse().map((point) => (
                <tr key={point.t}><td>{history.resolution === 'hour' ? formatDateTime(point.lastAt ?? point.t) : formatDayLabel(point.label, history.resolution)}</td><td className="gw-col-num">{formatCoins(point.min)}</td>
                  <td className="gw-col-num">{formatCoins(point.typical)}</td><td className="gw-col-num">{point.quantity?.toLocaleString('en-US') ?? '—'}</td>
                  <td className="gw-col-num">{point.listings ?? '—'}</td><td className="gw-col-num">{point.samples}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      ) : null}
    </figure>
  )
}
