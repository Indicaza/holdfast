import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, rename } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { backupKey, createEncryptedSnapshot, decryptSnapshot, MAX_SNAPSHOT_BYTES, restoreEncryptedSnapshot } from './encryptedBackup.js'
import { runtimeDataDirectory } from './runtimeData.js'

const SIX_HOURS = 6 * 60 * 60 * 1000
const STATUS_FILE = 'offsite-backup-status.json'

export function offsiteBackupConfig(env = process.env) {
  if (env.BACKUP_OFFSITE_ENABLED && !['true', 'false'].includes(env.BACKUP_OFFSITE_ENABLED)) throw new Error('BACKUP_OFFSITE_ENABLED must be true or false')
  if (env.BACKUP_OFFSITE_ENABLED !== 'true') return null
  for (const name of ['BACKUP_S3_BUCKET', 'BACKUP_S3_REGION', 'BACKUP_S3_ACCESS_KEY_ID', 'BACKUP_S3_SECRET_ACCESS_KEY', 'BACKUP_ENCRYPTION_KEY']) {
    if (!env[name]?.trim()) throw new Error(`${name} is required when off-site backups are enabled`)
  }
  backupKey(env.BACKUP_ENCRYPTION_KEY)
  if (env.BACKUP_S3_ENDPOINT && new URL(env.BACKUP_S3_ENDPOINT).protocol !== 'https:') throw new Error('Backup storage endpoint must use HTTPS')
  return {
    bucket: env.BACKUP_S3_BUCKET,
    encryptionKey: env.BACKUP_ENCRYPTION_KEY,
    clientOptions: { region: env.BACKUP_S3_REGION, ...(env.BACKUP_S3_ENDPOINT ? { endpoint: env.BACKUP_S3_ENDPOINT, forcePathStyle: true } : {}), credentials: { accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY } },
  }
}

export async function runOffsiteBackup({ env = process.env, client, now = () => new Date() } = {}) {
  const config = offsiteBackupConfig(env)
  if (!config) return { status: 'disabled' }
  const dataDir = env.GUILD_DATA_DIR ? path.resolve(env.GUILD_DATA_DIR) : runtimeDataDirectory()
  const createdAt = now()
  const archive = await createEncryptedSnapshot({ dataDir, encryptionKey: config.encryptionKey, provisioningFile: env.DISCORD_PROVISION_STATE_FILE || path.join(dataDir, 'discord-provisioning-state.json'), now: createdAt })
  const key = `holdfast/${createdAt.toISOString().slice(0, 10)}/${createdAt.toISOString().replaceAll(':', '-')}-${randomUUID()}.hfb`
  const storage = client || new S3Client({ ...config.clientOptions, maxAttempts: 3 })
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'holdfast-restore-drill-'))
  const abortSignal = AbortSignal.timeout(120_000)
  try {
    await storage.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: archive, ContentType: 'application/octet-stream' }), { abortSignal })
    const download = await storage.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }), { abortSignal })
    if (!Number.isInteger(download.ContentLength) || download.ContentLength < 37 || download.ContentLength > MAX_SNAPSHOT_BYTES * 2) {
      download.Body?.destroy?.()
      throw new Error('Remote backup exceeds the size limit')
    }
    const bytes = Buffer.from(await download.Body.transformToByteArray())
    const source = decryptSnapshot(archive, config.encryptionKey)
    const result = await restoreEncryptedSnapshot({ archive: bytes, encryptionKey: config.encryptionKey, destination: path.join(temporary, 'restored') })
    if (result.databaseSha256 !== source.databaseSha256) throw new Error('Remote restore does not match the current snapshot')
    const verifiedAt = now().toISOString()
    const status = { version: 1, verifiedAt, createdAt: createdAt.toISOString(), key, counts: result.counts }
    const statusPath = path.join(dataDir, STATUS_FILE)
    await writeFile(`${statusPath}.tmp`, JSON.stringify(status), { mode: 0o600 })
    await rename(`${statusPath}.tmp`, statusPath)
    return { status: 'verified', ...status }
  } finally {
    if (!client) storage.destroy()
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function offsiteBackupHealth({ env = process.env, now = Date.now() } = {}) {
  if (env.BACKUP_OFFSITE_ENABLED !== 'true') return { enabled: false }
  try {
    const directory = env.GUILD_DATA_DIR ? path.resolve(env.GUILD_DATA_DIR) : runtimeDataDirectory()
    const status = JSON.parse(await readFile(path.join(directory, STATUS_FILE), 'utf8'))
    const age = now - Date.parse(status.verifiedAt)
    return { enabled: true, healthy: Number.isFinite(age) && age >= 0 && age <= 24 * 60 * 60 * 1000, lastVerifiedAt: status.verifiedAt }
  } catch {
    return { enabled: true, healthy: false, lastVerifiedAt: null }
  }
}

export function startOffsiteBackupScheduler({ env = process.env, run = runOffsiteBackup, timers = { setTimeout, setInterval, clearTimeout, clearInterval } } = {}) {
  if (!offsiteBackupConfig(env)) return () => {}
  let running = false
  let stopped = false
  async function tick() {
    if (running || stopped) return
    running = true
    try { await run({ env }) } catch { console.error('Off-site backup verification failed; check backup storage and the production monitor.') } finally { running = false }
  }
  const first = timers.setTimeout(tick, 60_000)
  const recurring = timers.setInterval(tick, SIX_HOURS)
  first.unref?.()
  recurring.unref?.()
  return () => { stopped = true; timers.clearTimeout(first); timers.clearInterval(recurring) }
}
