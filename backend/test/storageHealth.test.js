import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateStorageHealth } from '../src/Production/storageObservatory.js'
import { withHttpApp } from '../testSupport/httpHarness.js'
import { createStorageObservatory } from '../src/Production/storageObservatory.js'

const GB = 1024 ** 3
const NOW = Date.parse('2026-11-20T00:00:00Z')
const disk = (usedGb, capacityGb = 15) => ({ capacityBytes: capacityGb * GB, usedBytes: usedGb * GB, freeBytes: (capacityGb - usedGb) * GB })
// Samples every 6 hours, `hours` back, free space shrinking `perDayGb` a day,
// plus `lastDayGb` extra over the final 24 hours.
function samples({ hours, perDayGb, freeNowGb, lastDayGb = 0 }) {
  const out = []
  for (let h = hours; h >= 0; h -= 6) {
    const extra = h < 24 ? (lastDayGb * (24 - h)) / 24 : lastDayGb * 0
    const free = freeNowGb + (perDayGb * h) / 24 + lastDayGb - extra
    out.push({ at: new Date(NOW - h * 3600_000).toISOString(), freeDiskBytes: Math.round(free * GB), databaseBytes: 1, domains: {} })
  }
  return out
}

test('disk thresholds at 70, 85 and 95 percent', () => {
  assert.deepEqual(evaluateStorageHealth({ disk: disk(6) }).alerts, [])
  assert.deepEqual(evaluateStorageHealth({ disk: disk(10.6) }).alerts, ['disk_70'])
  assert.deepEqual(evaluateStorageHealth({ disk: disk(12.9) }).alerts, ['disk_85'])
  const full = evaluateStorageHealth({ disk: disk(14.5) })
  assert.deepEqual(full.alerts, ['disk_95'])
  assert.equal(full.status, 'critical')
  assert.equal(evaluateStorageHealth({ disk: disk(10.6) }).status, 'warning')
})

test('no growth alerts without a baseline of four samples over 48 hours', () => {
  for (const history of [[], samples({ hours: 12, perDayGb: 5, freeNowGb: 8 }), samples({ hours: 42, perDayGb: 5, freeNowGb: 8 })]) {
    const result = evaluateStorageHealth({ disk: disk(7), samples: history, now: NOW })
    assert.equal(result.growth.baseline, 'insufficient_data')
    assert.deepEqual(result.alerts, [])
    assert.equal(result.daysUntilFull, null)
  }
})

test('steady growth reports days until full, and warns inside two weeks', () => {
  const steady = evaluateStorageHealth({ disk: disk(6), samples: samples({ hours: 7 * 24, perDayGb: 0.2, freeNowGb: 9 }), now: NOW })
  assert.equal(steady.growth.baseline, 'ok')
  assert.deepEqual(steady.alerts, [])
  assert.ok(Math.abs(steady.daysUntilFull - 45) < 1, `about 45 days (${steady.daysUntilFull})`)
  const soon = evaluateStorageHealth({ disk: disk(13), samples: samples({ hours: 7 * 24, perDayGb: 0.2, freeNowGb: 2 }), now: NOW })
  assert.ok(soon.alerts.includes('full_within_14_days'))
  assert.equal(soon.status, 'critical')
})

test('a day of growth far above the baseline is rapid growth; normal noise is not', () => {
  const spike = evaluateStorageHealth({ disk: disk(8), samples: samples({ hours: 5 * 24, perDayGb: 0.1, freeNowGb: 7, lastDayGb: 1.5 }), now: NOW })
  assert.ok(spike.alerts.includes('rapid_growth'), JSON.stringify(spike))
  const shrinking = evaluateStorageHealth({ disk: disk(8), samples: samples({ hours: 5 * 24, perDayGb: -0.1, freeNowGb: 7 }), now: NOW })
  assert.deepEqual(shrinking.alerts, [], 'pruning that frees space raises nothing')
  const small = evaluateStorageHealth({ disk: disk(8), samples: samples({ hours: 5 * 24, perDayGb: 0.001, freeNowGb: 7, lastDayGb: 0.05 }), now: NOW })
  assert.ok(!small.alerts.includes('rapid_growth'), 'below 100 MiB a day is never rapid')
})

test('readiness publishes only the storage status and alert codes', () => withHttpApp(async ({ request }) => {
  const ready = await request('/api/health/ready')
  assert.equal(ready.status, 200)
  assert.deepEqual(Object.keys(ready.json.storage).sort(), ['alerts', 'status'])
  assert.ok(['ok', 'warning', 'critical'].includes(ready.json.storage.status))
  const detail = await request('/api/admin/storage/health', { persona: 'owner' })
  assert.equal(detail.status, 200)
  assert.ok(detail.json.disk.capacityBytes > 0)
  assert.equal((await request('/api/admin/storage/health')).status, 401)
}, { appOptions: (directory) => ({ storageObservatory: createStorageObservatory({ dataDir: directory, log: { info() {}, error() {} } }) }) }))
