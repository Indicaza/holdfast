// Finds the synced (Guildweaver) character for one listed on a profile: by id,
// else by name, for characters listed before their first sync.
export function syncedCharacterIndex(characters = []) {
  const byId = new Map()
  const byName = new Map()
  for (const character of characters) {
    byId.set(character.id, character)
    for (const name of [character.name, character.fullName, character.firstName]) {
      const key = String(name || '').trim().toLowerCase()
      if (key && !byName.has(key)) byName.set(key, character)
    }
  }
  return {
    size: byId.size,
    find(listed) {
      if (!listed) return null
      return byId.get(listed.id) || byName.get(String(listed.name || '').trim().toLowerCase()) || null
    },
  }
}
