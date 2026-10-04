import dotenv from 'dotenv'
import { runOffsiteBackup } from '../src/Data/offsiteBackup.js'

dotenv.config()
try {
  const result = await runOffsiteBackup()
  if (result.status === 'disabled') throw new Error('Set BACKUP_OFFSITE_ENABLED=true and configure storage before running backup:offsite')
  console.log(`Encrypted backup uploaded and restored successfully: ${result.key}`)
} catch {
  console.error('Off-site backup failed. Check storage configuration and credentials.')
  process.exitCode = 1
}
