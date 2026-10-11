import { arcPath, confidenceLabel, donutSegments, formatCount, formatRate, rateLinePoints } from './farmingModel.js'

// Output share by quantity. A glance, not the record: the drop table beside
// it is authoritative, since a 0.5% drop is a sliver too thin to see.
export function OutputDonut({ outputs }) {
  const segments = donutSegments(outputs)
  if (!segments.length) return null
  const total = segments.reduce((sum, segment) => sum + segment.quantity, 0)

  return (
    <figure className="farm-donut">
      <svg viewBox="0 0 100 100" role="img" aria-label="Share of items gathered from this source">
        {segments.map((segment) => (
          <path key={segment.key} d={arcPath(segment.start, segment.end)} fill={segment.color}>
            <title>{`${segment.name}: ${formatRate(segment.share)} of items (${formatCount(segment.quantity)})`}</title>
          </path>
        ))}
        <text x="50" y="49" className="farm-donut__total">{formatCount(total)}</text>
        <text x="50" y="60" className="farm-donut__caption">items</text>
      </svg>
      <figcaption>
        {segments.map((segment) => (
          <span key={segment.key}>
            <i style={{ background: segment.color }} aria-hidden="true" />
            {segment.name}
            <b>{formatRate(segment.share)}</b>
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

const WIDTH = 320
const HEIGHT = 120

// Drop rate by skill bucket for one item. Each point carries its likely
// range; low-confidence points are hollow so a thin bucket reads as a hint.
export function SkillRateLine({ rows, itemName }) {
  const { points, maxRate } = rateLinePoints(rows, { width: WIDTH, height: HEIGHT })
  if (points.length < 2) return null
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join('')

  return (
    <svg className="farm-line" viewBox={`0 0 ${WIDTH} ${HEIGHT + 18}`} role="img" aria-label={`${itemName} drop rate by skill`}>
      <line className="farm-line__axis" x1="16" x2={WIDTH - 16} y1={HEIGHT - 14} y2={HEIGHT - 14} />
      <text className="farm-line__scale" x="16" y="9">{formatRate(maxRate)}</text>
      {points.map((point) => (
        <line key={`range-${point.bucket}`} className="farm-line__range" x1={point.x} x2={point.x} y1={point.yHigh} y2={point.yLow} />
      ))}
      <path className="farm-line__path" d={line} />
      {points.map((point) => (
        <g key={point.bucket} className={`farm-line__point farm-line__point--${point.confidence}`}>
          <circle cx={point.x} cy={point.y} r="4" />
          <circle className="farm-line__hit" cx={point.x} cy={point.y} r="12">
            <title>{`Skill ${point.bucket}: ${formatRate(point.rate)} (${formatCount(point.drops)} of ${formatCount(point.observations)}) · ${confidenceLabel(point.confidence)} confidence`}</title>
          </circle>
          <text className="farm-line__label" x={point.x} y={HEIGHT + 12}>{point.bucket}</text>
        </g>
      ))}
    </svg>
  )
}
