import {
  useCallback,
  useEffect,
  useMemo,
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
  const [session, setSession] = useState({
    status: 'loading',
    authenticated: false,
    user: null,
    permissions: [],
  })

  const refresh = useCallback(async () => {
    try {
      const data = await apiJson('/api/me')
      const nextSession = {
        status: 'ready',
        authenticated: Boolean(data?.authenticated),
        user: data?.user ?? null,
        permissions: data?.permissions ?? [],
      }

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
      }

      setSession(nextSession)
      return nextSession
    }
  }, [])

  useEffect(() => {
    refresh()
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

    setSession({
      status: 'ready',
      authenticated: false,
      user: null,
      permissions: [],
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

