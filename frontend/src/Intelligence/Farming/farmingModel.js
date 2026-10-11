// Farming intelligence: formatting and chart geometry for the source browser
// and source modal. Pure, so it is tested without a browser.

export const CONFIDENCE_LABELS = Object.freeze({
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  very_high: 'Very High',
})

const DISCIPLINE_LABELS = Object.freeze({
  herbalism: 'Herbalism',
  mining: 'Mining',
  skinning: 'Skinning',
  fishing: 'Fishing',
  loot: 'Loot',
  disenchanting: 'Disenchanting',
  crafting: 'Crafting',
})

const SOURCE_KIND_LABELS = Object.freeze({
  'herb-node': 'Herb',
  'ore-vein': 'Vein',
  creature: 'Creature',
  'fishing-pool': 'Pool',
})

// Categorical slots for the output donut (dark surface). The table beside it
// carries identity too, so colour is never the only key.
export const OUTPUT_COLORS = Object.freeze(['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'])
export const OTHER_COLOR = '#6b7280'

const number = new Intl.NumberFormat('en-US')

export function formatCount(value) {
  return number.format(Math.round(Number(value) || 0))
}

export function titleCase(value) {
  return String(value || '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

export function disciplineLabel(discipline) {
  return DISCIPLINE_LABELS[discipline] || titleCase(discipline) || 'Unknown'
}

export function sourceKindLabel(kind) {
  return SOURCE_KIND_LABELS[kind] || titleCase(kind)
}

// 100%, 2.80%, 0.50%, 0.012%: enough digits that a rare drop never rounds to
// zero, never so many that a common one looks more precise than it is.
export function formatRate(rate) {
  const value = Number(rate)
  if (!Number.isFinite(value) || value <= 0) return '0%'
  const percent = value * 100
  if (percent >= 99.995) return '100%'
  if (percent >= 10) return `${percent.toFixed(1)}%`
  if (percent >= 0.1) return `${percent.toFixed(2)}%`
  return `${percent.toPrecision(2)}%`
}

export function formatQuantity(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '—'
}

export function confidenceLabel(confidence) {
  return CONFIDENCE_LABELS[confidence] || CONFIDENCE_LABELS.low
}

// "95% of the time the true rate is between 2.2% and 2.8%."
export function rateRangeText(entry) {
  if (!entry || !entry.observations) return 'No observations'
  return `${formatCount(entry.successes ?? entry.drops)} of ${formatCount(entry.observations)} · likely ${formatRate(entry.low)}–${formatRate(entry.high)}`
}

export function rankLabel(rank) {
  return rank === 'unknown' || rank === null || rank === undefined ? 'Unknown' : `Rank ${rank}`
}

// --- Filters ---------------------------------------------------------------

export const EMPTY_FILTERS = Object.freeze({
  zone: '',
  build: '',
  rank: '',
  skillMin: '',
  skillMax: '',
  levelMin: '',
  levelMax: '',
})

export function activeFilterCount(filters = {}) {
  return Object.keys(EMPTY_FILTERS).filter((key) => String(filters[key] ?? '').trim() !== '').length
}

export function sourceDetailUrl(sourceKey, { filters = {}, item = '' } = {}) {
  const params = new URLSearchParams()
  for (const key of Object.keys(EMPTY_FILTERS)) {
    const value = String(filters[key] ?? '').trim()
    if (value) params.set(key, value)
  }
  if (item) params.set('item', item)
  const query = params.toString()
  return `/api/intelligence/farming/sources/${encodeURIComponent(sourceKey)}${query ? `?${query}` : ''}`
}

export function sourcesUrl({ query = '', discipline = '' } = {}) {
  const params = new URLSearchParams()
  if (query.trim()) params.set('q', query.trim())
  if (discipline) params.set('discipline', discipline)
  const search = params.toString()
  return `/api/intelligence/farming/sources${search ? `?${search}` : ''}`
}

// --- Donut -----------------------------------------------------------------

// Output share by quantity. The top outputs keep their own slot; the rest
// fold into "Other" so the chart never needs a sixth colour. Rare drops can
// be too thin to see, which is why the drop table stays authoritative.
export function donutSegments(outputs = [], maxSegments = OUTPUT_COLORS.length) {
  const total = outputs.reduce((sum, output) => sum + (Number(output.quantity) || 0), 0)
  if (!total) return []
  const sorted = [...outputs].sort((a, b) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0))
  const named = sorted.length > maxSegments ? sorted.slice(0, maxSegments - 1) : sorted
  const rest = sorted.slice(named.length)
  const segments = named.map((output, index) => ({
    key: output.itemKey,
    name: output.name,
    quantity: Number(output.quantity) || 0,
    color: OUTPUT_COLORS[index],
  }))
  if (rest.length) {
    segments.push({
      key: 'other',
      name: `${rest.length} other${rest.length === 1 ? '' : 's'}`,
      quantity: rest.reduce((sum, output) => sum + (Number(output.quantity) || 0), 0),
      color: OTHER_COLOR,
    })
  }
  let start = 0
  return segments.map((segment) => {
    const share = segment.quantity / total
    const arc = { ...segment, share, start, end: start + share }
    start += share
    return arc
  })
}

export function arcPath(start, end, { radius = 44, inner = 30, center = 50 } = {}) {
  // A full circle cannot be one arc; stop just short of it.
  const sweep = Math.min(end - start, 0.9999)
  const point = (fraction, r) => {
    const angle = fraction * Math.PI * 2 - Math.PI / 2
    return [center + r * Math.cos(angle), center + r * Math.sin(angle)].map((value) => Number(value.toFixed(3)))
  }
  const large = sweep > 0.5 ? 1 : 0
  const [x1, y1] = point(start, radius)
  const [x2, y2] = point(start + sweep, radius)
  const [x3, y3] = point(start + sweep, inner)
  const [x4, y4] = point(start, inner)
  return `M${x1} ${y1}A${radius} ${radius} 0 ${large} 1 ${x2} ${y2}L${x3} ${y3}A${inner} ${inner} 0 ${large} 0 ${x4} ${y4}Z`
}

// --- Rate line ---------------------------------------------------------------

// Points for the drop-rate-by-skill chart. Buckets without a skill reading
// stay in the table but are not plotted.
export function rateLinePoints(rows = [], { width = 320, height = 120, padX = 16, padY = 14 } = {}) {
  const plotted = rows.filter((row) => row.bucket !== 'unknown' && row.observations > 0)
  if (!plotted.length) return { points: [], maxRate: 0 }
  const maxRate = Math.max(...plotted.map((row) => Number(row.high) || Number(row.rate) || 0), 0.0001)
  const step = plotted.length > 1 ? (width - padX * 2) / (plotted.length - 1) : 0
  const y = (rate) => Number((height - padY - (rate / maxRate) * (height - padY * 2)).toFixed(2))
  return {
    maxRate,
    points: plotted.map((row, index) => ({
      ...row,
      x: Number((plotted.length > 1 ? padX + index * step : width / 2).toFixed(2)),
      y: y(Number(row.rate) || 0),
      yLow: y(Number(row.low) || 0),
      yHigh: y(Number(row.high) || 0),
    })),
  }
}
