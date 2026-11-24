import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

import { GameTooltipBody } from '../GameTooltip.jsx'

const axe = {
  itemId: 990123, name: "Durgen's Crescent Axe", qualityId: 3, sellPrice: 1186,
  tooltip: {
    source: 'game', lines: [
      { left: "Durgen's Crescent Axe", leftColor: { r: 0, g: 0.44, b: 1 } },
      { left: 'Main Hand', right: 'Axe' },
      { left: '20 - 39 Damage', right: 'Speed 2.40' },
      { left: 'Durability 65 / 65' },
      { sellPrice: true },
    ],
  },
}

describe('client-observed item tooltip', () => {
  test('uses the captured rarity, two-column weapon facts, durability, and the real vendor price', () => {
    const html = renderToStaticMarkup(<GameTooltipBody item={axe} />)
    expect(html).toContain('item-quality-3')
    expect(html).toContain('color:rgb(0, 112, 255)')
    expect(html).toContain('20 - 39 Damage')
    expect(html).toContain('Speed 2.40')
    expect(html).toContain('Durability 65 / 65')
    expect(html).toContain('coin-silver.webp')
    expect(html).toContain('coin-copper.webp')
    expect(html.match(/Sell Price:/g)).toHaveLength(1)
  })

  test('appends the vendor price when the client omitted its placeholder row', () => {
    const withoutMarker = { ...axe, tooltip: { lines: axe.tooltip.lines.filter((line) => !line.sellPrice) } }
    const html = renderToStaticMarkup(<GameTooltipBody item={withoutMarker} />)
    expect(html.match(/Sell Price:/g)).toHaveLength(1)
  })
})
