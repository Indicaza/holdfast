import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { apiFetch, apiJson } from '../Api/apiClient.js'
import { SessionContext } from './sessionContext.js'

function detectedTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

const SYNCED_TIMEZONE_KEY = 'holdfast:timezone-synced'

// Reports the browser's timezone once per member and value per browser
// session, not on every session check (each tab focus runs one).
async function syncDetectedTimezone(userId) {
  const timezone = detectedTimezone()

  if (!timezone) {
    return
  }

  const marker = `${userId}:${timezone}`
  try {
    if (window.sessionStorage.getItem(SYNCED_TIMEZONE_KEY) === marker) return
    window.sessionStorage.setItem(SYNCED_TIMEZONE_KEY, marker)
  } catch {
    // Without session storage this still runs once per page load.
    if (syncDetectedTimezone.sent === marker) return
    syncDetectedTimezone.sent = marker
  }

  try {
    await apiFetch('/api/guild/members/me/timezone', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ timezone }),
    })
  } catch {
    // Timezone sync is best-effort and should never block sign-in.
  }
}

// The same session, so consumers need not rerender after a routine check.
function sameSession(a, b) {
  return a.status === b.status
    && a.authenticated === b.authenticated
    && JSON.stringify([a.user, a.permissions, a.authority]) === JSON.stringify([b.user, b.permissions, b.authority])
}

function currentReturnTo() {
  const url = new URL(window.location.href)
  url.searchParams.delete('auth')
  return `${url.pathname}${url.search}${url.hash}`
}

export function SessionProvider({ children }) {
  const generation = useRef(0)
  const inFlight = useRef(null)
  const [session, setSession] = useState({
    status: 'loading',
    authenticated: false,
    user: null,
    permissions: [],
    authority: null,
  })

  // An explicit retry shows "checking" again; background checks (focus, tab
  // return) leave what is on screen alone until they have an answer, so a
  // click that focuses the window never swaps the button out from under it.
  const refresh = useCallback((options) => {
    if (inFlight.current) return inFlight.current
    if (options?.background !== true) {
      setSession((current) => current.status === 'error' ? { ...current, status: 'loading' } : current)
    }
    const requestGeneration = generation.current
    const request = (async () => {
      try {
        const data = await apiJson('/api/me')
        const nextSession = {
          status: 'ready',
          authenticated: Boolean(data?.authenticated),
          user: data?.user ?? null,
          permissions: data?.permissions ?? [],
          authority: data?.authority ?? null,
        }

        if (requestGeneration !== generation.current) return null
        setSession((current) => (sameSession(current, nextSession) ? current : nextSession))

        if (data?.authenticated && data.user?.id) {
          void syncDetectedTimezone(data.user.id)
        }

        return nextSession
      } catch {
        const nextSession = {
          status: 'error',
          authenticated: false,
          user: null,
          permissions: [],
          authority: null,
        }

        if (requestGeneration !== generation.current) return null
        setSession((current) => (sameSession(current, nextSession) ? current : nextSession))
        return nextSession
      }
    })()
    inFlight.current = request
    void request.finally(() => {
      if (inFlight.current === request) inFlight.current = null
    })
    return request
  }, [])

  useEffect(() => {
    refresh()
    const onFocus = () => void refresh({ background: true })
    const onVisibility = () => {
      if (!document.hidden) void refresh({ background: true })
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh])

  const signIn = useCallback((returnTo = currentReturnTo(), mode = 'member') => {
    const params = new URLSearchParams({ returnTo, mode })
    window.location.assign(`/api/auth/discord?${params.toString()}`)
  }, [])

  const signOut = useCallback(async () => {
    const response = await apiFetch('/api/auth/logout', {
      method: 'POST',
    })

    if (!response.ok) {
      throw new Error('Sign out failed')
    }

    generation.current += 1
    inFlight.current = null
    setSession({
      status: 'ready',
      authenticated: false,
      user: null,
      permissions: [],
      authority: null,
    })
  }, [])

  const value = useMemo(
    () => ({
      ...session,
      refresh,
      signIn,
      signOut,
      hasPermission: (permission) => session.permissions.includes(permission),
    }),
    [refresh, session, signIn, signOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
