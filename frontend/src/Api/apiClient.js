const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const RETRY_DELAYS = [150, 350, 750, 1500]

function abortError() {
  return new DOMException('Request aborted', 'AbortError')
}

function wait(milliseconds, signal) {
  if (!milliseconds) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)

    function onAbort() {
      window.clearTimeout(timer)
      reject(abortError())
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function methodAllowsRetry(method) {
  return method === 'GET' || method === 'HEAD'
}

export class ApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.code = body?.error || null
  }
}

export async function apiFetch(url, options = {}) {
  const {
    attempts,
    retry = true,
    retryStatuses = RETRYABLE_STATUS,
    ...fetchOptions
  } = options

  const method = String(fetchOptions.method || 'GET').toUpperCase()
  const canRetry = retry && methodAllowsRetry(method)
  const maxAttempts = Math.max(
    1,
    Number(attempts) || (canRetry ? RETRY_DELAYS.length + 1 : 1),
  )

  let lastResponse = null
  let lastError = null

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        ...fetchOptions,
      })

      lastResponse = response
      lastError = null

      if (
        response.ok ||
        !canRetry ||
        !retryStatuses.has(response.status) ||
        attempt === maxAttempts - 1
      ) {
        return response
      }
    } catch (error) {
      if (error?.name === 'AbortError' || fetchOptions.signal?.aborted) {
        throw error
      }

      lastError = error

      if (!canRetry || attempt === maxAttempts - 1) {
        throw error
      }
    }

    const delay =
      RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)] || 0
    await wait(delay, fetchOptions.signal)
  }

  if (lastResponse) {
    return lastResponse
  }

  throw lastError || new Error('API request failed')
}

export async function apiJson(url, options = {}) {
  const response = await apiFetch(url, options)
  const raw = await response.text()

  let body = null

  if (raw) {
    try {
      body = JSON.parse(raw)
    } catch {
      body = null
    }
  }

  if (!response.ok) {
    throw new ApiError(
      body?.message || body?.error || `Request failed (${response.status})`,
      {
        status: response.status,
        body,
      },
    )
  }

  return body
}
