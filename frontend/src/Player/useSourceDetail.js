import { useEffect, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import { sourceDetailUrl } from '../Intelligence/Farming/farmingModel.js'
import { useLiveRefresh } from '../Live/liveUpdatesContext.js'

// One source's drop table and breakdowns, refreshed when someone gathers it.
// Returns the state and a retry.
export function useSourceDetail(sourceKey, filters, itemKey) {
  const [state, setState] = useState({ status: 'loading', detail: null })
  const [version, setVersion] = useState(0)
  const url = sourceDetailUrl(sourceKey, { filters, item: itemKey })
  useLiveRefresh(['farming'], () => setVersion((current) => current + 1), {
    matches: (event) => event.detail?.sourceKey === sourceKey,
    debounceMs: 1000,
  })

  useEffect(() => {
    const controller = new AbortController()
    // Typing a skill range should not fire a request per keystroke.
    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, status: current.detail ? 'refreshing' : 'loading' }))
      apiJson(url, { signal: controller.signal })
        .then((detail) => { if (!controller.signal.aborted) setState({ status: 'ready', detail }) })
        .catch((error) => {
          if (controller.signal.aborted || error?.name === 'AbortError') return
          setState((current) => ({ ...current, status: error?.status === 404 ? 'missing' : 'error' }))
        })
    }, 180)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [url, version])

  return [state, () => setVersion((current) => current + 1)]
}
