import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function assertCoverageInventory(sourceFiles, reportedFiles) {
  const reported = new Set(reportedFiles.map((file) => file.replaceAll('\\', '/')))
  const missing = sourceFiles.filter((file) => !reported.has(file.replaceAll('\\', '/')))
  if (missing.length) throw new Error(`Source files missing from coverage: ${missing.join(', ')}`)
}

async function javascriptFiles(directory, root) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await javascriptFiles(file, root))
    else if (entry.name.endsWith('.js') && path.relative(root, file) !== 'src/index.js') result.push(path.relative(root, file))
  }
  return result.sort()
}

async function run() {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const directory = path.join(root, 'coverage')
  const report = path.join(directory, 'backend.lcov')
  await mkdir(directory, { recursive: true })
  const status = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', '--experimental-test-coverage', '--test-coverage-include=src/**/*.js', '--test-coverage-exclude=src/index.js', '--test-coverage-lines=85', '--test-coverage-branches=75', '--test-coverage-functions=90', '--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=lcov', `--test-reporter-destination=${report}`], { cwd: root, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', resolve)
  })
  if (status !== 0) throw new Error('Backend tests or coverage thresholds failed.')
  const source = await javascriptFiles(path.join(root, 'src'), root)
  const reported = (await readFile(report, 'utf8')).split('\n').filter((line) => line.startsWith('SF:')).map((line) => {
    const file = line.slice(3)
    return path.isAbsolute(file) ? path.relative(root, file) : file
  })
  assertCoverageInventory(source, reported)
  console.log(`Coverage includes every ${source.length} application module. Process bootstrap is checked by the production artifact smoke test.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
