export const TELEMETRY_SHARE_FORMAT = 'guildweaver.telemetry-share.v1'

const DOMAIN_ADAPTERS = {
  character: {
    label: 'Character',
    summaryKeys: ['name', 'realm', 'level', 'class', 'race', 'specialization', 'reason'],
  },
}

export function humanizeTelemetryName(value) {
  return String(value || 'unknown')
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
    const preferred = value.name || value.label || value.id
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

export function buildTelemetryShareBundle(record) {
  return {
    format: TELEMETRY_SHARE_FORMAT,
    metadata: {
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
    },
    envelope: record?.envelope || null,
  }
}

export function stringifyTelemetryShareBundle(record) {
  return JSON.stringify(buildTelemetryShareBundle(record), null, 2)
}
