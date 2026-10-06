import { createContext, useContext } from 'react'

export const LiveUpdatesContext = createContext({
  status: 'offline',
  event: null,
})

export function useLiveUpdates() {
  return useContext(LiveUpdatesContext)
}
