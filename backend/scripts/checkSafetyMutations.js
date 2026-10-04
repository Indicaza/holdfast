import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const backend = fileURLToPath(new URL('../', import.meta.url))
const root = await mkdtemp(path.join(os.tmpdir(), 'holdfast-safety-mutations-'))
const copy = path.join(root, 'backend')
const mutations = [
  {
    file: 'src/Audit/auditRouter.js',
    from: 'router.get("/", requirePermission("audit.view"), (req, res) => {',
    to: 'router.get("/", (req, res) => {',
    test: 'audit snapshots are available to authorized leadership and never anonymous visitors',
  },
  {
    file: 'src/app.js',
    from: 'app.use("/api", requireTrustedMutationOrigin);',
    to: '',
    test: 'production origin guards protect writes through the real middleware chain',
  },
]

function run(name) {
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', `--test-name-pattern=${name}`, 'test/apiPermissions.test.js'], { cwd: copy, encoding: 'utf8', timeout: 60_000 })
  if (result.error || result.signal) throw result.error || new Error(`Test process stopped: ${result.signal}`)
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` }
}

try {
  await mkdir(copy)
  for (const entry of ['src', 'config', 'testSupport', 'package.json']) await cp(path.join(backend, entry), path.join(copy, entry), { recursive: true })
  await mkdir(path.join(copy, 'test'))
  await cp(path.join(backend, 'test/apiPermissions.test.js'), path.join(copy, 'test/apiPermissions.test.js'))
  await cp(path.join(backend, '../e2e/fixtures'), path.join(root, 'e2e/fixtures'), { recursive: true })
  await symlink(path.join(backend, 'node_modules'), path.join(copy, 'node_modules'), 'dir')
  const baseline = run(mutations.map((mutation) => mutation.test).join('|'))
  assert.equal(baseline.status, 0, baseline.output)
  for (const mutation of mutations) {
    const file = path.join(copy, mutation.file)
    const original = await readFile(file, 'utf8')
    assert.equal(original.split(mutation.from).length - 1, 1, `Update the mutation target in ${mutation.file}`)
    try {
      await writeFile(file, original.replace(mutation.from, mutation.to))
      const result = run(mutation.test)
      assert.notEqual(result.status, 0, `Tests accepted a missing safety check: ${mutation.file}`)
      assert.ok(result.output.includes('AssertionError') && result.output.includes(mutation.test), result.output)
      console.log(`Regression assertion caught the missing guard in ${mutation.file}.`)
    } finally {
      await writeFile(file, original)
    }
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
