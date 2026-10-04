import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from 'yaml'
import { assertReleaseChecks, requiredChecks } from '../../scripts/release-gate.mjs'

const passing = () => Object.fromEntries(requiredChecks.map((name) => [name, { result: 'success' }]))

test('release gate requires every check to finish successfully', () => {
  assert.doesNotThrow(() => assertReleaseChecks(passing()))
  for (const name of requiredChecks) {
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      const checks = passing()
      checks[name] = { result }
      assert.throws(() => assertReleaseChecks(checks), /Release blocked/)
    }
  }
  assert.throws(() => assertReleaseChecks({}), /missing/)
})

test('CI always runs the complete browser suite and exposes a mandatory final gate', async () => {
  const workflow = parse(await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'))
  const browser = workflow.jobs['browser-regression']
  const journey = browser.steps.find((step) => step.run === 'npx playwright test')
  assert.ok(journey)
  assert.equal(journey.if, undefined)
  assert.equal(browser.if, undefined)
  assert.ok(browser.steps.some((step) => step.run?.includes('npm ci --no-audit --no-fund')))
  assert.deepEqual(workflow.jobs['release-gate'].needs, requiredChecks)
  assert.equal(workflow.jobs['release-gate'].if, 'always()')
  assert.ok('merge_group' in workflow.on)
  const protection = JSON.parse(await readFile(new URL('../../config/main-branch-protection.json', import.meta.url), 'utf8'))
  assert.deepEqual(protection.required_status_checks.contexts, ['Release gate'])
  assert.equal(protection.required_status_checks.strict, true)
  assert.equal(protection.enforce_admins, true)
  assert.equal(protection.allow_force_pushes, false)
  assert.equal(protection.allow_deletions, false)
})
