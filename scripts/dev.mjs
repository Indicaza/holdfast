// Starts the Holdfast backend and frontend dev servers together.
//
//   npm run dev            install missing deps, create backend/.env if absent, start both servers
//   npm run dev -- --seed  also run the backend development seed before starting
//   npm run setup          prepare dependencies, .env, and seed data without starting servers
//
// Uses only Node built-ins so it works before any package has been installed.

import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = process.platform === 'win32'
const args = new Set(process.argv.slice(2))
const setupOnly = args.has('--setup-only')

const apps = [
  { name: 'backend', dir: join(root, 'backend'), color: 36 },
  { name: 'frontend', dir: join(root, 'frontend'), color: 35 },
]

function log(message) {
  console.log(`\x1b[1m[holdfast]\x1b[0m ${message}`)
}

function checkNodeVersion() {
  const expected = readFileSync(join(root, '.nvmrc'), 'utf8').trim()
  const actual = process.versions.node.split('.')[0]
  if (actual !== expected) {
    log(`\x1b[33mwarning:\x1b[0m Holdfast expects Node ${expected} (see .nvmrc); you are running ${process.version}.`)
  }
}

function run(command, commandArgs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd, stdio: 'inherit', shell: isWindows })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${commandArgs.join(' ')} failed in ${cwd} (exit ${code})`))
    })
  })
}

function needsInstall(dir) {
  const marker = join(dir, 'node_modules', '.package-lock.json')
  if (!existsSync(marker)) return true
  return statSync(join(dir, 'package-lock.json')).mtimeMs > statSync(marker).mtimeMs
}

async function installDependencies() {
  for (const app of apps) {
    if (needsInstall(app.dir)) {
      log(`installing ${app.name} dependencies...`)
      await run('npm', ['ci'], app.dir)
    }
  }
}

// Creates backend/.env with the local identity sandbox enabled. An existing
// .env is never modified. Returns true when a new file was written.
function ensureBackendEnv() {
  const envPath = join(root, 'backend', '.env')
  if (existsSync(envPath)) return false

  copyFileSync(join(root, 'backend', '.env.example'), envPath)
  const contents = readFileSync(envPath, 'utf8')
    .replace(/^SESSION_SECRET=.*$/m, 'SESSION_SECRET=local-development-only-change-me')
    .replace(/^HOLDFAST_DEV_AUTH=.*$/m, 'HOLDFAST_DEV_AUTH=true')
  writeFileSync(envPath, contents)
  log('created backend/.env with the local development sandbox enabled.')
  return true
}

function devAuthEnabled() {
  const contents = readFileSync(join(root, 'backend', '.env'), 'utf8')
  return /^HOLDFAST_DEV_AUTH=true\s*$/m.test(contents)
}

function prefixOutput(stream, app) {
  const prefix = `\x1b[${app.color}m[${app.name}]\x1b[0m `
  let buffered = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffered += chunk
    const lines = buffered.split('\n')
    buffered = lines.pop()
    for (const line of lines) process.stdout.write(prefix + line + '\n')
  })
  stream.on('end', () => {
    if (buffered) process.stdout.write(prefix + buffered + '\n')
  })
}

function startServers() {
  const children = []
  let shuttingDown = false

  function stopAll(exitCode) {
    if (shuttingDown) return
    shuttingDown = true
    for (const child of children) {
      if (child.exitCode !== null) continue
      try {
        if (isWindows) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
        else process.kill(-child.pid, 'SIGTERM')
      } catch {
        // Already gone.
      }
    }
    process.exitCode = exitCode
  }

  for (const app of apps) {
    const child = spawn('npm', ['run', 'dev'], {
      cwd: app.dir,
      env: { ...process.env, FORCE_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWindows,
      // Own process group so the whole tree (npm -> nodemon/vite) can be stopped together.
      detached: !isWindows,
    })
    prefixOutput(child.stdout, app)
    prefixOutput(child.stderr, app)
    child.on('exit', (code, signal) => {
      if (!shuttingDown) {
        log(`${app.name} exited (${signal || `code ${code}`}); stopping the other server.`)
        stopAll(code || 1)
      }
    })
    children.push(child)
  }

  process.on('SIGINT', () => stopAll(0))
  process.on('SIGTERM', () => stopAll(0))

  log('backend on http://localhost:3000, frontend on http://localhost:5173 (Ctrl+C stops both)')
  if (devAuthEnabled()) {
    log('dev personas: http://localhost:5173/api/dev/login/{member|officer|commander}')
  }
}

async function main() {
  checkNodeVersion()
  await installDependencies()
  const createdEnv = ensureBackendEnv()

  if ((createdEnv || args.has('--seed') || setupOnly) && devAuthEnabled()) {
    log('seeding development personas and sample quests...')
    await run('npm', ['run', 'dev:seed'], join(root, 'backend'))
  }

  if (setupOnly) {
    log('setup complete. Run `npm run dev` to start Holdfast.')
    return
  }
  startServers()
}

main().catch((error) => {
  log(`\x1b[31m${error.message}\x1b[0m`)
  process.exitCode = 1
})
