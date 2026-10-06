export const TELEMETRY_SHARE_FORMAT = 'guildweaver.telemetry-share.v1'
export const TELEMETRY_SECTION_SHARE_FORMAT = 'guildweaver.telemetry-section-share.v1'

const DOMAIN_ADAPTERS = {
  character: {
    label: 'Character',
    summaryKeys: ['name', 'realm', 'level', 'class', 'race', 'specialization'],
  },
  talent_tree: {
    label: 'Talent Tree',
    summaryKeys: ['class', 'treeId', 'sourceApi', 'kind', 'gameBuild'],
  },
}

const FIELD_LABELS = {
  activeEntryId: 'Active Entry ID',
  activeEntryRank: 'Active Entry Rank',
  addonVersion: 'Addon Version',
  bonusIds: 'Bonus IDs',
  characterId: 'Character ID',
  characterKey: 'Character Key',
  classId: 'Class ID',
  configId: 'Config ID',
  craftedItemId: 'Crafted Item ID',
  definitionId: 'Definition ID',
  enchantId: 'Enchant ID',
  gemItemIds: 'Gem Item IDs',
  iconFileDataId: 'Icon FileDataID',
  instanceDifficultyId: 'Instance Difficulty ID',
  itemId: 'Item ID',
  itemLevel: 'Item Level',
  linkLevel: 'Link Level',
  maxSkillLevel: 'Max Skill Level',
  qualityId: 'Quality ID',
  rawItemString: 'Raw Item String',
  recipeId: 'Recipe ID',
  schemaVersion: 'Schema Version',
  skillLineAbilityId: 'Skill Line Ability ID',
  skillLineId: 'Skill Line ID',
  specializationId: 'Specialization ID',
  spellId: 'Spell ID',
  treeId: 'Tree ID',
  treeIds: 'Tree IDs',
  upgradeTypeId: 'Upgrade Type ID',
}

const OVERVIEW_KEYS = [
  'name',
  'realm',
  'level',
  'class',
  'race',
  'bodyType',
  'sex',
  'specialization',
  'addonVersion',
  'schemaVersion',
  'capturedAt',
  'characterKey',
  'characterId',
  'gameBuild',
]

export function humanizeTelemetryName(value) {
  const key = String(value || 'unknown')
  if (FIELD_LABELS[key]) return FIELD_LABELS[key]
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function telemetryDomainDescriptor(record) {
  const domain = String(record?.domain || 'unknown')
  const adapter = DOMAIN_ADAPTERS[domain]
  return {
    domain,
    label: adapter?.label || humanizeTelemetryName(domain),
    summaryKeys: adapter?.summaryKeys || [],
  }
}

export function telemetryPreview(value) {
  if (value === null) return 'null'
  if (value === undefined) return '—'
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (typeof value === 'object') {
    const preferred = value.name || value.label || value.token || value.id
    return preferred ? String(preferred) : `${Object.keys(value).length} fields`
  }
  return String(value)
}

export function telemetrySummaryEntries(record) {
  const payload = record?.payload && typeof record.payload === 'object' ? record.payload : {}
  const descriptor = telemetryDomainDescriptor(record)
  const preferred = descriptor.summaryKeys
    .filter((key) => Object.prototype.hasOwnProperty.call(payload, key))
    .map((key) => [key, payload[key]])

  if (preferred.length) return preferred
  return Object.entries(payload).slice(0, 12)
}

function jsonBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length
  } catch {
    return 0
  }
}

function overviewPayload(payload) {
  const overview = {}
  for (const key of OVERVIEW_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) overview[key] = payload[key]
  }

  if (Object.keys(overview).length) return overview

  for (const [key, value] of Object.entries(payload)) {
    if (Array.isArray(value)) continue
    if (value && typeof value === 'object' && Object.keys(value).length > 8) continue
    overview[key] = value
    if (Object.keys(overview).length >= 12) break
  }
  return overview
}

export function telemetryPayloadSections(record) {
  const payload = record?.payload && typeof record.payload === 'object' ? record.payload : {}
  const overview = overviewPayload(payload)
  const sections = []

  if (Object.keys(overview).length) {
    sections.push({
      key: 'overview',
      label: 'Overview',
      value: overview,
      bytes: jsonBytes(overview),
    })
  }

  for (const [key, value] of Object.entries(payload)) {
    if (Object.prototype.hasOwnProperty.call(overview, key)) continue
    if (value === undefined) continue
    sections.push({
      key,
      label: humanizeTelemetryName(key),
      value,
      bytes: jsonBytes(value),
    })
  }

  return sections
}

function collectReferenceIds(value, refs, depth = 0) {
  if (depth > 16 || value === null || value === undefined) return
  if (Array.isArray(value)) {
    for (const entry of value) collectReferenceIds(entry, refs, depth + 1)
    return
  }
  if (typeof value !== 'object') return

  for (const [key, entry] of Object.entries(value)) {
    if (key === 'itemId' || key === 'craftedItemId') {
      const id = Number(entry)
      if (Number.isInteger(id) && id > 0) refs.itemIds.add(id)
    } else if (key === 'spellId') {
      const id = Number(entry)
      if (Number.isInteger(id) && id > 0) refs.spellIds.add(id)
    } else if (key === 'iconFileDataId') {
      const id = Number(entry)
      if (Number.isInteger(id) && id > 0) refs.iconFileDataIds.add(id)
    }
    collectReferenceIds(entry, refs, depth + 1)
  }
}

export function telemetryExternalReferences(record) {
  const refs = {
    itemIds: new Set(),
    spellIds: new Set(),
    iconFileDataIds: new Set(),
  }
  collectReferenceIds(record?.payload, refs)
  return {
    itemIds: [...refs.itemIds].sort((a, b) => a - b),
    spellIds: [...refs.spellIds].sort((a, b) => a - b),
    iconFileDataIds: [...refs.iconFileDataIds].sort((a, b) => a - b),
  }
}

function shareMetadata(record) {
  return {
    recordId: record?.id ?? null,
    streamKey: record?.streamKey || '',
    kind: record?.kind || '',
    domain: record?.domain || '',
    eventType: record?.eventType || '',
    revision: record?.revision ?? null,
    schemaVersion: record?.schemaVersion ?? null,
    characterId: record?.characterId || '',
    installationId: record?.installationId || '',
    deviceId: record?.deviceId || '',
    realm: record?.realm || '',
    region: record?.region || '',
    capturedAt: record?.capturedAt || null,
    receivedAt: record?.receivedAt || null,
  }
}

export function buildTelemetryShareBundle(record) {
  return {
    format: TELEMETRY_SHARE_FORMAT,
    metadata: shareMetadata(record),
    envelope: record?.envelope || null,
  }
}

export function stringifyTelemetryShareBundle(record) {
  return JSON.stringify(buildTelemetryShareBundle(record), null, 2)
}

export function buildTelemetrySectionShareBundle(record, sectionKey) {
  const section = telemetryPayloadSections(record).find((entry) => entry.key === sectionKey)
  if (!section) return null

  return {
    format: TELEMETRY_SECTION_SHARE_FORMAT,
    metadata: shareMetadata(record),
    section: {
      key: section.key,
      label: section.label,
      payload: section.value,
    },
  }
}

export function stringifyTelemetrySectionShareBundle(record, sectionKey) {
  const bundle = buildTelemetrySectionShareBundle(record, sectionKey)
  return bundle ? JSON.stringify(bundle, null, 2) : ''
}
