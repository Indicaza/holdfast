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

async function syncDetectedTimezone() {
  const timezone = detectedTimezone()

  if (!timezone) {
    return
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

  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current
    setSession((current) => current.status === 'error' ? { ...current, status: 'loading' } : current)
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
        setSession(nextSession)

        if (data?.authenticated) {
          void syncDetectedTimezone()
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
        setSession(nextSession)
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
    const onVisibility = () => {
      if (!document.hidden) void refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', refresh)
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
