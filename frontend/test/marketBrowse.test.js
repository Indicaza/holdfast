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
