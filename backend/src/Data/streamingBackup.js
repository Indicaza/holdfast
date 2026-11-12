import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rm, stat, statfs, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PassThrough, pipeline as pipelineCallback, Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { backup, DatabaseSync } from 'node:sqlite'
import { createGunzip, createGzip } from 'node:zlib'
import { backupKey, verifyBackupDatabase } from './encryptedBackup.js'

// Encrypted backup format 2 ("HOLDFB02"): a SQLite snapshot of any size,
// streamed through gzip and AES-256-GCM in 1 MiB frames, so memory use does
// not depend on the database size (format 1 held the whole database in
// memory, base64 inside JSON, and was limited to 32 MiB).
//
//   "HOLDFB02" | u32 header length | header JSON (authenticated, not secret)
//   frames:  u8 type (0 data, 1 trailer) | u32 length | ciphertext | 16-byte tag
//
// Every frame has its own nonce (8 random bytes from the header + the frame
// index) and authenticates the format, the header's SHA-256, its index and
// its type. Reordered, dropped, duplicated or altered frames fail. The last
// frame is the trailer (database SHA-256, size, business row counts,
// Discord provisioning state). A stream that ends without one is truncated
// and fails. Plaintext is used only after its frame authenticates, and a
// restore is accepted only after the trailer's checksum matches.

export const FORMAT_V2 = Buffer.from('HOLDFB02')
export const FRAME_BYTES = 1024 * 1024
const MAX_HEADER_BYTES = 64 * 1024
// gzip never expands a 1 MiB frame by more than a few hundred bytes.
const MAX_FRAME_BYTES = FRAME_BYTES + 64 * 1024
const TRAILER_MAX_BYTES = 2 * 1024 * 1024
// Pages per backup step: all of them, so the copy never restarts.
const ALL_PAGES = 2147483647
const DATA = 0
const TRAILER = 1

function u32(value) {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value)
  return buffer
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest()
}

function frameAad(headerHash, index, type) {
  return Buffer.concat([FORMAT_V2, headerHash, u32(index), Buffer.from([type])])
}

function nonce(prefix, index) {
  return Buffer.concat([prefix, u32(index)])
}

// Counts and hashes the bytes passing through.
export function hashTap() {
  const hash = createHash('sha256')
  let bytes = 0
  const tap = new Transform({
    transform(chunk, encoding, callback) {
      hash.update(chunk)
      bytes += chunk.length
      callback(null, chunk)
    },
  })
  let digest = null
  tap.result = () => {
    digest ??= hash.digest('hex')
    return { sha256: digest, bytes }
  }
  return tap
}

// Encrypts a byte stream into format-2 frames. `trailer()` is called once
// the input has ended and returns the trailer object.
export function frameEncryptor({ encryptionKey, header, trailer }) {
  const key = backupKey(encryptionKey)
  const headerBytes = Buffer.from(JSON.stringify(header))
  const headerHash = sha256(headerBytes)
  const prefix = Buffer.from(header.noncePrefix, 'hex')
  let index = 0
  let pending = []
  let pendingBytes = 0
  let started = false

  const seal = (plaintext, type) => {
    if (index >= 0xffffffff) throw new Error('Backup exceeds the frame limit')
    const cipher = createCipheriv('aes-256-gcm', key, nonce(prefix, index))
    cipher.setAAD(frameAad(headerHash, index, type))
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    index += 1
    return Buffer.concat([Buffer.from([type]), u32(ciphertext.length), ciphertext, cipher.getAuthTag()])
  }
  const start = (stream) => {
    if (started) return
    started = true
    stream.push(Buffer.concat([FORMAT_V2, u32(headerBytes.length), headerBytes]))
  }

  return new Transform({
    transform(chunk, encoding, callback) {
      try {
        start(this)
        pending.push(chunk)
        pendingBytes += chunk.length
        if (pendingBytes >= FRAME_BYTES) {
          let all = Buffer.concat(pending, pendingBytes)
          while (all.length >= FRAME_BYTES) {
            this.push(seal(all.subarray(0, FRAME_BYTES), DATA))
            all = all.subarray(FRAME_BYTES)
          }
          pending = all.length ? [Buffer.from(all)] : []
          pendingBytes = all.length
        }
        callback()
      } catch (error) {
        callback(error)
      }
    },
    flush(callback) {
      try {
        start(this)
        if (pendingBytes) this.push(seal(Buffer.concat(pending, pendingBytes), DATA))
        const body = Buffer.from(JSON.stringify(trailer()))
        if (body.length > TRAILER_MAX_BYTES) throw new Error('Backup trailer is too large')
        this.push(seal(body, TRAILER))
        callback()
      } catch (error) {
        callback(error)
      }
    },
  })
}

// Reads exact byte counts from an async iterable of buffers.
function byteReader(source) {
  const iterator = source[Symbol.asyncIterator]()
  let buffer = Buffer.alloc(0)
  let done = false
  return async function read(length) {
    while (buffer.length < length && !done) {
      const next = await iterator.next()
      if (next.done) done = true
      else buffer = buffer.length ? Buffer.concat([buffer, next.value]) : Buffer.from(next.value)
    }
    if (buffer.length === 0 && done) return null
    if (buffer.length < length) throw new Error('Encrypted backup is truncated')
    const out = buffer.subarray(0, length)
    buffer = buffer.subarray(length)
    return out
  }
}

export function isFormatV2(prefix) {
  return Buffer.isBuffer(prefix) && prefix.length >= 8 && prefix.subarray(0, 8).equals(FORMAT_V2)
}

// Decrypts a format-2 stream. Yields authenticated plaintext (gzip data);
// `state.header` and `state.trailer` are set as they are read.
export async function* decryptFrames(source, encryptionKey, state = {}) {
  const key = backupKey(encryptionKey)
  const readOrEnd = byteReader(source)
  const read = async (length) => {
    const bytes = await readOrEnd(length)
    if (!bytes) throw new Error('Encrypted backup is truncated')
    return bytes
  }
  const magic = await readOrEnd(8)
  if (!magic || !magic.equals(FORMAT_V2)) throw new Error('Not a format 2 encrypted backup')
  const headerLength = (await read(4)).readUInt32BE()
  if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) throw new Error('Invalid encrypted backup header')
  const headerBytes = await read(headerLength)
  const header = JSON.parse(headerBytes.toString('utf8'))
  if (header.version !== 2 || !/^[a-f0-9]{16}$/.test(header.noncePrefix || '') || header.cipher !== 'aes-256-gcm' || header.compression !== 'gzip') {
    throw new Error('Unsupported encrypted backup header')
  }
  state.header = header
  const headerHash = sha256(headerBytes)
  const prefix = Buffer.from(header.noncePrefix, 'hex')
  for (let index = 0; ; index += 1) {
    const typeByte = await readOrEnd(1)
    if (!typeByte) throw new Error('Encrypted backup is truncated: no trailer')
    const type = typeByte[0]
    if (type !== DATA && type !== TRAILER) throw new Error('Invalid encrypted backup frame')
    const length = (await read(4)).readUInt32BE()
    if (length > (type === TRAILER ? TRAILER_MAX_BYTES : MAX_FRAME_BYTES)) throw new Error('Encrypted backup frame is too large')
    const ciphertext = length ? await read(length) : Buffer.alloc(0)
    const tag = await read(16)
    const decipher = createDecipheriv('aes-256-gcm', key, nonce(prefix, index))
    decipher.setAAD(frameAad(headerHash, index, type))
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    if (type === TRAILER) {
      if (await readOrEnd(1)) throw new Error('Encrypted backup has data after its trailer')
      state.trailer = JSON.parse(plaintext.toString('utf8'))
      return
    }
    yield plaintext
  }
}

function discard() {
  return new Writable({ write(chunk, encoding, callback) { callback() } })
}

function checkTrailer(trailer, digest) {
  if (!trailer || trailer.version !== 2) throw new Error('Encrypted backup has no valid trailer')
  if (trailer.databaseSha256 !== digest.sha256 || trailer.databaseBytes !== digest.bytes) throw new Error('Backup database checksum mismatch')
}

// Decrypts, decompresses and hashes a format-2 stream without writing the
// database anywhere. Proves the object restores to the recorded bytes.
export async function verifyArchiveStream({ input, encryptionKey }) {
  const state = {}
  const tap = hashTap()
  await pipeline(Readable.from(decryptFrames(input, encryptionKey, state)), createGunzip(), tap, discard())
  const digest = tap.result()
  checkTrailer(state.trailer, digest)
  return { header: state.header, trailer: state.trailer, databaseSha256: digest.sha256, databaseBytes: digest.bytes }
}

// Restores a format-2 stream into a new directory: the database (checked
// for integrity, foreign keys and row counts) and provisioning state. The
// destination must not exist; a failed restore removes only what it made.
export async function restoreArchiveStream({ input, encryptionKey, destination }) {
  await mkdir(destination, { mode: 0o700 })
  try {
    const state = {}
    const tap = hashTap()
    const file = path.join(destination, 'holdfast.sqlite')
    await pipeline(Readable.from(decryptFrames(input, encryptionKey, state)), createGunzip(), tap, createWriteStream(file, { flags: 'wx', mode: 0o600 }))
    const digest = tap.result()
    checkTrailer(state.trailer, digest)
    const counts = verifyBackupDatabase(file)
    if (JSON.stringify(counts) !== JSON.stringify(state.trailer.counts)) throw new Error('Restored row counts do not match the backup')
    if (state.trailer.provisioning !== null && state.trailer.provisioning !== undefined) {
      await writeFile(path.join(destination, 'discord-provisioning-state.json'), JSON.stringify(state.trailer.provisioning), { mode: 0o600, flag: 'wx' })
    }
    return { format: 2, createdAt: state.trailer.createdAt, counts, databaseSha256: digest.sha256, databaseBytes: digest.bytes }
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    throw error
  }
}

export function requiredSnapshotBytes(databaseBytes, walBytes) {
  const copy = databaseBytes + walBytes
  return copy + Math.max(256 * 1024 * 1024, Math.ceil(copy * 0.1))
}

async function sizeOf(file) {
  try {
    return (await stat(file)).size
  } catch {
    return 0
  }
}

// A consistent snapshot of the live database (SQLite's online backup API,
// safe while the application writes), verified before it is used. Written
// under `workDir` only when the disk there has room for it.
export async function createVerifiedSnapshot({ dataDir, workDir, statfsImpl = statfs }) {
  const source = path.join(dataDir, 'holdfast.sqlite')
  const needed = requiredSnapshotBytes(await sizeOf(source), await sizeOf(`${source}-wal`))
  const fs = await statfsImpl(workDir)
  const free = Number(fs.bavail) * Number(fs.bsize)
  if (free < needed) {
    throw Object.assign(new Error(`Backup snapshot needs ${needed} bytes free in the work directory; ${free} available`), { code: 'BACKUP_DISK_FULL' })
  }
  const directory = await mkdtemp(path.join(workDir, 'holdfast-snapshot-'))
  try {
    const file = path.join(directory, 'holdfast.sqlite')
    const db = new DatabaseSync(source, { readOnly: true })
    // One step (every page at once; Node 24 accepts only a positive page
    // count, so the int32 maximum): the copy runs on Node's thread pool under a single
    // read transaction, so the application keeps writing (WAL) and the event
    // loop stays free. With the default 100 pages per step, SQLite restarts
    // the copy whenever another connection writes between steps, and under
    // steady telemetry ingestion a large copy never finishes.
    try { await backup(db, file, { rate: ALL_PAGES }) } finally { db.close() }
    const counts = verifyBackupDatabase(file)
    return { file, bytes: await sizeOf(file), counts, cleanup: () => rm(directory, { recursive: true, force: true }) }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

// The encrypted archive of a verified snapshot as a stream. `digest()`
// returns the database's SHA-256 and size once the stream has ended.
export function encryptSnapshot({ snapshot, encryptionKey, createdAt, provisioning = null }) {
  const header = { version: 2, createdAt, cipher: 'aes-256-gcm', compression: 'gzip', frameBytes: FRAME_BYTES, noncePrefix: randomBytes(8).toString('hex') }
  const tap = hashTap()
  const trailer = () => {
    const digest = tap.result()
    return { version: 2, createdAt, databaseSha256: digest.sha256, databaseBytes: digest.bytes, counts: snapshot.counts, provisioning }
  }
  const output = new PassThrough()
  pipelineCallback(createReadStream(snapshot.file), tap, createGzip({ level: 6 }), frameEncryptor({ encryptionKey, header, trailer }), output, (error) => {
    if (error) output.destroy(error)
  })
  return { stream: output, digest: () => tap.result() }
}
