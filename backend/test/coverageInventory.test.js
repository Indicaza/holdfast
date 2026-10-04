import assert from 'node:assert/strict'
import test from 'node:test'
import { assertCoverageInventory } from '../scripts/testCoverage.js'

test('coverage cannot silently omit an unimported application module', () => {
  const source = ['src/app.js', 'src/Audit/auditRouter.js', 'src/NewFeature/router.js']
  assert.throws(() => assertCoverageInventory(source, source.slice(0, 2)), /src\/NewFeature\/router.js/)
  assert.doesNotThrow(() => assertCoverageInventory(source, source))
})
