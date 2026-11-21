// The Dungeon Content Studio's editor state, pure: the editorial document
// (backend/src/Atlas/Editorial/editorialSchema.js) and the operations the
// form performs on it. Every operation returns a new document.

export function overrideOf(scope, key) {
  return scope?.[key] || null
}

// Override a field with a value (keeping its verified flag and source).
export function setOverride(document, path, key, value) {
  return updateScope(document, path, (scope) => ({ ...scope, [key]: { verified: false, source: '', ...scope[key], value } }))
}

export function setOverrideMeta(document, path, key, meta) {
  return updateScope(document, path, (scope) => (scope[key] ? { ...scope, [key]: { ...scope[key], ...meta } } : scope))
}

// "Clear override": the field inherits the imported value again.
export function clearOverride(document, path, key) {
  return updateScope(document, path, (scope) => {
    const next = { ...scope }
    delete next[key]
    return next
  })
}

// path: ['dungeon'] or ['bosses', bossKey].
function updateScope(document, path, update) {
  if (path[0] === 'dungeon') return { ...document, dungeon: update(document.dungeon || {}) }
  const bosses = { ...(document.bosses || {}) }
  const next = update(bosses[path[1]] || {})
  if (Object.keys(next).length) bosses[path[1]] = next
  else delete bosses[path[1]]
  return { ...document, bosses }
}

export function scopeOf(document, path) {
  return path[0] === 'dungeon' ? document.dungeon || {} : document.bosses?.[path[1]] || {}
}

// The value a new override starts from: the imported value when there is
// one, else an empty value of the field's kind.
export function initialValue(field, imported) {
  if (imported !== null && imported !== undefined && imported !== '') {
    if (field.kind === 'media') return null
    return structuredClone(imported)
  }
  switch (field.kind) {
    case 'list':
    case 'mechanics':
    case 'lootNotes':
    case 'bossOrder':
      return []
    case 'int':
      return field.min || 1
    case 'location':
      return { mapId: 0, x: 0.5, y: 0.5 }
    case 'media':
      return null
    default:
      return ''
  }
}

// A mechanic id unique within its list, from the ability name.
export function mechanicId(ability, taken = []) {
  const base = String(ability || 'mechanic').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'mechanic'
  if (!taken.includes(base)) return base
  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${index}`
    if (!taken.includes(candidate)) return candidate
  }
}

export function newMechanic(list = []) {
  return { id: mechanicId(`mechanic-${list.length + 1}`, list.map((entry) => entry.id)), ability: '', type: 'special-mechanic', priority: 'medium', instruction: '', roles: [], verified: false, source: '' }
}

export function moveItem(list, index, delta) {
  const target = index + delta
  if (target < 0 || target >= list.length) return list
  const next = list.slice()
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

export function replaceItem(list, index, item) {
  return list.map((entry, position) => (position === index ? item : entry))
}

export function removeItem(list, index) {
  return list.filter((_, position) => position !== index)
}

// Lines of a textarea as a list field's value, and back.
export const linesToList = (text) => String(text || '').split('\n').map((line) => line.trim()).filter(Boolean)
export const listToLines = (list) => (Array.isArray(list) ? list.join('\n') : '')

// "155, -168" → [155, -168]; invalid entries are dropped.
export function parseIds(text) {
  return String(text || '').split(/[\s,]+/).map(Number).filter((id) => Number.isSafeInteger(id) && id !== 0)
}

// The editorial quest plan's operations.
export function setQuestPlan(document, update) {
  const questPlan = update({ ...(document.questPlan || {}) })
  for (const key of Object.keys(questPlan)) if (questPlan[key] === undefined || (Array.isArray(questPlan[key]) && !questPlan[key].length)) delete questPlan[key]
  return { ...document, questPlan }
}

export function newPlanQuest(questId) {
  return { questId, verified: false, source: '' }
}

// A location from three inputs; null when it is not a valid UiMap location.
export function locationFrom({ mapId, x, y, zoneName = '' }) {
  const location = { mapId: Number(mapId), x: Number(x), y: Number(y) }
  if (!Number.isSafeInteger(location.mapId) || location.mapId <= 0) return null
  if (!(location.x >= 0 && location.x <= 1 && location.y >= 0 && location.y <= 1)) return null
  return zoneName ? { ...location, zoneName } : location
}

// How the editor labels a field's state.
export function fieldStatus(resolution) {
  if (!resolution) return { label: 'Inherited', tone: 'neutral' }
  if (resolution.conflict) return { label: 'Conflict: imported value wins', tone: 'danger' }
  if (resolution.winner === 'editorial') return { label: resolution.override?.verified ? 'Override, verified' : 'Override, unverified', tone: resolution.override?.verified ? 'success' : 'gold' }
  if (resolution.winner === 'imported') return { label: 'Inherited', tone: 'neutral' }
  return { label: 'Empty', tone: 'neutral' }
}

// A short text for any imported or effective value.
export function displayValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) {
    if (!value.length) return '—'
    if (typeof value[0] === 'object') return `${value.length} item${value.length === 1 ? '' : 's'}`
    return value.join(' · ')
  }
  if (typeof value === 'object') {
    if ('mapId' in value) return `map ${value.mapId} · ${Number(value.x).toFixed(3)}, ${Number(value.y).toFixed(3)}${value.zoneName ? ` · ${value.zoneName}` : ''}`
    return JSON.stringify(value)
  }
  return String(value)
}

// Validation problems for one path prefix (a field or a boss).
export function problemsAt(validation, prefix) {
  const all = [...(validation?.errors || []).map((entry) => ({ ...entry, level: 'error' })), ...(validation?.warnings || []).map((entry) => ({ ...entry, level: 'warning' }))]
  return all.filter((entry) => entry.path === prefix || entry.path.startsWith(`${prefix}.`) || entry.path.startsWith(`${prefix}[`))
}

export function isDirty(document, saved) {
  return JSON.stringify(document) !== JSON.stringify(saved)
}
