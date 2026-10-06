import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../Auth/sessionContext.js'

const LiveUpdatesContext = createContext({
  status: 'offline',
  event: null,
})

function parsedEvent(event) {
  try {
    const payload = JSON.parse(event.data || '{}')
    return {
      ...payload,
      topics: Array.isArray(payload?.topics) ? payload.topics : [],
      nonce: `${Date.now()}:${Math.random()}`,
    }
  } catch {
    return null
  }
}

export function LiveUpdatesProvider({ children }) {
  const session = useSession()
  const [status, setStatus] = useState('offline')
  const [event, setEvent] = useState(null)
  const connectedOnce = useRef(false)

  useEffect(() => {
    if (!session.authenticated || typeof EventSource === 'undefined') {
      connectedOnce.current = false
      setStatus('offline')
      return undefined
    }

    setStatus(navigator.onLine === false ? 'offline' : 'connecting')
    const source = new EventSource('/api/notifications/live')

    function handleReady() {
      setStatus('live')
      if (connectedOnce.current) {
        setEvent({
          type: 'sync',
          topics: ['*'],
          source: 'stream.reconnected',
          nonce: `${Date.now()}:sync`,
        })
      }
      connectedOnce.current = true
    }

    function handleChange(message) {
      const next = parsedEvent(message)
      if (next) setEvent(next)
      setStatus('live')
    }

    function handleError() {
      setStatus(navigator.onLine === false ? 'offline' : 'reconnecting')
    }

    function handleOffline() {
      setStatus('offline')
    }

    function handleOnline() {
      if (source.readyState !== EventSource.OPEN) setStatus('reconnecting')
    }

    source.addEventListener('ready', handleReady)
    source.addEventListener('change', handleChange)
    source.addEventListener('error', handleError)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)

    return () => {
      source.close()
      source.removeEventListener('ready', handleReady)
      source.removeEventListener('change', handleChange)
      source.removeEventListener('error', handleError)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      connectedOnce.current = false
    }
  }, [session.authenticated])

  const value = useMemo(() => ({ status, event }), [status, event])

  return (
    <LiveUpdatesContext.Provider value={value}>
      {children}
    </LiveUpdatesContext.Provider>
  )
}

export function useLiveUpdates() {
  return useContext(LiveUpdatesContext)
}
