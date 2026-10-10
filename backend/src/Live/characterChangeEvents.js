import { publishLiveUpdate } from './liveUpdateBus.js'

// One "character changed" live event per character per burst of telemetry.
// A bridge sync delivers a character's streams one request at a time; viewers
// should refresh once, after the burst, and only when the character's read
// model actually changed. The event names the sections that changed so an
// open character modal can tell whether it needs to refetch.

const COALESCE_MS = 750
const pending = new Map()

function flush(characterId) {
  const entry = pending.get(characterId)
  if (!entry) return null
  pending.delete(characterId)
  clearTimeout(entry.timer)
  return publishLiveUpdate({
    topics: ['intelligence', 'armory'],
    source: 'character.changed',
    entityId: characterId,
    detail: { sections: [...entry.sections].sort() },
  })
}

export function publishCharacterChanged({ characterId, sections = [] } = {}) {
  const id = String(characterId || '').trim()
  if (!id || !sections.length) return
  const entry = pending.get(id) || { sections: new Set(), timer: null }
  for (const section of sections) entry.sections.add(String(section))
  if (!entry.timer) {
    entry.timer = setTimeout(() => flush(id), COALESCE_MS)
    entry.timer.unref?.()
  }
  pending.set(id, entry)
}

// Publishes everything waiting now (tests, shutdown).
export function flushCharacterChanges() {
  return [...pending.keys()].map(flush).filter(Boolean)
}
