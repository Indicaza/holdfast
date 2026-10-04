import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../src/app.js'
import { setSession } from '../src/Auth/session.js'
import { initializeGuildData } from '../src/Data/initializeData.js'
import { withGuildDatabase } from '../src/Data/database.js'

export const memberIds = { member: 'e2e-member', officer: 'e2e-officer', owner: 'e2e-commander' }
export const objective = { questId: 'e2e-supply-run', objectiveId: 'e2e-linen' }

export function persistentState() {
  return withGuildDatabase((db) => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()])))
}

export async function withHttpApp(run, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'holdfast-http-'))
  const overrides = {
    NODE_ENV: 'production',
    GUILD_DATA_DIR: directory,
    FRONTEND_URL: 'https://holdfast.example',
    FRONTEND_DIST_DIR: path.join(directory, 'frontend'),
    SERVE_FRONTEND: '',
    SESSION_SECRET: 'http-test-session-secret-at-least-32-bytes',
    GUILD_OWNER_DISCORD_IDS: memberIds.owner,
    DISCORD_GUILD_ID: '',
    DISCORD_BOT_TOKEN: '',
    TRUSTED_ORIGINS: '',
    TRUST_PROXY: '',
    BACKUP_OFFSITE_ENABLED: '',
    ...options.env,
  }
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]))
  let server
  try {
    Object.assign(process.env, overrides)
    for (const name of ['members.json', 'quests.json']) {
      await copyFile(new URL(`../../e2e/fixtures/${name}`, import.meta.url), path.join(directory, name))
    }
    await mkdir(overrides.FRONTEND_DIST_DIR)
    await writeFile(path.join(overrides.FRONTEND_DIST_DIR, 'index.html'), '<!doctype html><title>HTTP test frontend</title>')
    initializeGuildData()
    const app = createApp({ discordAuthOptions: options.discordAuthOptions })
    server = await new Promise((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
      listening.once('error', reject)
    })
    const base = `http://127.0.0.1:${server.address().port}`
    const cookie = (persona, permissions = []) => {
      let header
      setSession({ append(name, value) { header = value } }, {
        user: { id: memberIds[persona] || persona, username: persona },
        permissions,
        verifiedAt: Date.now(),
      })
      return header.split(';', 1)[0]
    }
    const request = async (route, { persona, body, method = 'GET', headers = {}, rawCookie } = {}) => {
      const response = await fetch(`${base}${route}`, {
        method,
        redirect: 'manual',
        headers: {
          Origin: overrides.FRONTEND_URL,
          ...(persona ? { Cookie: cookie(persona) } : {}),
          ...(rawCookie ? { Cookie: rawCookie } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const text = await response.text()
      let json
      try { json = JSON.parse(text) } catch { json = null }
      return { status: response.status, headers: response.headers, json, text }
    }
    await run({ request, cookie, base, directory })
  } finally {
    if (server) {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(directory, { recursive: true, force: true })
  }
}
