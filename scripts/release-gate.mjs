import { pathToFileURL } from 'node:url'

export const requiredChecks = ['frontend', 'backend', 'browser-regression', 'production-image']

export function assertReleaseChecks(checks) {
  const failures = requiredChecks.filter((name) => checks?.[name]?.result !== 'success')
  if (failures.length) {
    throw new Error(`Release blocked: ${failures.map((name) => `${name}=${checks?.[name]?.result || 'missing'}`).join(', ')}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assertReleaseChecks(JSON.parse(process.env.RELEASE_CHECKS || '{}'))
    console.log('All release checks passed.')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
