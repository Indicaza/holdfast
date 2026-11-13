import { createReadStream } from 'node:fs'
import { open, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import { MAX_SNAPSHOT_BYTES, restoreEncryptedSnapshot } from '../src/Data/encryptedBackup.js'
import { isFormatV2, restoreArchiveStream } from '../src/Data/streamingBackup.js'

// Restores a downloaded .hfb archive into a new directory. Format 2
// (streaming, any size) and format 1 (32 MiB, before November 2026) are
// both accepted; the format is read from the file's first bytes.
dotenv.config()

async function prefix(file) {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(8)
    const { bytesRead } = await handle.read(buffer, 0, 8, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

try {
  const [file, destination] = process.argv.slice(2)
  if (!file || !destination) throw new Error('Usage: npm run backup:restore -- downloaded.hfb /new/restore-directory')
  const target = path.resolve(destination)
  let result
  if (isFormatV2(await prefix(file))) {
    result = await restoreArchiveStream({ input: createReadStream(file), encryptionKey: process.env.BACKUP_ENCRYPTION_KEY, destination: target })
  } else {
    if ((await stat(file)).size > MAX_SNAPSHOT_BYTES * 2) throw new Error('Archive exceeds the format 1 restore size limit')
    result = { format: 1, ...(await restoreEncryptedSnapshot({ archive: await readFile(file), encryptionKey: process.env.BACKUP_ENCRYPTION_KEY, destination: target })) }
  }
  console.log(JSON.stringify({ destination: target, ...result }))
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'Restore refused: destination already exists.' : 'Restore failed. Verify the archive, key, and destination.')
  process.exitCode = 1
}
