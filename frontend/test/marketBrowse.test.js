import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BROWSE_COLUMNS,
  INSPECTOR_SIZE,
  MAX_INSPECTORS,
  cascadePosition,
  clampWindow,
  closeInspector,
  inspectorId,
  nextSort,
  openInspector,
  raiseInspector,
  readColumns,
  readInspectors,
  readOpenCategories,
  resetInspectors,
  rowId,
  stackOrder,
  storeColumns,
  storeInspectors,
  storeOpenCategories,
  updateInspector,
  visibleColumns,
} from '../src/Market/marketBrowse.js'

const screen = { width: 1440, height: 900 }

function memoryStorage() {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) }
}

test('the table shows the game\'s three columns; the rest are optional and remembered', () => {
  assert.deepEqual(visibleColumns().map((column) => column.label), ['Price', 'Name', 'Available'])
  assert.deepEqual(BROWSE_COLUMNS.filter((column) => column.optional).map((column) => column.id), ['level', 'ilvl', 'listings', 'age', 'pct', 'confidence'])
  const storage = memoryStorage()
  storeColumns(['pct', 'nonsense', 'level'], storage)
  assert.deepEqual(readColumns(storage), ['pct', 'level'])
  assert.deepEqual(visibleColumns(readColumns(storage)).map((column) => column.id), ['price', 'name', 'quantity', 'level', 'pct'])
  assert.deepEqual(readColumns({ getItem: () => '{bad' }), [])
})

test('sorting: a new column starts the natural way, the same column flips', () => {
  const price = BROWSE_COLUMNS.find((column) => column.id === 'price')
  const available = BROWSE_COLUMNS.find((column) => column.id === 'quantity')
  assert.deepEqual(nextSort({ sort: '', dir: 'asc' }, price), { sort: 'price', dir: 'asc' }, 'cheapest first')
  assert.deepEqual(nextSort({ sort: 'price', dir: 'asc' }, price), { sort: 'price', dir: 'desc' })
  assert.deepEqual(nextSort({ sort: 'price', dir: 'desc' }, available), { sort: 'quantity', dir: 'desc' }, 'most available first')
})

test('rows: one per listed variant, one per catalog match', () => {
  assert.equal(rowId({ itemKey: 'i:15210:s-1081', item: { itemId: 15210 } }), 'i:15210:s-1081')
  assert.equal(rowId({ itemKey: null, item: { itemId: 4319 } }), 'c:4319')
  assert.equal(inspectorId({ itemId: 4319 }), 'i:4319')
  assert.equal(inspectorId({ itemId: 15210, itemKey: 'i:15210:s-1081' }), 'i:15210:s-1081', 'each variant has its own window')
})

test('opening an item already open focuses it instead of opening a copy', () => {
  let { windows } = openInspector([], { itemId: 4319, name: 'Azure Silk Gloves' }, screen)
  ;({ windows } = openInspector(windows, { itemId: 4306, name: 'Silk Cloth' }, screen))
  assert.equal(windows.length, 2)
  assert.notDeepEqual([windows[0].x, windows[0].y], [windows[1].x, windows[1].y], 'cascaded, not stacked exactly')
  const collapsed = updateInspector(windows, 'i:4319', { collapsed: true }, screen)
  const again = openInspector(collapsed, { itemId: 4319 }, screen)
  assert.equal(again.existed, true)
  assert.equal(again.windows.length, 2, 'no duplicate')
  const gloves = again.windows.find((win) => win.id === 'i:4319')
  assert.equal(gloves.collapsed, false, 'expanded again')
  assert.equal(stackOrder(again.windows).at(-1), 'i:4319', 'and on top')
})

test('clicking a window raises it; pinned windows stay above; closing one keeps the others', () => {
  let windows = []
  for (const itemId of [1, 2, 3]) windows = openInspector(windows, { itemId }, screen).windows
  assert.deepEqual(stackOrder(windows), ['i:1', 'i:2', 'i:3'])
  windows = raiseInspector(windows, 'i:1')
  assert.deepEqual(stackOrder(windows), ['i:2', 'i:3', 'i:1'])
  assert.equal(raiseInspector(windows, 'i:1'), windows, 'raising the top window changes nothing')
  windows = updateInspector(windows, 'i:2', { pinned: true }, screen)
  windows = raiseInspector(windows, 'i:3')
  assert.equal(stackOrder(windows).at(-1), 'i:2', 'pinned stays above')
  windows = closeInspector(windows, 'i:3')
  assert.deepEqual(windows.map((win) => win.id).sort(), ['i:1', 'i:2'])
})

test('windows stay inside the viewport, at a usable size, on any screen', () => {
  const dragged = clampWindow({ x: -500, y: 5000, width: 400, height: 540 }, screen)
  assert.deepEqual([dragged.x, dragged.y], [INSPECTOR_SIZE.margin, screen.height - 540 - INSPECTOR_SIZE.margin])
  const huge = clampWindow({ x: 0, y: 0, width: 9000, height: 9000 }, screen)
  assert.equal(huge.width, screen.width - 2 * INSPECTOR_SIZE.margin)
  assert.equal(huge.height, screen.height - 2 * INSPECTOR_SIZE.margin)
  const tiny = clampWindow({ x: 100, y: 100, width: 10, height: 10 }, screen)
  assert.deepEqual([tiny.width, tiny.height], [INSPECTOR_SIZE.minWidth, INSPECTOR_SIZE.minHeight])
  const phone = { width: 375, height: 700 }
  const small = cascadePosition(0, phone)
  assert.ok(small.x >= INSPECTOR_SIZE.margin && small.x + small.width <= phone.width - INSPECTOR_SIZE.margin + 1, 'fits a phone')
  const collapsed = clampWindow({ x: 10, y: 880, width: 400, height: 540, collapsed: true }, screen)
  assert.equal(collapsed.y, screen.height - INSPECTOR_SIZE.title - INSPECTOR_SIZE.margin, 'a collapsed window only needs its title bar on screen')
})

test('reset puts every window back in a neat stack; too many windows drop the oldest unpinned', () => {
  let windows = []
  for (let itemId = 1; itemId <= 3; itemId += 1) windows = openInspector(windows, { itemId }, screen).windows
  windows = updateInspector(windows, 'i:1', { x: 3, y: 700, width: 300, collapsed: true }, screen)
  const reset = resetInspectors(windows, screen)
  assert.deepEqual(reset.map((win) => [win.x, win.y, win.width, win.collapsed]), [0, 1, 2].map((index) => {
    const spot = cascadePosition(index, screen)
    return [spot.x, spot.y, spot.width, false]
  }))
  windows = updateInspector(windows, 'i:1', { pinned: true }, screen)
  for (let itemId = 10; itemId < 10 + MAX_INSPECTORS; itemId += 1) windows = openInspector(windows, { itemId }, screen).windows
  assert.equal(windows.length, MAX_INSPECTORS)
  assert.ok(windows.some((win) => win.id === 'i:1'), 'pinned windows are never dropped')
  assert.ok(!windows.some((win) => win.id === 'i:2'), 'the oldest unpinned one gave way')
})

test('open windows and category branches are remembered for the browser session, safely', () => {
  const storage = memoryStorage()
  const { windows } = openInspector([], { itemId: 4319, name: 'Azure Silk Gloves', qualityId: 2 }, screen)
  storeInspectors(updateInspector(windows, 'i:4319', { x: 200, y: 150, pinned: true, tab: 'history' }, screen), storage)
  const restored = readInspectors(screen, storage)
  assert.deepEqual([restored[0].id, restored[0].x, restored[0].y, restored[0].pinned, restored[0].tab, restored[0].name], ['i:4319', 200, 150, true, 'history', 'Azure Silk Gloves'])
  assert.equal(readInspectors({ width: 600, height: 500 }, storage)[0].x <= 600 - INSPECTOR_SIZE.minWidth, true, 'clamped into a smaller window')
  storage.setItem('guildweaver:auctions:inspectors', JSON.stringify([{ id: 'x', itemId: -1 }, { itemId: 5 }, 'junk']))
  assert.deepEqual(readInspectors(screen, storage), [], 'malformed entries are dropped')
  storeOpenCategories(new Set(['trade-goods', 'armor']), storage)
  assert.deepEqual(readOpenCategories(storage), ['trade-goods', 'armor'])
})

test('the auction houses offered follow the chosen server', async () => {
  const { marketChoices, marketServer } = await import('../src/Market/marketBrowse.js')
  const { resolveMarket } = await import('../src/Market/marketFormat.js')
  const markets = [
    { marketKey: 'game:us:normal:horde', kind: 'client_house', region: 'us', realm: 'Normal', faction: 'horde', items: 5, lastCheckedAt: 10 },
    { marketKey: 'game:us:normal:alliance', kind: 'client_house', region: 'us', realm: 'Normal', faction: 'alliance', items: 40, lastCheckedAt: 20, linkedMarketKey: 'api:us:house-113' },
    { marketKey: 'game:us:hardcore:alliance', kind: 'client_house', region: 'us', realm: 'Hardcore', faction: 'alliance', items: 9, lastCheckedAt: 30 },
    { marketKey: 'api:us:house-113', kind: 'api_house', region: 'us', name: 'US Alliance (113)', faction: 'alliance', items: 900, lastCheckedAt: 40 },
    { marketKey: 'api:us:house-116', kind: 'api_house', region: 'us', name: 'US Horde (116)', faction: 'horde', items: 800, lastCheckedAt: 40 },
  ]
  assert.equal(marketServer(markets[0]), 'us:normal')
  const normal = marketChoices(markets, 'us:normal')
  assert.deepEqual(normal.groups.map((group) => group.label), ['Normal', 'Blizzard auction houses'])
  assert.deepEqual(normal.groups[0].markets.map((market) => market.label), ['Normal · Alliance · 40 listed', 'Normal · Horde · 5 listed'], 'Alliance, Horde, Blackwater order')
  assert.deepEqual(normal.keys, ['game:us:normal:alliance', 'game:us:normal:horde', 'api:us:house-113', 'api:us:house-116'], 'houses linked elsewhere stay out')
  assert.equal(normal.otherServers, false)
  assert.ok(!marketChoices(markets, 'us:hardcore').keys.includes('api:us:house-113'), 'a house linked to another server is not offered')
  assert.equal(marketChoices(markets, 'us:nowhere').otherServers, true, 'no data from the server: everything, said so')
  assert.equal(marketChoices(markets, '').keys.length, 5)
  // The house shown: the link's, else the remembered one on this server, else this server's freshest.
  assert.equal(resolveMarket(markets, 'game:us:hardcore:alliance', '', normal.keys), 'game:us:hardcore:alliance')
  assert.equal(resolveMarket(markets, '', 'game:us:hardcore:alliance', normal.keys), 'game:us:normal:alliance', 'a house remembered from another server is not used: this server houses come first')
  assert.equal(resolveMarket(markets, '', 'game:us:normal:horde', normal.keys), 'game:us:normal:horde')
})

test('a link to an item\'s history opens its window on History', () => {
  const { windows } = openInspector([], { itemId: 2589, tab: 'history' }, screen)
  assert.equal(windows[0].tab, 'history')
  assert.equal(openInspector(windows, { itemId: 2589, tab: 'overview' }, screen).windows[0].tab, 'overview')
})
