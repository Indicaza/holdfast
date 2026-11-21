import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

// Opens an item from its slot and returns its details.
function inspect(itemKey) {
  fireEvent.click(document.querySelector(`button.gw-slot[data-item="${itemKey}"]`))
  return document.querySelector(`.gw-itempop[data-item="${itemKey}"]`)
}

describe('the loot grid', () => {
  test('Witherfang: rates side by side, Forever items, quest item, unknown quality, credit', () => {
    const rows = bossLoot(WITHERFANG, {})
    expect(rows.map((row) => row.item.itemId)).toEqual([271201, 275443, 5191, 286978])
    render(<LootList rows={rows} wishes={new Map()} character={null} onToggle={() => {}} />)
    // Slots only until one is opened: no metadata under every item.
    expect(document.querySelectorAll('button.gw-slot')).toHaveLength(4)
    expect(document.querySelector('.gw-atlas-loot__rates')).toBeNull()
    // Quality not known: no quality colour is claimed.
    expect(document.querySelector('button.gw-slot[data-item="i:271201"]').className).toContain('gw-slot--qx')
    const girdle = inspect('i:271201')
    const rates = girdle.querySelector('.gw-atlas-loot__rates')
    expect(rates.textContent).toBe('Reference: 23.5% · ForeverDB, 17 kills · Guildweaver (preliminary): 16.7% (12 of 72 kills, 9.8%–26.9%)')
    expect(rates.querySelector('[title]').getAttribute('title')).toMatch(/not been verified in game/)
    expect(within(girdle).getByText('WoW Forever item')).toBeTruthy()
    expect(girdle.textContent).toContain('Quality not known')
    expect(inspect('i:275443').textContent).toContain('Quest item')
    const barb = inspect('i:5191')
    expect(within(barb).getByText('Classic reference')).toBeTruthy()
    expect(barb.textContent).toContain('20% · ForeverDB, Classic data')
    expect(barb.textContent).toContain('not seen in 72 kills')
    expect(within(inspect('i:286978')).getByText('WoW Forever (ForeverDB)')).toBeTruthy()
    const credit = screen.getByRole('link', { name: 'Data from ForeverDB.net' })
    expect(credit.getAttribute('href')).toBe('https://foreverdb.net')
  })

  test('no rates and no ForeverDB data: no rate line, no credit, the old note', () => {
    const rows = bossLoot({ name: 'Rhahk\'Zor', referenceLoot: [{ itemId: 872, itemKey: 'i:872', name: 'Rockslicer', qualityId: 3, kind: 'gear',
      factSources: ['wago-classic-era'], observed: false, verifiedForForever: false }] }, {})
    render(<LootList rows={rows} wishes={new Map()} character={null} onToggle={() => {}} />)
    const rockslicer = inspect('i:872')
    expect(rockslicer.querySelector('.gw-atlas-loot__rates')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Data from ForeverDB.net' })).toBeNull()
    expect(rockslicer.textContent).toContain('Drop chances are not published')
  })

  test('tooltips: captured lines when the game gave them, reference facts marked as such, the pending note only when nothing is known', () => {
    const captured = { itemKey: 'i:5191', itemId: 5191, name: 'Cruel Barb', qualityId: 3, slot: 'One-Hand',
      tooltip: { lines: [{ left: 'Cruel Barb' }, { left: 'Binds when picked up' }, { left: 'Requires Level 19' }] }, sellPrice: 3412 }
    const reference = { itemKey: 'i:5202', itemId: 5202, name: 'Corsair\'s Overshirt', qualityId: 3, slot: 'Chest', itemSubclass: 'Cloth', armor: 42, itemLevel: 24, requiredLevel: 19, bindType: 'BoP',
      stats: [{ stat: 'Agility', value: 6 }], factSources: ['wago-classic-era'] }
    const bare = { itemKey: 'i:9', itemId: 9, name: 'Mystery Ring', qualityId: null }
    const rows = [
      { item: captured, source: 'Edwin VanCleef', sourceKey: 'boss:2747', sourceKind: 'boss', observed: true },
      { item: reference, source: 'Edwin VanCleef', sourceKey: 'boss:2747', sourceKind: 'boss', reference: true },
      { item: bare, source: null, sourceKey: 'unknown', sourceKind: 'unknown', observed: true },
    ]
    render(<LootList rows={rows} wishes={new Map([['i:5191', { itemKey: 'i:5191', state: 'wanted', priority: 'high' }]])} character={null} onToggle={() => {}} />)
    const wrapper = (key) => document.querySelector(`button.gw-slot[data-item="${key}"]`).parentElement
    // Reference facts in the tooltip's frame, labelled; the journal's lines below.
    fireEvent.pointerEnter(wrapper('i:5202'), { pointerType: 'mouse' })
    let tooltip = screen.getByRole('tooltip')
    expect(tooltip.textContent).toContain('Binds when picked up')
    expect(tooltip.textContent).toContain('42 Armor')
    expect(tooltip.textContent).toContain('+6 Agility')
    expect(tooltip.textContent).toContain('Requires Level 19')
    expect(tooltip.textContent).toContain('Classic reference facts, not the game\'s tooltip.')
    expect(tooltip.textContent).not.toContain('Full tooltip arrives')
    expect(tooltip.textContent).toContain('Drops from Edwin VanCleef')
    expect(tooltip.querySelectorAll('.game-tooltip__reference').length).toBeGreaterThan(3)
    // Moving within the slot does not remount it.
    fireEvent.pointerMove(document.querySelector('button.gw-slot[data-item="i:5202"]'), { pointerType: 'mouse' })
    expect(screen.getByRole('tooltip')).toBe(tooltip)
    fireEvent.pointerLeave(wrapper('i:5202'))
    expect(screen.queryByRole('tooltip')).toBeNull()
    // Captured lines stay the game's own, with the wishlist state under them.
    fireEvent.pointerEnter(wrapper('i:5191'), { pointerType: 'mouse' })
    tooltip = screen.getByRole('tooltip')
    expect(tooltip.textContent).toContain('Requires Level 19')
    expect(tooltip.querySelector('.game-tooltip__reference')).toBeNull()
    expect(tooltip.textContent).toContain('On your wishlist (high)')
    fireEvent.pointerLeave(wrapper('i:5191'))
    // Nothing known: the pending note, and the quality is said to be unknown.
    fireEvent.pointerEnter(wrapper('i:9'), { pointerType: 'mouse' })
    tooltip = screen.getByRole('tooltip')
    expect(tooltip.textContent).toContain('Full tooltip arrives once a Guildweaver player sees this item in game.')
    expect(tooltip.textContent).toContain('Quality not known yet')
    expect(tooltip.textContent).toContain('Source not identified')
    fireEvent.pointerLeave(wrapper('i:9'))
    // A tap does not open the floating tooltip: the slot opens the item instead.
    fireEvent.pointerEnter(wrapper('i:5191'), { pointerType: 'touch' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    // The opened item floats over the page, outside the grid.
    const shirt = inspect('i:5202')
    expect(shirt.closest('.gw-lootgrid')).toBeNull()
    expect(shirt.querySelector('.game-tooltip--card').textContent).toContain('Classic reference facts')
    // While it is open, its slot shows no floating tooltip over it.
    fireEvent.pointerEnter(wrapper('i:5202'), { pointerType: 'mouse' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  test('slots open and close from the keyboard; Escape returns focus to the slot', () => {
    const rows = bossLoot({ name: 'Rhahk\'Zor', referenceLoot: [{ itemId: 872, itemKey: 'i:872', name: 'Rockslicer', qualityId: 2 }, { itemId: 873, itemKey: 'i:873', name: 'Other', qualityId: 1 }] }, {})
    render(<LootList rows={rows} wishes={new Map([['i:873', { itemKey: 'i:873', state: 'acquired', acquiredBasis: 'owned' }]])} character={null} onToggle={() => {}} label="Rhahk'Zor loot" />)
    const grid = screen.getByRole('list', { name: 'Rhahk\'Zor loot' })
    const slot = within(grid).getByRole('button', { name: 'Rockslicer' })
    expect(within(grid).getByRole('button', { name: 'Other, acquired' })).toBeTruthy()
    expect(slot.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(slot)
    expect(slot.getAttribute('aria-expanded')).toBe('true')
    const panel = screen.getByRole('dialog', { name: 'Rockslicer details' })
    expect(document.activeElement).toBe(panel)
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Rockslicer details' })).toBeNull()
    expect(document.activeElement).toBe(slot)
    // A press outside closes it too; pressing the slot again toggles it.
    fireEvent.click(slot)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog', { name: 'Rockslicer details' })).toBeNull()
    fireEvent.click(slot)
    fireEvent.click(slot)
    expect(screen.queryByRole('dialog', { name: 'Rockslicer details' })).toBeNull()
  })

  test('one item, two sources: each source keeps its own rate and evidence', () => {
    const item = { itemKey: 'i:5191', itemId: 5191, name: 'Cruel Barb', qualityId: 3 }
    const boss = [{ item: { ...item, referenceRates: [rate(22.2, 27)] }, source: 'Edwin VanCleef', sourceKey: 'boss:2747', sourceKind: 'boss', observed: false, reference: true,
      alsoFrom: [{ key: 'trash:657', name: 'Defias Pirate', kind: 'trash' }] }]
    const trash = [{ item: { ...item, sightings: 1 }, source: 'Defias Pirate', sourceKey: 'trash:657', sourceKind: 'trash', observed: true, reference: false,
      observedRate: { drops: 1, kills: 40, percent: 2.5, low: 0.1, high: 13.2, preliminary: true }, alsoFrom: [{ key: 'boss:2747', name: 'Edwin VanCleef', kind: 'boss', bossKey: '2747' }] }]
    render(<><LootList rows={boss} wishes={new Map()} character={null} onToggle={() => {}} label="boss" /><LootList rows={trash} wishes={new Map()} character={null} onToggle={() => {}} label="trash" /></>)
    fireEvent.click(within(screen.getByRole('list', { name: 'boss' })).getByRole('button'))
    const fromBoss = screen.getByRole('dialog', { name: 'Cruel Barb details' })
    expect(fromBoss.textContent).toContain('From Edwin VanCleef')
    expect(fromBoss.textContent).toContain('Reference: 22.2% · ForeverDB, 27 kills')
    expect(fromBoss.textContent).not.toContain('2.5%')
    // Seen elsewhere is not seen from the boss.
    expect(within(fromBoss).getByText('Classic reference')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    fireEvent.click(within(screen.getByRole('list', { name: 'trash' })).getByRole('button'))
    const fromTrash = screen.getByRole('dialog', { name: 'Cruel Barb details' })
    expect(fromTrash.textContent).toContain('From Defias Pirate')
    expect(fromTrash.textContent).toContain('2.5% (1 of 40 kills')
    expect(fromTrash.textContent).not.toContain('22.2%')
    expect(fromTrash.textContent).toContain('Also from Edwin VanCleef (boss)')
  })
})

