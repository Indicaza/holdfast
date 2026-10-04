import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import { MAX_SNAPSHOT_BYTES, restoreEncryptedSnapshot } from '../src/Data/encryptedBackup.js'

dotenv.config()
try {
  const [file, destination] = process.argv.slice(2)
  if (!file || !destination) throw new Error('Usage: npm run backup:restore -- downloaded.hfb /new/restore-directory')
  if ((await stat(file)).size > MAX_SNAPSHOT_BYTES * 2) throw new Error('Archive exceeds the restore size limit')
  const result = await restoreEncryptedSnapshot({ archive: await readFile(file), encryptionKey: process.env.BACKUP_ENCRYPTION_KEY, destination: path.resolve(destination) })
  console.log(JSON.stringify({ destination: path.resolve(destination), ...result }))
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'Restore refused: destination already exists.' : 'Restore failed. Verify the archive, key, and destination.')
  process.exitCode = 1
}
