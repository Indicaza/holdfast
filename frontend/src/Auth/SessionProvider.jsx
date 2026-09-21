import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

const SessionContext = createContext(null)

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
      const response = await fetch('/api/me', { credentials: 'include' })

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
    } catch {
      setSession({
        status: 'error',
        authenticated: false,
        user: null,
        permissions: [],
      })
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const signIn = useCallback((returnTo = currentReturnTo()) => {
    const params = new URLSearchParams({ returnTo })
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
