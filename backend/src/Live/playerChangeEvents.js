import { publishLiveUpdate } from './liveUpdateBus.js'

// "Your data changed" for one player's dashboard. Only that player's live
// connection receives it (memberId), and a bridge sync's burst of uploads
// becomes one event, so an open dashboard refreshes once per sync.

const COALESCE_MS = 1000
const pending = new Map()

function flush(memberId) {
  const entry = pending.get(memberId)
  if (!entry) return null
  pending.delete(memberId)
  clearTimeout(entry.timer)
  return publishLiveUpdate({ topics: ['player'], source: entry.source, memberId })
}

export function publishPlayerChanged(memberId, source = 'player.sync') {
  const id = String(memberId || '').trim()
  if (!id) return
  const entry = pending.get(id) || { source, timer: null }
  entry.source = source
  if (!entry.timer) {
    entry.timer = setTimeout(() => flush(id), COALESCE_MS)
    entry.timer.unref?.()
  }
  pending.set(id, entry)
}

// Publishes everything waiting now (tests, shutdown).
export function flushPlayerChanges() {
  return [...pending.keys()].map(flush).filter(Boolean)
}
