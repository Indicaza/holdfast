import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from 'yaml'

test('production monitoring runs from trusted main without waiting for its own deployment', async () => {
  const workflow = parse(await readFile(new URL('../../.github/workflows/production-monitor.yml', import.meta.url), 'utf8'))
  assert.equal(workflow.on.pull_request, undefined)
  assert.equal(workflow.on.workflow_run, undefined)
  assert.ok(workflow.on.schedule.length)
  assert.equal(workflow.jobs.smoke.if, "github.ref == 'refs/heads/main'")
  const steps = workflow.jobs.smoke.steps
  const run = steps.find((step) => step.run === 'node scripts/productionSmoke.mjs')
  assert.ok(run)
  assert.equal(run.env.REQUIRE_OFFSITE_BACKUP, "${{ vars.HOLDFAST_REQUIRE_OFFSITE_BACKUP || 'false' }}")
  assert.equal(workflow.jobs.report.permissions.issues, 'write')
  assert.ok(steps.find((step) => step.id === 'release').with.script.includes("run?.conclusion === 'success'"))
})
