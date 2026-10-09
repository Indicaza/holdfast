import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildTalentLayout } from '../src/Intelligence/talentLayout.js'

const catalog = JSON.parse(readFileSync(new URL('../src/Intelligence/talentCatalog.json', import.meta.url), 'utf8'))

function node(id, x, y, rank, maxRank, name = `Talent ${id}`) {
  return { id, x, y, rank, maxRank, entries: [{ id: id * 10, name, rank, maxRank, selected: rank > 0 }] }
}

test('catalog places captured nodes into the in-game tab, row, and column', () => {
  // 105958 is Arms "Improved Heroic Strike" (row 0, col 0); 105951 is Anger
  // Management (row 2, col 1). Captured coordinates are deliberately wrong.
  const layout = buildTalentLayout({
    nodes: [node(105958, 0, 0, 3, 3), node(105954, 50, 50, 5, 5), node(105951, 100, 100, 0, 1, 'Anger Management')],
    edges: [{ from: 105954, to: 105951 }],
  }, { className: 'Warrior', level: 20, catalog })

  assert.deepEqual(layout.panels.map((panel) => panel.name), ['Arms', 'Fury', 'Protection'])
  const [arms] = layout.panels
  assert.equal(arms.points, 8)
  assert.equal(arms.background, '/talent-art/161.jpg')
  const anger = arms.nodes.find((talent) => talent.node.id === 105951)
  assert.deepEqual([anger.row, anger.col, anger.state], [2, 1, 'locked'])
  assert.deepEqual(anger.requirements, ['Requires 10 points in Arms Talents'])
  assert.equal(arms.edges[0].active, true)
  assert.equal(layout.pointsTotal, 11)
  assert.equal(layout.pointsLeft, 3)
})

test('uncatalogued nodes cluster by X into class tabs and gate rows by points', () => {
  const layout = buildTalentLayout({
    nodes: [
      node(1, 1000, 2000, 2, 5), node(2, 1600, 2600, 0, 3),
      node(3, 5000, 2000, 0, 5),
      node(4, 9000, 2000, 0, 5), node(5, 9600, 2000, 0, 2),
    ],
    edges: [],
    pointsSpent: 2,
    pointsAvailable: 49,
  }, { className: 'Rogue', catalog })

  assert.deepEqual(layout.panels.map((panel) => panel.name), ['Assassination', 'Combat', 'Subtlety'])
  const locked = layout.panels[0].nodes.find((talent) => talent.node.id === 2)
  assert.deepEqual([locked.row, locked.col, locked.state], [1, 1, 'locked'])
  assert.deepEqual(locked.requirements, ['Requires 5 points in Assassination Talents'])
  assert.equal(layout.panels[2].nodes.find((talent) => talent.node.id === 5).col, 1)
  assert.equal(layout.pointsTotal, 51)
})

test('tooltips get current and next rank text by node ID or by name within the tab', () => {
  const layout = buildTalentLayout({
    nodes: [node(105958, 0, 0, 1, 3), node(77, 600, 0, 2, 5, 'Deflection')],
    edges: [],
  }, { className: 'Warrior', catalog })

  const [heroic, deflection] = layout.panels[0].nodes
  assert.match(heroic.currentRankText, /by 1 Rage/)
  assert.match(heroic.nextRankText, /by 2 Rage/)
  assert.match(deflection.currentRankText, /by 2%/)
  assert.match(deflection.nextRankText, /by 3%/)
})

test('no nodes means no layout', () => {
  assert.equal(buildTalentLayout({ nodes: [] }, { catalog }), null)
})
