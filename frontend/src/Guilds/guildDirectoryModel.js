// The guild browser's vocabulary, filter state and display formatting. Pure:
// shared by the browser, the guild page and the tests.

import { classIdentity } from '../Intelligence/classIdentity.js'

export const FACTION_LABELS = { alliance: 'Alliance', horde: 'Horde' }

export const REALM_TYPE_LABELS = {
  normal: 'Normal',
  pvp: 'PvP',
  rp: 'Roleplay',
  rp_pvp: 'RP-PvP',
  hardcore: 'Hardcore',
}

export const PLAY_STYLE_LABELS = {
  raiding: 'Raiding',
  pvp: 'PvP',
  leveling: 'Leveling',
  casual: 'Casual',
  social: 'Social',
  roleplay: 'Roleplay',
  hardcore: 'Hardcore',
  economy: 'Gold & crafting',
  mentorship: 'Mentorship',
}

export const CLASS_LABELS = {
  warrior: 'Warrior',
  paladin: 'Paladin',
  hunter: 'Hunter',
  rogue: 'Rogue',
  priest: 'Priest',
  shaman: 'Shaman',
  mage: 'Mage',
  warlock: 'Warlock',
  druid: 'Druid',
}

export const ROLE_LABELS = { tank: 'Tank', healer: 'Healer', dps: 'Damage' }

export const REGION_LABELS = { US: 'North America', EU: 'Europe', OCE: 'Oceania', KR: 'Korea', TW: 'Taiwan', CN: 'China' }

export const LANGUAGE_LABELS = {
  en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', pt: 'Português', it: 'Italiano', ru: 'Русский', ko: '한국어', zh: '中文',
}

export const WEEKDAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }

export const SORT_LABELS = { active: 'Most active', newest: 'Newest', members: 'Largest', name: 'A–Z' }

export const FACTION_COLORS = { alliance: '#4a7fd4', horde: '#c8463c' }

const MULTI = ['faction', 'realmType', 'style', 'region', 'language']
const SINGLE = ['q', 'class', 'role', 'day', 'sort']

export function emptyFilters() {
  return { q: '', faction: [], realmType: [], style: [], region: [], language: [], class: '', role: '', day: '', recruiting: false, sort: 'active' }
}

// Filters live in the query string, so a search can be shared and survives
// Back/Forward.
export function filtersFromQuery(queryString = '') {
  const params = new URLSearchParams(queryString)
  const filters = emptyFilters()
  for (const key of MULTI) {
    filters[key] = (params.get(key) || '').split(',').map((value) => value.trim()).filter(Boolean)
  }
  for (const key of SINGLE) {
    const value = params.get(key)
    if (value) filters[key] = value.trim().slice(0, 64)
  }
  filters.recruiting = params.get('recruiting') === '1'
  return filters
}

export function queryFromFilters(filters) {
  const params = new URLSearchParams()
  for (const key of MULTI) {
    if (filters[key]?.length) params.set(key, filters[key].join(','))
  }
  for (const key of SINGLE) {
    if (filters[key] && !(key === 'sort' && filters[key] === 'active')) params.set(key, filters[key])
  }
  if (filters.recruiting) params.set('recruiting', '1')
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function toggleValue(list, value) {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]
}

export function activeFilterCount(filters) {
  return MULTI.reduce((sum, key) => sum + filters[key].length, 0)
    + ['class', 'role', 'day', 'q'].filter((key) => filters[key]).length
    + (filters.recruiting ? 1 : 0)
}

export function guildPath(slug) {
  return `/guilds/${encodeURIComponent(slug)}`
}

function hour(value) {
  const [h, m] = String(value || '').split(':').map(Number)
  if (!Number.isInteger(h)) return ''
  const suffix = h >= 12 ? 'pm' : 'am'
  const twelve = h % 12 || 12
  return m ? `${twelve}:${String(m).padStart(2, '0')}${suffix}` : `${twelve}${suffix}`
}

const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export function scheduleSummary(schedule = {}, timezone = '') {
  const days = WEEK.filter((day) => schedule.raidDays?.includes(day)).map((day) => WEEKDAY_LABELS[day])
  const window = schedule.raidStart && schedule.raidEnd ? `${hour(schedule.raidStart)}–${hour(schedule.raidEnd)}` : ''
  const zone = timezone ? timezone.split('/').pop().replace(/_/g, ' ') : ''
  if (!days.length && !window) return 'Flexible schedule'
  return [days.join(' · '), window, window && zone ? zone : ''].filter(Boolean).join(' ')
}

export function sizeLabel(stats = {}) {
  const count = stats.memberCount || 0
  return `${count.toLocaleString()} ${count === 1 ? 'member' : 'members'}`
}

// Class mix as ordered segments for the roster bar: largest first, class
// colors from the game.
export function classMixSegments(classMix = {}) {
  const total = Object.values(classMix).reduce((sum, value) => sum + value, 0)
  if (!total) return []
  return Object.entries(classMix)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([token, count]) => ({
      token,
      label: CLASS_LABELS[token] || token,
      count,
      share: count / total,
      color: classIdentity(token).color,
    }))
}

export function classColor(token) {
  return classIdentity(token).color
}

export function lastActiveLabel(lastActiveAt, now = Date.now()) {
  if (!lastActiveAt) return ''
  const minutes = Math.max(0, Math.round((now - new Date(lastActiveAt).getTime()) / 60000))
  if (minutes < 60) return 'Active now'
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Active ${hours}h ago`
  const days = Math.round(hours / 24)
  return `Active ${days}d ago`
}

export function guildInitials(name = '') {
  const words = String(name).trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase()
}
