export function safeReturnTo(value, fallback = '/') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback
  try {
    const decoded = decodeURIComponent(value)
    if (decoded.startsWith('//') || decoded.includes('\\') || [...decoded].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return fallback
    const url = new URL(value, 'https://holdfast.invalid')
    if (url.origin !== 'https://holdfast.invalid' || url.pathname.replace(/\/+$/, '') === '/join') return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

export function currentReturnTo() {
  const url = new URL(window.location.href)
  if (url.pathname.replace(/\/+$/, '') === '/join') return safeReturnTo(url.searchParams.get('returnTo'))
  url.searchParams.delete('auth')
  return safeReturnTo(`${url.pathname}${url.search}${url.hash}`)
}

export function joinHref(returnTo) {
  const destination = safeReturnTo(returnTo)
  return destination === '/' ? '/join' : `/join?${new URLSearchParams({ returnTo: destination })}`
}
