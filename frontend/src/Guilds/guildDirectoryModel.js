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
  return `/${encodeURIComponent(slug)}`
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

// Registration

export const ACCENT_SWATCHES = ['#c4a667', '#b8432f', '#7c2b3b', '#4a7fd4', '#8fa6d8', '#5b8a4e', '#a7783a', '#8a6bc4', '#3fa3a8', '#d8b45a']

export const FIELD_ERRORS = {
  guild_name_required: 'Give your guild a name of at least two characters.',
  guild_slug_invalid: 'Choose a name that makes a usable web address.',
  guild_slug_taken: 'Another guild already has this name. Try a variation.',
  guild_faction_required: 'Choose a faction.',
  guild_region_required: 'Choose a region.',
  guild_realm_required: 'Enter your realm.',
  guild_realm_type_required: 'Choose your realm type.',
  guild_play_style_required: 'Pick at least one play style.',
  guild_timezone_invalid: 'That time zone was not recognised.',
  guild_discord_invite_invalid: 'Use a Discord invite link, like discord.gg/yourguild.',
  guild_raid_window_incomplete: 'Give both a start and an end time.',
}

export function registrationDraft() {
  return {
    name: '', tagline: '', description: '', faction: '', region: 'US', realm: '', realmType: '', language: 'en',
    timezone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' } })(),
    playStyles: [], recruiting: true, recruitingClasses: [], recruitingRoles: [], minimumLevel: 1,
    raidDays: [], raidStart: '', raidEnd: '', voiceRequired: false, agePolicy: 'any', discordInviteUrl: '',
    accentColor: ACCENT_SWATCHES[0],
  }
}

export function draftSlug(name = '') {
  return String(name).trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '')
}

// Which step each server-side field error belongs to, so a rejected
// submission jumps back to the step that needs fixing.
export const FIELD_STEPS = {
  name: 0, slug: 0, faction: 0, region: 0, realm: 0, realmType: 0,
  playStyles: 1, timezone: 1, raidStart: 1,
  discordInviteUrl: 2,
}

export function stepErrors(draft, step) {
  const errors = {}
  if (step === 0) {
    if (draft.name.trim().length < 2) errors.name = 'guild_name_required'
    else if (draftSlug(draft.name).length < 3) errors.name = 'guild_slug_invalid'
    if (!draft.faction) errors.faction = 'guild_faction_required'
    if (draft.realm.trim().length < 2) errors.realm = 'guild_realm_required'
    if (!draft.realmType) errors.realmType = 'guild_realm_type_required'
  }
  if (step === 1) {
    if (!draft.playStyles.length) errors.playStyles = 'guild_play_style_required'
    if (Boolean(draft.raidStart) !== Boolean(draft.raidEnd)) errors.raidStart = 'guild_raid_window_incomplete'
  }
  return errors
}

// The guild as the finder's row and detail will show it, for the live preview.
export function previewGuild(draft) {
  return {
    id: 'preview',
    slug: draftSlug(draft.name) || 'your-guild',
    name: draft.name.trim() || 'Your Guild',
    tagline: draft.tagline.trim() || 'Your motto goes here.',
    description: draft.description.trim(),
    faction: draft.faction || 'alliance',
    region: draft.region,
    realm: draft.realm.trim() || 'Your realm',
    realmType: draft.realmType || 'normal',
    language: draft.language,
    timezone: draft.timezone,
    playStyles: draft.playStyles,
    recruiting: draft.recruiting,
    recruitingClasses: draft.recruitingClasses,
    recruitingRoles: draft.recruitingRoles,
    minimumLevel: draft.minimumLevel,
    voiceRequired: draft.voiceRequired,
    agePolicy: draft.agePolicy,
    discordInviteUrl: draft.discordInviteUrl.trim(),
    schedule: { raidDays: draft.raidDays, raidStart: draft.raidStart, raidEnd: draft.raidEnd },
    accentColor: draft.accentColor,
    stats: { memberCount: 1, activeCharacters: 0, verified: false },
  }
}

// Required fields, in step order, for the step rail's progress meter.
export function registrationProgress(draft) {
  const checks = [
    draft.name.trim().length >= 2 && draftSlug(draft.name).length >= 3,
    Boolean(draft.faction),
    draft.realm.trim().length >= 2,
    Boolean(draft.realmType),
    draft.playStyles.length > 0,
  ]
  return { done: checks.filter(Boolean).length, total: checks.length }
}

// The first step at or after `from` and before `to` that fails validation,
// or -1 when the leader may move straight to `to`.
export function firstInvalidStep(draft, from, to) {
  for (let step = from; step < to; step += 1) {
    if (Object.keys(stepErrors(draft, step)).length) return step
  }
  return -1
}

// Guild finder

// Short class names for dense rows: readable without relying on colour.
export const CLASS_SHORT = {
  warrior: 'War', paladin: 'Pal', hunter: 'Hun', rogue: 'Rog', priest: 'Pri',
  shaman: 'Sha', mage: 'Mag', warlock: 'Lck', druid: 'Dru',
}

// The selected guild lives next to the filters in the query string, so a
// shared link opens the same guild in the same search.
export function selectedGuildFromQuery(queryString = '') {
  const value = new URLSearchParams(queryString).get('guild') || ''
  return /^[a-z0-9-]{2,40}$/.test(value) ? value : ''
}

export function finderHref(filters, selected = '') {
  const params = new URLSearchParams(queryFromFilters(filters).slice(1))
  if (selected) params.set('guild', selected)
  const query = params.toString()
  return query ? `/?${query}` : '/'
}

// Raid days as a compact week strip: which of Mon–Sun are raid nights.
export function weekStrip(raidDays = []) {
  return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => ({
    day,
    label: WEEKDAY_LABELS[day].slice(0, 1),
    active: raidDays.includes(day),
  }))
}

// Activity as a share of the roster, for the row meter.
export function activityShare(stats = {}) {
  const members = Number(stats.memberCount) || 0
  const active = Number(stats.activeCharacters) || 0
  if (!members || !active) return 0
  return Math.min(1, active / members)
}

// Moves the keyboard selection through the visible results.
export function stepSelection(slugs, current, delta) {
  if (!slugs.length) return ''
  const index = slugs.indexOf(current)
  if (index === -1) return delta > 0 ? slugs[0] : slugs[slugs.length - 1]
  return slugs[Math.max(0, Math.min(slugs.length - 1, index + delta))]
}
