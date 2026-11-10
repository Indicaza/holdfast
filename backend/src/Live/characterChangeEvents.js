import { withGuildDatabase } from '../Data/database.js'
import { HOLDFAST_GUILD_ID } from '../Guild/guildScope.js'
import { publishLiveUpdate } from './liveUpdateBus.js'

// One "character changed" live event per character per burst of telemetry.
// A bridge sync delivers a character's streams one request at a time; viewers
// should refresh once, after the burst, and only when the character's read
// model actually changed. The event names the sections that changed so an
// open character modal can tell whether it needs to refetch.
//
// Only people who can see the character hear about it: its owner, and
// Holdfast's members when the owner is an active Holdfast member (the guild
// workspace lists those characters). Nobody else learns its id.

const COALESCE_MS = 750
const pending = new Map()

function ownerOf(characterId) {
  try {
    return withGuildDatabase((db) => db.prepare(`
      SELECT c.member_id, m.status FROM characters c JOIN members m ON m.id = c.member_id WHERE c.id = ?
    `).get(characterId)) || null
  } catch {
    return null
  }
}

function flush(characterId) {
  const entry = pending.get(characterId)
  if (!entry) return null
  pending.delete(characterId)
  clearTimeout(entry.timer)
  const owner = ownerOf(characterId)
  const memberId = owner?.member_id || entry.memberId
  if (!memberId) return null
  const event = {
    topics: ['intelligence', 'armory'],
    source: 'character.changed',
    entityId: characterId,
    detail: { sections: [...entry.sections].sort() },
  }
  // A Holdfast member's guildmates (and the owner, who is one of them).
  if (owner?.status === 'active') return publishLiveUpdate({ ...event, guildId: HOLDFAST_GUILD_ID })
  return publishLiveUpdate({ ...event, memberId })
}

export function publishCharacterChanged({ characterId, memberId = null, sections = [] } = {}) {
  const id = String(characterId || '').trim()
  if (!id || !sections.length) return
  const entry = pending.get(id) || { sections: new Set(), timer: null, memberId: null }
  for (const section of sections) entry.sections.add(String(section))
  if (memberId) entry.memberId = String(memberId)
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
