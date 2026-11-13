import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { backupKey } from './encryptedBackup.js'
import { runtimeDataDirectory } from './runtimeData.js'
import { createVerifiedSnapshot, encryptSnapshot, restoreArchiveStream, verifyArchiveStream } from './streamingBackup.js'

const SIX_HOURS = 6 * 60 * 60 * 1000
const STATUS_FILE = 'offsite-backup-status.json'
const FAILURE_FILE = 'offsite-backup-failure.json'
// S3 needs parts of at least 5 MiB (except the last). 16 MiB parts keep at
// most one part in memory and allow archives up to 160 GB.
export const PART_BYTES = 16 * 1024 * 1024
const FULL_RESTORE_DRILL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_PROVISIONING_BYTES = 1024 * 1024

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

// Uploads a stream as an S3 multipart upload, holding at most one part in
// memory. Any failure aborts the upload, so no partial object remains.
export async function uploadStream({ client, bucket, key, body, partBytes = PART_BYTES, abortSignal }) {
  const { UploadId } = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: 'application/octet-stream' }), { abortSignal })
  const parts = []
  let bytes = 0
  try {
    let buffered = []
    let length = 0
    const send = async () => {
      const data = Buffer.concat(buffered, length)
      buffered = []
      length = 0
      const PartNumber = parts.length + 1
      const result = await client.send(new UploadPartCommand({ Bucket: bucket, Key: key, UploadId, PartNumber, Body: data, ContentLength: data.length }), { abortSignal })
      if (!result?.ETag) throw new Error('Storage did not confirm an uploaded part')
      parts.push({ ETag: result.ETag, PartNumber })
    }
    for await (const chunk of body) {
      buffered.push(chunk)
      length += chunk.length
      bytes += chunk.length
      if (length >= partBytes) await send()
    }
    if (length || !parts.length) await send()
    await client.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId, MultipartUpload: { Parts: parts } }), { abortSignal })
    return { bytes, parts: parts.length }
  } catch (error) {
    body.destroy?.()
    await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId })).catch(() => {})
    throw error
  }
}

function backupDataDirectory(env) {
  return env.GUILD_DATA_DIR ? path.resolve(env.GUILD_DATA_DIR) : runtimeDataDirectory()
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function writeJsonAtomically(file, value) {
  await writeFile(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 })
  await rename(`${file}.tmp`, file)
}

async function readProvisioning(file) {
  try {
    if ((await stat(file)).size > MAX_PROVISIONING_BYTES) throw new Error('Provisioning state exceeds 1 MiB')
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function peakMemorySampler() {
  let peak = process.memoryUsage().rss
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss) }, 250)
  timer.unref?.()
  return () => {
    clearInterval(timer)
    return Math.max(peak, process.memoryUsage().rss)
  }
}

// One backup: a verified snapshot, streamed encrypted to object storage,
// then downloaded again and checked: every frame authenticated, the
// decompressed database's SHA-256 equal to the snapshot's. Weekly (or with
// BACKUP_RESTORE_DRILL=full) the download is also restored into a SQLite
// file and checked for integrity, foreign keys and row counts. The success
// status is written only after verification; a failure is recorded
// separately and leaves the last success untouched.
export async function runOffsiteBackup({ env = process.env, client, now = () => new Date(), statfsImpl, partBytes = PART_BYTES } = {}) {
  const config = offsiteBackupConfig(env)
  if (!config) return { status: 'disabled' }
  const dataDir = backupDataDirectory(env)
  const workDir = env.BACKUP_WORK_DIR ? path.resolve(env.BACKUP_WORK_DIR) : os.tmpdir()
  const createdAt = now()
  const started = Date.now()
  const peakMemory = peakMemorySampler()
  const storage = client || new S3Client({ ...config.clientOptions, maxAttempts: 3 })
  const abortSignal = AbortSignal.timeout(Number(env.BACKUP_TIMEOUT_MS) || 6 * 60 * 60 * 1000)
  const key = `holdfast/${createdAt.toISOString().slice(0, 10)}/${createdAt.toISOString().replaceAll(':', '-')}-${randomUUID()}.hfb`
  let snapshot = null
  let drillDirectory = null
  try {
    snapshot = await createVerifiedSnapshot({ dataDir, workDir, ...(statfsImpl ? { statfsImpl } : {}) })
    const provisioning = await readProvisioning(env.DISCORD_PROVISION_STATE_FILE || path.join(dataDir, 'discord-provisioning-state.json'))
    const archive = encryptSnapshot({ snapshot, encryptionKey: config.encryptionKey, createdAt: createdAt.toISOString(), provisioning })
    const upload = await uploadStream({ client: storage, bucket: config.bucket, key, body: archive.stream, partBytes, abortSignal })
    const source = archive.digest()

    const previous = await readJson(path.join(dataDir, STATUS_FILE))
    const fullDrill = env.BACKUP_RESTORE_DRILL === 'full'
      || !(Date.parse(previous?.lastFullRestoreAt) > createdAt.getTime() - FULL_RESTORE_DRILL_MS)
    const download = await storage.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }), { abortSignal })
    if (!download?.Body) throw new Error('Storage returned no backup body')
    if (Number.isInteger(download.ContentLength) && download.ContentLength !== upload.bytes) {
      download.Body.destroy?.()
      throw new Error('Remote backup size does not match the upload')
    }
    let remote
    if (fullDrill) {
      drillDirectory = await mkdtemp(path.join(workDir, 'holdfast-restore-drill-'))
      remote = await restoreArchiveStream({ input: download.Body, encryptionKey: config.encryptionKey, destination: path.join(drillDirectory, 'restored') })
      if (JSON.stringify(remote.counts) !== JSON.stringify(snapshot.counts)) throw new Error('Remote restore row counts do not match the snapshot')
    } else {
      remote = await verifyArchiveStream({ input: download.Body, encryptionKey: config.encryptionKey })
    }
    if (remote.databaseSha256 !== source.sha256 || remote.databaseBytes !== source.bytes) throw new Error('Remote restore does not match the current snapshot')

    const verifiedAt = now().toISOString()
    const status = {
      version: 2,
      format: 'HOLDFB02',
      verifiedAt,
      createdAt: createdAt.toISOString(),
      key,
      counts: snapshot.counts,
      databaseBytes: source.bytes,
      databaseSha256: source.sha256,
      archiveBytes: upload.bytes,
      parts: upload.parts,
      verification: fullDrill ? 'full-restore' : 'stream-checksum',
      lastFullRestoreAt: fullDrill ? verifiedAt : previous?.lastFullRestoreAt ?? null,
      durationMs: Date.now() - started,
      peakRssBytes: peakMemory(),
    }
    await writeJsonAtomically(path.join(dataDir, STATUS_FILE), status)
    await rm(path.join(dataDir, FAILURE_FILE), { force: true })
    return { status: 'verified', ...status }
  } catch (error) {
    const failure = { failedAt: now().toISOString(), error: String(error.code || error.message || 'Error').slice(0, 160), durationMs: Date.now() - started, peakRssBytes: peakMemory() }
    await writeJsonAtomically(path.join(dataDir, FAILURE_FILE), failure).catch(() => {})
    throw error
  } finally {
    peakMemory()
    if (!client) storage.destroy()
    await snapshot?.cleanup()
    if (drillDirectory) await rm(drillDirectory, { recursive: true, force: true })
  }
}

// Public readiness view: only whether a verified backup is recent.
export async function offsiteBackupHealth({ env = process.env, now = Date.now() } = {}) {
  if (env.BACKUP_OFFSITE_ENABLED !== 'true') return { enabled: false }
  try {
    const directory = backupDataDirectory(env)
    const status = JSON.parse(await readFile(path.join(directory, STATUS_FILE), 'utf8'))
    const age = now - Date.parse(status.verifiedAt)
    return { enabled: true, healthy: Number.isFinite(age) && age >= 0 && age <= 24 * 60 * 60 * 1000, lastVerifiedAt: status.verifiedAt }
  } catch {
    return { enabled: true, healthy: false, lastVerifiedAt: null }
  }
}

// Administrator view: the last verified backup's details and the last
// failure since then. No keys or credentials.
export async function offsiteBackupDetails({ env = process.env, now = Date.now() } = {}) {
  const health = await offsiteBackupHealth({ env, now })
  if (!health.enabled) return health
  const directory = backupDataDirectory(env)
  const status = await readJson(path.join(directory, STATUS_FILE))
  const failure = await readJson(path.join(directory, FAILURE_FILE))
  const pick = (value, keys) => (value ? Object.fromEntries(keys.filter((name) => name in value).map((name) => [name, value[name]])) : null)
  return {
    ...health,
    last: pick(status, ['format', 'verifiedAt', 'createdAt', 'databaseBytes', 'archiveBytes', 'parts', 'verification', 'lastFullRestoreAt', 'durationMs', 'peakRssBytes']),
    lastFailure: failure,
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
