import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

import { LootList } from '../AtlasLoot.jsx'
import { bossLoot, observedLootOf, observedRateOf, observedRateText, referenceRateText } from '../atlasModel.js'

// Loot intelligence, PR 4: reference and Guildweaver drop rates side by side,
// each with its count; Forever items and ForeverDB's own drops labelled as
// such, with ForeverDB's credit; unknown facts said, not filled in.

const rate = (percent, kills, method = 'observed') => ({ source: 'foreverdb', method, percent, kills, seen: null, revision: '2026-11-20 (client 1.60.1.70959)' })

const WITHERFANG = {
  name: 'Witherfang', npcId: 250483,
  referenceLoot: [
    { itemId: 271201, itemKey: 'i:271201', name: 'Atrophic Girdle', qualityId: null, slot: 'Waist', itemClass: 'Armor', itemSubclass: 'Mail', kind: 'gear',
      factSources: ['wago-forever', 'foreverdb'], foreverClient: 'hidden', observed: false, verifiedForForever: false, referenceRates: [rate(23.53, 17)] },
    { itemId: 275443, itemKey: 'i:275443', name: 'Highly Toxic Strain', qualityId: 1, kind: 'quest-item', factSources: ['wago-forever'], observed: false, verifiedForForever: false },
    { itemId: 5191, itemKey: 'i:5191', name: 'Cruel Barb', qualityId: 3, slot: 'One-Hand', kind: 'gear', factSources: ['wago-forever', 'foreverdb', 'wago-classic-era'],
      observed: false, verifiedForForever: false, referenceRates: [rate(20, null, 'classic')] },
  ],
  foreverLoot: [{ itemId: 286978, itemKey: 'i:286978', name: 'Lordaeron Relic', qualityId: 2, kind: 'gear', source: 'foreverdb', attribution: 'Data from ForeverDB.net',
    factSources: ['wago-forever', 'foreverdb'], observed: false, verifiedForForever: false, referenceRates: [rate(11.76, 17)] }],
  observedLoot: { status: 'preliminary', reason: 'Loot-window coverage on WoW Forever has not been verified in game yet; these rates may change.', build: '70959', eligibleKills: 72, noDropUpper: 5.1, items: [{ itemId: 271201, drops: 12, sightings: 1, percent: 16.7, low: 9.8, high: 26.9 }] },
}

afterEach(() => cleanup())

describe('rate texts', () => {
  test('reference: source, method and kills; Classic data says so', () => {
    expect(referenceRateText(rate(18.4, 72))).toBe('18.4% · ForeverDB, 72 kills')
    expect(referenceRateText(rate(20, null, 'classic'))).toBe('20% · ForeverDB, Classic data')
    expect(referenceRateText({ ...rate(null, 5) })).toBeNull()
  })

  test('observed: never a percentage without its count', () => {
    const observed = observedLootOf(WITHERFANG)
    expect(observedRateText(observedRateOf(observed, 271201))).toBe('16.7% (12 of 72 kills, 9.8%–26.9%)')
    expect(observedRateText(observedRateOf(observed, 5191))).toBe('not seen in 72 kills (under 5.1%)')
    expect(observedRateText(observedRateOf({ eligibleKills: 0, noDropUpper: null, items: new Map([[5, { itemId: 5, drops: 0, sightings: 2 }]]) }, 5)))
      .toBe('seen 2×, no full loot count yet')
    expect(observedRateOf(null, 5)).toBeNull()
    expect(observedRateOf(observedLootOf({}), 5)).toBeNull()
  })
})

describe('the loot list', () => {
  test('Witherfang: rates side by side, Forever items, quest item, unknown quality, credit', () => {
    const rows = bossLoot(WITHERFANG, {})
    expect(rows.map((row) => row.item.itemId)).toEqual([271201, 275443, 5191, 286978])
    render(<LootList rows={rows} wishes={new Map()} character={null} onToggle={() => {}} />)
    const girdle = document.querySelector('[data-item="i:271201"]')
    const rates = girdle.querySelector('.gw-atlas-loot__rates')
    expect(rates.textContent).toBe('Reference: 23.5% · ForeverDB, 17 kills · Guildweaver (preliminary): 16.7% (12 of 72 kills, 9.8%–26.9%)')
    expect(rates.querySelector('[title]').getAttribute('title')).toMatch(/not been verified in game/)
    expect(within(girdle).getByText('WoW Forever item')).toBeTruthy()
    expect(girdle.textContent).toContain('quality unknown')
    const strain = document.querySelector('[data-item="i:275443"]')
    expect(strain.textContent).toContain('Quest item')
    const barb = document.querySelector('[data-item="i:5191"]')
    expect(within(barb).getByText('Classic reference')).toBeTruthy()
    expect(barb.textContent).toContain('20% · ForeverDB, Classic data')
    expect(barb.textContent).toContain('not seen in 72 kills')
    const relic = document.querySelector('[data-item="i:286978"]')
    expect(within(relic).getByText('WoW Forever (ForeverDB)')).toBeTruthy()
    const credit = screen.getByRole('link', { name: 'Data from ForeverDB.net' })
    expect(credit.getAttribute('href')).toBe('https://foreverdb.net')
  })

  test('no rates and no ForeverDB data: no rate line, no credit, the old note', () => {
    const rows = bossLoot({ name: 'Rhahk\'Zor', referenceLoot: [{ itemId: 872, itemKey: 'i:872', name: 'Rockslicer', qualityId: 3, kind: 'gear',
      factSources: ['wago-classic-era'], observed: false, verifiedForForever: false }] }, {})
    render(<LootList rows={rows} wishes={new Map()} character={null} onToggle={() => {}} />)
    expect(document.querySelector('.gw-atlas-loot__rates')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Data from ForeverDB.net' })).toBeNull()
    expect(document.body.textContent).toContain('Drop chances are not published')
  })
})
