import { useCallback, useEffect, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import { useSession } from '../Auth/sessionContext.js'

const emptyStatus = {
  status: 'idle',
  connected: false,
  deviceCount: 0,
  lastSeenAt: null,
  error: null,
}

export function useGuildweaverStatus({ poll = false } = {}) {
  const session = useSession()
  const [state, setState] = useState(emptyStatus)

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (session.status !== 'ready') {
      return null
    }

    if (!session.authenticated) {
      const next = {
        status: 'ready',
        connected: false,
        deviceCount: 0,
        lastSeenAt: null,
        error: null,
      }
      setState(next)
      return next
    }

    if (!quiet) {
      setState((current) => ({ ...current, status: 'loading', error: null }))
    }

    try {
      const payload = await apiJson('/api/guildweaver/status')
      const next = {
        status: 'ready',
        connected: Boolean(payload?.connected),
        deviceCount: Number(payload?.deviceCount) || 0,
        lastSeenAt: payload?.lastSeenAt || null,
        error: null,
      }
      setState(next)
      return next
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'error',
        error,
      }))
      return null
    }
  }, [session.authenticated, session.status])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!session.authenticated) return undefined

    const checkAgain = () => {
      if (!document.hidden) void refresh({ quiet: true })
    }

    window.addEventListener('focus', checkAgain)
    document.addEventListener('visibilitychange', checkAgain)

    return () => {
      window.removeEventListener('focus', checkAgain)
      document.removeEventListener('visibilitychange', checkAgain)
    }
  }, [refresh, session.authenticated])

  useEffect(() => {
    if (!poll || !session.authenticated || state.connected) return undefined

    const interval = window.setInterval(() => {
      void refresh({ quiet: true })
    }, 3000)

    return () => window.clearInterval(interval)
  }, [poll, refresh, session.authenticated, state.connected])

  return {
    ...state,
    refresh,
  }
}
