import { useCallback, useEffect, useMemo, useState } from 'react'

import './Admin.css'
import './GuildweaverAdmin.css'

const PAGE_SIZE = 30

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function relativeTime(value) {
  if (!value) return 'never'
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return 'unknown'
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function formatBytes(value) {
  const bytes = Number(value) || 0
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
}

function valuePreview(value) {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (typeof value === 'object') return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? '' : 's'}`
  return String(value)
}

function humanize(value) {
  return String(value || 'unknown')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function shortId(value) {
  const text = String(value || '')
  if (!text) return '—'
  return text.length > 14 ? `${text.slice(0, 10)}…` : text
}

async function getJson(url) {
  const response = await fetch(url, { credentials: 'same-origin' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
  return body
}

function collectorHealthSummary(payload) {
  const queue = payload?.eventQueue || {}
  const observed = payload?.observed || {}
  return [
    ['Addon', payload?.addonVersion || '—'],
    ['SV schema', payload?.savedVariablesSchemaVersion ?? '—'],
    ['State streams', observed.stateStreamCount ?? '—'],
    ['Professions', observed.professionCount ?? '—'],
    ['Recipes', observed.knownRecipeCount ?? '—'],
    ['Event queue', `${queue.queued ?? 0}/${queue.capacity ?? 0}`],
    ['Dropped', queue.dropped ?? 0],
    ['Talent API', observed.talentApi || '—'],
  ]
}

const DOMAIN_RENDERERS = {
  collector_health_snapshot: {
    title: 'Collector health',
    summary: collectorHealthSummary,
  },
}

function domainRenderer(record) {
  return DOMAIN_RENDERERS[record?.eventType] || {
    title: humanize(record?.eventType),
    summary: null,
  }
}

function shareReport(record) {
  if (!record) return null
  return {
    reportVersion: 1,
    source: 'Guildweaver Telemetry Oscilloscope',
    copiedAt: new Date().toISOString(),
    record: {
      id: record.id,
      kind: record.kind,
      eventType: record.eventType,
      streamKey: record.streamKey,
      revision: record.revision,
      schemaVersion: record.schemaVersion,
      capturedAt: record.capturedAt,
      receivedAt: record.receivedAt,
      realm: record.realm,
      region: record.region,
      installationId: record.installationId,
      characterId: record.characterId,
      guildId: record.guildId,
      deviceId: record.deviceId,
      memberId: record.memberId,
      gameBuild: record.gameBuild,
    },
    envelope: record.envelope,
  }
}

function SummaryGrid({ entries }) {
  if (!entries?.length) return null
  return (
    <div className="gw-admin-json-summary">
      {entries.map(([key, value]) => (
        <div key={key}><span>{key}</span><strong>{valuePreview(value)}</strong></div>
      ))}
    </div>
  )
}

export default function GuildweaverConsole() {
  const [summary, setSummary] = useState(null)
  const [records, setRecords] = useState([])
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [kind, setKind] = useState('')
  const [eventType, setEventType] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  const telemetrySummary = summary?.telemetry || null
  const eventTypes = useMemo(
    () => telemetrySummary?.eventTypes || [],
    [telemetrySummary],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (submittedQuery) params.set('q', submittedQuery)
      if (kind) params.set('kind', kind)
      if (eventType) params.set('eventType', eventType)
      const [summaryBody, historyBody] = await Promise.all([
        getJson('/api/admin/guildweaver/summary'),
        getJson(`/api/admin/guildweaver/telemetry?${params}`),
      ])
      setSummary(summaryBody.summary)
      setRecords(historyBody.records || [])
      setHasMore(Boolean(historyBody.pagination?.hasMore))
    } catch (loadError) {
      setError(loadError.message || 'Unable to load Guildweaver telemetry.')
    } finally {
      setLoading(false)
    }
  }, [eventType, kind, offset, submittedQuery])

  const selectRecord = useCallback(async (record) => {
    setSelected(record)
    setDetailLoading(true)
    setCopied('')
    try {
      const body = await getJson(`/api/admin/guildweaver/telemetry/${record.id}`)
      setSelected(body.record)
    } catch (detailError) {
      setError(detailError.message || 'Unable to load telemetry payload.')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!records.length) {
      setSelected(null)
      return
    }
    if (!selected || !records.some((record) => record.id === selected.id)) {
      selectRecord(records[0])
    }
  }, [records, selected, selectRecord])

  const copyJson = async (value, label) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2))
      setCopied(label)
      window.setTimeout(() => setCopied(''), 1600)
    } catch {
      setError('Clipboard access failed. Select the JSON below and copy it manually.')
    }
  }

  const renderer = selected ? domainRenderer(selected) : null
  const domainSummary = renderer?.summary ? renderer.summary(selected?.payload) : null

  return (
    <div className="guildweaver-console-embed">
      {telemetrySummary ? (
        <section className="gw-admin-stats" aria-label="Guildweaver telemetry summary">
          <div><strong>{telemetrySummary.records}</strong><span>Records</span></div>
          <div><strong>{telemetrySummary.domains}</strong><span>Domains</span></div>
          <div><strong>{telemetrySummary.states}</strong><span>State</span></div>
          <div><strong>{telemetrySummary.events}</strong><span>Events</span></div>
          <div><strong>{relativeTime(telemetrySummary.lastReceivedAt)}</strong><span>Last received</span></div>
        </section>
      ) : null}

      <section className="gw-admin-console">
        <header className="gw-admin-toolbar gw-admin-toolbar--stacked">
          <form
            className="gw-admin-search"
            onSubmit={(event) => {
              event.preventDefault()
              setOffset(0)
              setSubmittedQuery(query.trim())
            }}
          >
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search stream, realm, character, device, or payload…" aria-label="Search Guildweaver telemetry" />
            <button type="submit">Search</button>
            {submittedQuery ? <button type="button" onClick={() => { setQuery(''); setSubmittedQuery(''); setOffset(0) }}>Clear</button> : null}
          </form>
          <button className="gw-admin-refresh" type="button" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </header>

        <div className="gw-admin-filters" aria-label="Telemetry filters">
          <select value={kind} onChange={(event) => { setKind(event.target.value); setOffset(0) }} aria-label="Filter by telemetry kind">
            <option value="">All records</option>
            <option value="state">State</option>
            <option value="event">Events</option>
          </select>
          <select value={eventType} onChange={(event) => { setEventType(event.target.value); setOffset(0) }} aria-label="Filter by telemetry domain">
            <option value="">All domains</option>
            {eventTypes.map((domain) => (
              <option key={`${domain.kind}:${domain.eventType}`} value={domain.eventType}>
                {humanize(domain.eventType)} ({domain.count})
              </option>
            ))}
          </select>
          <span>{telemetrySummary?.installations || 0} installation{telemetrySummary?.installations === 1 ? '' : 's'} · {telemetrySummary?.characters || 0} character{telemetrySummary?.characters === 1 ? '' : 's'}</span>
        </div>

        {error ? <p className="gw-admin-error">{error}</p> : null}

        <div className="gw-admin-workspace">
          <section className="gw-admin-history" aria-label="Telemetry history">
            <div className="gw-admin-pane-heading">
              <div><span>Telemetry</span><strong>{records.length ? `${offset + 1}–${offset + records.length}` : '0'} shown</strong></div>
            </div>

            {loading && !records.length ? <p className="gw-admin-empty">Loading telemetry…</p> : null}
            {!loading && !records.length ? (
              <p className="gw-admin-empty">No generic telemetry has reached the oscilloscope for this view yet.</p>
            ) : null}

            <div className="gw-admin-history-list">
              {records.map((record) => {
                const definition = domainRenderer(record)
                return (
                  <button
                    key={record.id}
                    type="button"
                    className={`gw-admin-history-item${selected?.id === record.id ? ' is-selected' : ''}`}
                    onClick={() => selectRecord(record)}
                  >
                    <div className="gw-admin-history-title">
                      <strong>{definition.title}</strong>
                      <span>#{record.id}</span>
                    </div>
                    <div className="gw-admin-history-meta">
                      <span className={`gw-admin-kind gw-admin-kind--${record.kind}`}>{record.kind}</span>
                      <span>rev {record.revision}</span>
                      <span>{record.realm || 'Unknown realm'}</span>
                    </div>
                    <div className="gw-admin-history-time">
                      <span>{relativeTime(record.receivedAt)}</span>
                      <span>{formatBytes(record.payloadBytes)}</span>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="gw-admin-pagination">
              <button type="button" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Newer</button>
              <button type="button" disabled={!hasMore || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>Older</button>
            </div>
          </section>

          <section className="gw-admin-detail" aria-label="Telemetry detail">
            {!selected ? <p className="gw-admin-empty">Select a telemetry record to inspect the exact payload.</p> : (
              <>
                <div className="gw-admin-detail-header">
                  <div>
                    <span>{selected.kind} · record #{selected.id}</span>
                    <h2>{renderer.title}</h2>
                    <p>{selected.realm || 'Unknown realm'} · {shortId(selected.characterId)} · revision {selected.revision}</p>
                  </div>
                  <div className="gw-admin-copy-actions">
                    <button type="button" onClick={() => copyJson(shareReport(selected), 'report')} disabled={!selected.envelope}>{copied === 'report' ? 'Report copied' : 'Copy report'}</button>
                    <button type="button" onClick={() => copyJson(selected.payload, 'payload')} disabled={!selected.payload}>{copied === 'payload' ? 'Payload copied' : 'Copy payload'}</button>
                  </div>
                </div>

                <dl className="gw-admin-facts">
                  <div><dt>Captured</dt><dd title={formatTime(selected.capturedAt)}>{relativeTime(selected.capturedAt)}</dd></div>
                  <div><dt>Received</dt><dd title={formatTime(selected.receivedAt)}>{relativeTime(selected.receivedAt)}</dd></div>
                  <div><dt>Schema</dt><dd>{selected.schemaVersion}</dd></div>
                  <div><dt>Revision</dt><dd>{selected.revision}</dd></div>
                  <div><dt>Stream</dt><dd title={selected.streamKey}>{selected.streamKey}</dd></div>
                  <div><dt>Device</dt><dd title={selected.deviceId}>{shortId(selected.deviceId)}</dd></div>
                  <div><dt>Installation</dt><dd title={selected.installationId}>{shortId(selected.installationId)}</dd></div>
                  <div><dt>Character</dt><dd title={selected.characterId}>{shortId(selected.characterId)}</dd></div>
                </dl>

                {domainSummary ? (
                  <div className="gw-admin-domain-summary">
                    <div className="gw-admin-payload-heading"><div><span>Domain summary</span><strong>optional renderer</strong></div></div>
                    <SummaryGrid entries={domainSummary} />
                  </div>
                ) : null}

                <div className="gw-admin-payload-heading">
                  <div><span>Canonical payload</span><strong>{formatBytes(selected.payloadBytes)}</strong></div>
                  {detailLoading ? <span>Loading full payload…</span> : <span>{humanize(selected.eventType)}</span>}
                </div>

                {selected.payload ? <SummaryGrid entries={Object.entries(selected.payload)} /> : null}

                <pre className="gw-admin-json"><code>{selected.payload ? JSON.stringify(selected.payload, null, 2) : 'Loading canonical payload…'}</code></pre>
              </>
            )}
          </section>
        </div>
      </section>
    </div>
  )
}
