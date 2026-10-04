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
    testFile: 'test/apiPermissions.test.js',
    test: 'audit snapshots are available to authorized leadership and never anonymous visitors',
  },
  {
    file: 'src/app.js',
    from: 'app.use("/api", requireTrustedMutationOrigin);',
    to: '',
    testFile: 'test/apiPermissions.test.js',
    test: 'production origin guards protect writes through the real middleware chain',
  },
  {
    file: 'src/Notification/notificationRouter.js',
    from: 'router.get("/", requireAuthenticated, (req, res) => {',
    to: 'router.get("/", (req, res) => {',
    testFile: 'test/notificationRouter.test.js',
    test: 'notification routes require a signed-in member before invoking dependencies',
  },
  {
    file: 'src/Notification/notificationRepository.js',
    from: 'WHERE id = ? AND recipient_member_id = ?',
    to: 'WHERE id = ? AND ? IS NOT NULL',
    testFile: 'test/notificationRepository.test.js',
    test: 'single and bulk read operations are private, idempotent, and preserve resolution',
  },
]

function run({ test, testFile }) {
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=spec', `--test-name-pattern=${test}`, testFile],
    { cwd: copy, encoding: 'utf8', timeout: 60_000 },
  )
  if (result.error || result.signal) {
    throw result.error || new Error(`Test process stopped: ${result.signal}`)
  }
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` }
}

try {
  await mkdir(copy)
  for (const entry of ['src', 'config', 'testSupport', 'package.json']) {
    await cp(path.join(backend, entry), path.join(copy, entry), { recursive: true })
  }
  await mkdir(path.join(copy, 'test'))
  for (const testFile of new Set(mutations.map((mutation) => mutation.testFile))) {
    await cp(path.join(backend, testFile), path.join(copy, testFile))
  }
  await cp(path.join(backend, '../e2e/fixtures'), path.join(root, 'e2e/fixtures'), { recursive: true })
  await symlink(path.join(backend, 'node_modules'), path.join(copy, 'node_modules'), 'dir')

  for (const mutation of mutations) {
    const baseline = run(mutation)
    assert.equal(baseline.status, 0, baseline.output)

    const file = path.join(copy, mutation.file)
    const original = await readFile(file, 'utf8')
    assert.equal(
      original.split(mutation.from).length - 1,
      1,
      `Update the mutation target in ${mutation.file}`,
    )

    try {
      await writeFile(file, original.replace(mutation.from, mutation.to))
      const result = run(mutation)
      assert.notEqual(
        result.status,
        0,
        `Tests accepted a missing safety check: ${mutation.file}`,
      )
      assert.ok(
        result.output.includes('AssertionError') && result.output.includes(mutation.test),
        result.output,
      )
      console.log(`Regression assertion caught the missing guard in ${mutation.file}.`)
    } finally {
      await writeFile(file, original)
    }
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
