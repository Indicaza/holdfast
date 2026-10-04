import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { gzipSync, gunzipSync } from 'node:zlib'

export const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024
const MAX_ARCHIVE_BYTES = MAX_SNAPSHOT_BYTES * 2
const MAGIC = Buffer.from('HOLDFB01')

export function backupKey(value) {
  if (!/^[a-f0-9]{64}$/i.test(value || '')) throw new Error('BACKUP_ENCRYPTION_KEY must contain 64 hexadecimal characters')
  return Buffer.from(value, 'hex')
}

export function verifyBackupDatabase(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Backup database failed integrity verification')
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Backup database has foreign key violations')
    const counts = Object.fromEntries(['members', 'quests', 'objectives', 'contribution_transactions', 'rank_authority', 'billets'].map((table) => [table, Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)]))
    if (!db.prepare('SELECT id FROM quest_settings WHERE id = 1').get()) throw new Error('Backup database has no quest settings')
    return counts
  } finally {
    db.close()
  }
}

export async function createEncryptedSnapshot({ dataDir, encryptionKey, provisioningFile = path.join(dataDir, 'discord-provisioning-state.json'), now = new Date() }) {
  const key = backupKey(encryptionKey)
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'holdfast-snapshot-'))
  try {
    const source = path.join(dataDir, 'holdfast.sqlite')
    if ((await stat(source)).size > MAX_SNAPSHOT_BYTES) throw new Error('Database exceeds the 32 MiB encrypted snapshot limit')
    const db = new DatabaseSync(source, { readOnly: true })
    const snapshot = path.join(temporary, 'holdfast.sqlite')
    try { await backup(db, snapshot) } finally { db.close() }
    const counts = verifyBackupDatabase(snapshot)
    if ((await stat(snapshot)).size > MAX_SNAPSHOT_BYTES) throw new Error('Snapshot exceeds the 32 MiB limit')
    const database = await readFile(snapshot)
    let provisioning = null
    try {
      if ((await stat(provisioningFile)).size > 1024 * 1024) throw new Error('Provisioning state exceeds 1 MiB')
      provisioning = JSON.parse(await readFile(provisioningFile, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const document = { version: 1, createdAt: now.toISOString(), databaseSha256: createHash('sha256').update(database).digest('hex'), counts, database: database.toString('base64'), provisioning }
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(MAGIC)
    const encrypted = Buffer.concat([cipher.update(gzipSync(JSON.stringify(document))), cipher.final()])
    return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted])
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export function decryptSnapshot(archive, encryptionKey) {
  const key = backupKey(encryptionKey)
  if (archive.length < 37 || archive.length > MAX_ARCHIVE_BYTES || !archive.subarray(0, 8).equals(MAGIC)) throw new Error('Invalid encrypted backup')
  const decipher = createDecipheriv('aes-256-gcm', key, archive.subarray(8, 20))
  decipher.setAAD(MAGIC)
  decipher.setAuthTag(archive.subarray(20, 36))
  const compressed = Buffer.concat([decipher.update(archive.subarray(36)), decipher.final()])
  const document = JSON.parse(gunzipSync(compressed, { maxOutputLength: MAX_ARCHIVE_BYTES }).toString())
  if (document.version !== 1 || !Number.isFinite(Date.parse(document.createdAt)) || typeof document.database !== 'string') throw new Error('Invalid backup document')
  const database = Buffer.from(document.database, 'base64')
  if (database.length > MAX_SNAPSHOT_BYTES || createHash('sha256').update(database).digest('hex') !== document.databaseSha256) throw new Error('Backup database checksum mismatch')
  return { ...document, database }
}

export async function restoreEncryptedSnapshot({ archive, encryptionKey, destination }) {
  const document = decryptSnapshot(archive, encryptionKey)
  await mkdir(destination, { mode: 0o700 })
  try {
    const file = path.join(destination, 'holdfast.sqlite')
    await writeFile(file, document.database, { mode: 0o600, flag: 'wx' })
    const counts = verifyBackupDatabase(file)
    if (JSON.stringify(counts) !== JSON.stringify(document.counts)) throw new Error('Restored row counts do not match the backup')
    if (document.provisioning !== null) await writeFile(path.join(destination, 'discord-provisioning-state.json'), JSON.stringify(document.provisioning), { mode: 0o600, flag: 'wx' })
    return { createdAt: document.createdAt, counts, databaseSha256: document.databaseSha256 }
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    throw error
  }
}
