import { arcPath, confidenceLabel, donutSegments, formatCount, formatRate, rateBars, rateLinePoints } from './farmingModel.js'

// Output share by quantity. A glance, not the record: the loot rows beside it
// carry the same colours and are authoritative, since a 0.5% drop is a sliver
// too thin to see.
export function OutputDonut({ outputs }) {
  const segments = donutSegments(outputs)
  if (!segments.length) return null

  return (
    <svg className="farm-donut" viewBox="0 0 100 100" role="img" aria-label={segments.map((segment) => `${segment.name} ${formatRate(segment.share)}`).join(', ')}>
      <circle cx="50" cy="50" r="37" className="farm-donut__track" />
      {segments.map((segment) => (
        <path key={segment.key} d={arcPath(segment.start, segment.end, { radius: 46, inner: 30 })} fill={segment.color}>
          <title>{`${segment.name}: ${formatRate(segment.share)} of items (${formatCount(segment.quantity)})`}</title>
        </path>
      ))}
    </svg>
  )
}

const WIDTH = 360
const HEIGHT = 150
const PAD_X = 34
const PAD_Y = 14

// Drop rate by skill bucket for one item. Each point carries its likely
// range; low- and medium-confidence points are hollow so a thin bucket reads
// as a hint.
export function SkillRateLine({ rows, itemName }) {
  const { points, maxRate } = rateLinePoints(rows, { width: WIDTH, height: HEIGHT, padX: PAD_X, padY: PAD_Y })
  if (points.length < 2) return null
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join('')
  const baseline = HEIGHT - PAD_Y
  const area = `${line}L${points.at(-1).x} ${baseline}L${points[0].x} ${baseline}Z`
  return (
    <svg className="farm-line" viewBox={`0 0 ${WIDTH} ${HEIGHT + 16}`} role="img" aria-label={`${itemName} drop rate by skill`}>
      <defs>
        <linearGradient id="farm-line-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffd100" stopOpacity=".22" />
          <stop offset="1" stopColor="#ffd100" stopOpacity="0" />
        </linearGradient>
      </defs>
      <Gridlines maxRate={maxRate} />
      {points.map((point) => (
        <line key={`range-${point.bucket}`} className="farm-line__range" x1={point.x} x2={point.x} y1={point.yHigh} y2={point.yLow} />
      ))}
      <path className="farm-line__area" d={area} fill="url(#farm-line-fill)" />
      <path className="farm-line__path" d={line} />
      {points.map((point) => (
        <g key={point.bucket} className={`farm-line__point farm-line__point--${point.confidence}`}>
          <circle cx={point.x} cy={point.y} r="4" />
          <circle className="farm-line__hit" cx={point.x} cy={point.y} r="14">
            <title>{`Skill ${point.bucket}: ${formatRate(point.rate)} (${formatCount(point.drops)} of ${formatCount(point.observations)}) · ${confidenceLabel(point.confidence)} confidence`}</title>
          </circle>
          <text className="farm-line__label" x={point.x} y={HEIGHT + 12}>{point.bucket}</text>
        </g>
      ))}
    </svg>
  )
}

function Gridlines({ maxRate }) {
  const baseline = HEIGHT - PAD_Y
  return [0, 0.5, 1].map((fraction) => {
    const y = baseline - fraction * (HEIGHT - PAD_Y * 2)
    return (
      <g key={fraction} className="farm-line__grid">
        <line x1={PAD_X} x2={WIDTH - 8} y1={y} y2={y} />
        <text x={PAD_X - 6} y={y + 3}>{formatRate(maxRate * fraction)}</text>
      </g>
    )
  })
}

// Drop rate at each Bountiful Harvest rank. Thin samples are hollow bars, so
// a tall bar resting on a handful of gathers does not read as a finding.
export function RankRateBars({ rows, itemName }) {
  const { bars, maxRate } = rateBars(rows, { width: WIDTH, height: HEIGHT, padX: PAD_X, padY: PAD_Y })
  if (bars.length < 2) return null

  return (
    <svg className="farm-line farm-bars" viewBox={`0 0 ${WIDTH} ${HEIGHT + 16}`} role="img" aria-label={`${itemName} drop rate by Bountiful Harvest rank`}>
      <Gridlines maxRate={maxRate} />
      {bars.map((bar) => (
        <g key={bar.rank} className={`farm-bars__bar farm-bars__bar--${bar.confidence}`}>
          <rect x={bar.x} y={bar.y} width={bar.width} height={Math.max(bar.height, 1)} rx="3" />
          <rect className="farm-line__hit" x={bar.x - 4} y={PAD_Y} width={bar.width + 8} height={HEIGHT - PAD_Y * 2}>
            <title>{`Rank ${bar.rank}: ${formatRate(bar.rate)} (${formatCount(bar.drops)} of ${formatCount(bar.observations)}) · ${confidenceLabel(bar.confidence)} confidence`}</title>
          </rect>
          <text className="farm-line__label" x={bar.center} y={HEIGHT + 12}>{bar.rank}</text>
        </g>
      ))}
    </svg>
  )
}
