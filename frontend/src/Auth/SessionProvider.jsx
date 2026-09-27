import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

const SessionContext = createContext(null)

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

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
    await fetch('/api/guild/members/me/timezone', {
      method: 'PATCH',
      credentials: 'include',
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
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch('/api/me', {
          credentials: 'include',
          cache: 'no-store',
        })

        if (!response.ok) {
          throw new Error('Session request failed')
        }

        const data = await response.json()

        setSession({
          status: 'ready',
          authenticated: Boolean(data.authenticated),
          user: data.user ?? null,
          permissions: data.permissions ?? [],
        })

        if (data.authenticated) {
          void syncDetectedTimezone()
        }

        return
      } catch {
        if (attempt < 2) {
          await wait(attempt === 0 ? 120 : 350)
        }
      }
    }

    setSession({
      status: 'error',
      authenticated: false,
      user: null,
      permissions: [],
    })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const signIn = useCallback((returnTo = currentReturnTo(), mode = 'member') => {
    const params = new URLSearchParams({ returnTo, mode })
    window.location.assign(`/api/auth/discord?${params.toString()}`)
  }, [])

  const signOut = useCallback(async () => {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
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

export function useSession() {
  const session = useContext(SessionContext)

  if (!session) {
    throw new Error('useSession must be used inside SessionProvider')
  }

  return session
}
