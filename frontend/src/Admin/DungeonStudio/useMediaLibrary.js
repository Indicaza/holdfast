import { useCallback, useEffect, useState } from 'react'

import { apiJson } from '../../Api/apiClient.js'

const API = '/api/admin/atlas-studio'

// The library, loaded once per page and shared by the picker and the tab.
export function useMediaLibrary() {
  const [state, setState] = useState({ status: 'loading', media: [] })
  const reload = useCallback(() => apiJson(`${API}/media`).then((data) => setState({ status: 'ready', media: data.media }))
    .catch(() => setState((current) => ({ ...current, status: 'error' }))), [])
  useEffect(() => { reload() }, [reload])
  return { ...state, reload }
}

