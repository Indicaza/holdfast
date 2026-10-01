const LEGACY_HOME_PATH = '/guildos'

export function normalizePathname(pathname) {
  return pathname.replace(/\/+$/, '') || '/'
}

export function resolvePathname(pathname, knownPathnames) {
  const normalized = normalizePathname(pathname)
  const resolved = isLegacyHomePath(normalized) ? '/' : normalized

  if (knownPathnames.includes(resolved)) {
    return resolved
  }

  if (/^\/members\/[^/]+$/.test(resolved)) {
    return resolved
  }

  return null
}

export function isLegacyHomePath(pathname) {
  return normalizePathname(pathname) === LEGACY_HOME_PATH
}
