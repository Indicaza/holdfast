export function normalizePathname(pathname) {
  return pathname.replace(/\/+$/, '') || '/'
}

export function resolvePathname(pathname, knownPathnames) {
  const normalized = normalizePathname(pathname)
  const resolved = normalized === '/guildos' ? '/' : normalized

  if (knownPathnames.includes(resolved)) {
    return resolved
  }

  if (/^\/members\/[^/]+$/.test(resolved)) {
    return resolved
  }

  return null
}
