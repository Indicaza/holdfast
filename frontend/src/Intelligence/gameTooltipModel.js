// Pure tooltip helpers, kept out of the JSX so they can be unit tested.

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

// Farming results carry the canonical client description under `item`, while
// Armory and inventory items are already flat. Normalize identity only; the
// tooltip itself remains untouched client data.
export function gameTooltipItem(value) {
  if (!value || typeof value !== 'object') return null
  const outer = object(value)
  const described = object(outer.item)
  const catalog = object(outer.catalog)
  const metadata = object(catalog.metadata)
  const merged = { ...metadata, ...outer, ...described }

  return {
    ...merged,
    itemId: described.itemId ?? outer.itemId ?? metadata.itemId ?? null,
    itemLink: described.itemLink || outer.itemLink || metadata.itemLink || '',
    name: described.name || outer.name || metadata.name || '',
    qualityId: described.qualityId ?? described.quality ?? outer.qualityId ?? outer.quality ?? metadata.qualityId ?? metadata.quality ?? null,
    sellPrice: described.sellPrice ?? outer.sellPrice ?? metadata.sellPrice ?? null,
    tooltip: Object.keys(object(described.tooltip)).length
      ? described.tooltip
      : Object.keys(object(outer.tooltip)).length
        ? outer.tooltip
        : object(metadata.tooltip),
    tooltipLines: Array.isArray(described.tooltipLines)
      ? described.tooltipLines
      : Array.isArray(outer.tooltipLines)
        ? outer.tooltipLines
        : Array.isArray(metadata.tooltipLines)
          ? metadata.tooltipLines
          : [],
  }
}

export function capturedLines(item) {
  const source = Array.isArray(item?.tooltip?.lines)
    ? item.tooltip.lines
    : Array.isArray(item?.tooltipLines)
      ? item.tooltipLines
      : []

  return source.map((line) => {
    const entry = object(line)
    return {
      ...entry,
      left: entry.left ?? entry.leftText ?? entry.text ?? '',
      right: entry.right ?? entry.rightText ?? '',
      leftColor: entry.leftColor ?? entry.color,
    }
  }).filter((line) => line.blank || line.sellPrice || line.left || line.right)
}

export function isItem(item) {
  return Number(item?.itemId) > 0 || /(?:^|\|H)item:\d+/i.test(String(item?.itemLink || ''))
}

// A real item waits for Guildweaver only while it has no captured lines at
// all. Captured lines are shown whatever their source: a rendered GameTooltip
// when there is one, otherwise C_TooltipInfo (the backend prefers the render).
export function itemTooltipPending(value) {
  const item = gameTooltipItem(value) || {}
  return isItem(item) && capturedLines(item).length === 0
}
