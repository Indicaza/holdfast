import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../Auth/sessionContext.js'
import { LiveUpdatesContext } from './liveUpdatesContext.js'

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
  const listeners = useRef(new Set())
  const connectedOnce = useRef(false)

  const subscribe = useCallback((listener) => {
    listeners.current.add(listener)
    return () => listeners.current.delete(listener)
  }, [])

  const publish = useCallback((event) => {
    for (const listener of [...listeners.current]) {
      try {
        listener(event)
      } catch (error) {
        console.error('Live update listener failed', error)
      }
    }
  }, [])

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
        publish({
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
      if (next) publish(next)
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
  }, [publish, session.authenticated])

  const value = useMemo(() => ({ status, subscribe }), [status, subscribe])

  return (
    <LiveUpdatesContext.Provider value={value}>
      {children}
    </LiveUpdatesContext.Provider>
  )
}
