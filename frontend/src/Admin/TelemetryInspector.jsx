import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  humanizeTelemetryName,
  stringifyTelemetrySectionShareBundle,
  stringifyTelemetryShareBundle,
  telemetryDomainDescriptor,
  telemetryPayloadSections,
  telemetryPreview,
  telemetrySummaryEntries,
} from './telemetryInspectorModel.js'

const PAGE_SIZE = 40

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

async function getJson(url) {
  const response = await fetch(url, { credentials: 'same-origin' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
  return body
}

async function copyText(value) {
  await navigator.clipboard.writeText(value)
}

export default function TelemetryInspector() {
  const [summary, setSummary] = useState(null)
  const [records, setRecords] = useState([])
  const [selected, setSelected] = useState(null)
  const [selectedSectionKey, setSelectedSectionKey] = useState('overview')
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [domain, setDomain] = useState('')
  const [kind, setKind] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [copyState, setCopyState] = useState('')

  const domains = useMemo(() => {
    const names = new Set((summary?.domains || []).map((entry) => entry.domain).filter(Boolean))
    return [...names].sort()
  }, [summary])

  const payloadSections = useMemo(() => telemetryPayloadSections(selected), [selected])
  const selectedSection = useMemo(
    () => payloadSections.find((section) => section.key === selectedSectionKey) || payloadSections[0] || null,
    [payloadSections, selectedSectionKey],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (submittedQuery) params.set('q', submittedQuery)
      if (domain) params.set('domain', domain)
      if (kind) params.set('kind', kind)
      const [summaryBody, historyBody] = await Promise.all([
        getJson('/api/admin/guildweaver/telemetry/summary'),
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
  }, [domain, kind, offset, submittedQuery])

  const selectRecord = useCallback(async (record) => {
    setSelected(record)
    setSelectedSectionKey('overview')
    setDetailLoading(true)
    setCopyState('')
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

  useEffect(() => {
    if (!payloadSections.length) return
    if (!payloadSections.some((section) => section.key === selectedSectionKey)) {
      setSelectedSectionKey(payloadSections[0].key)
    }
  }, [payloadSections, selectedSectionKey])

  const performCopy = async (mode) => {
    if (!selected?.envelope) return
    let value = ''

    if (mode === 'share') value = stringifyTelemetryShareBundle(selected)
    if (mode === 'envelope') value = JSON.stringify(selected.envelope, null, 2)
    if (mode === 'payload') value = JSON.stringify(selected.payload || {}, null, 2)
    if (mode === 'section' && selectedSection) {
      value = stringifyTelemetrySectionShareBundle(selected, selectedSection.key)
    }

    if (!value) return
    await copyText(value)
    setCopyState(mode)
    window.setTimeout(() => setCopyState(''), 1600)
  }

  const descriptor = telemetryDomainDescriptor(selected)

  return (
    <div className="guildweaver-console-embed">
      {summary ? (
        <section className="gw-admin-stats" aria-label="Guildweaver telemetry summary">
          <div><strong>{summary.records}</strong><span>Records</span></div>
          <div><strong>{summary.streams}</strong><span>Streams</span></div>
          <div><strong>{summary.characters}</strong><span>Characters</span></div>
          <div><strong>{summary.devices}</strong><span>Devices</span></div>
          <div><strong>{relativeTime(summary.lastReceivedAt)}</strong><span>Last received</span></div>
        </section>
      ) : null}

      <section className="gw-admin-console">
        <header className="gw-admin-toolbar">
          <form
            className="gw-admin-search"
            onSubmit={(event) => {
              event.preventDefault()
              setOffset(0)
              setSubmittedQuery(query.trim())
            }}
          >
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search stream, event, character, realm, device, or payload…" aria-label="Search Guildweaver telemetry" />
            <select value={domain} onChange={(event) => { setDomain(event.target.value); setOffset(0) }} aria-label="Filter telemetry domain">
              <option value="">All domains</option>
              {domains.map((name) => <option key={name} value={name}>{humanizeTelemetryName(name)}</option>)}
            </select>
            <select value={kind} onChange={(event) => { setKind(event.target.value); setOffset(0) }} aria-label="Filter telemetry kind">
              <option value="">State + events</option>
              <option value="state">State</option>
              <option value="event">Events</option>
            </select>
            <button type="submit">Search</button>
            {(submittedQuery || domain || kind) ? <button type="button" onClick={() => { setQuery(''); setSubmittedQuery(''); setDomain(''); setKind(''); setOffset(0) }}>Clear</button> : null}
          </form>
          <button className="gw-admin-refresh" type="button" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </header>

        {error ? <p className="gw-admin-error">{error}</p> : null}

        <div className="gw-admin-workspace">
          <section className="gw-admin-history" aria-label="Telemetry history">
            <div className="gw-admin-pane-heading">
              <div><span>Telemetry</span><strong>{records.length ? `${offset + 1}–${offset + records.length}` : '0'} shown</strong></div>
            </div>

            {loading && !records.length ? <p className="gw-admin-empty">Loading telemetry…</p> : null}
            {!loading && !records.length ? <p className="gw-admin-empty">No telemetry has reached the server for this view yet.</p> : null}

            <div className="gw-admin-history-list">
              {records.map((record) => {
                const itemDescriptor = telemetryDomainDescriptor(record)
                return (
                  <button
                    key={record.id}
                    type="button"
                    className={`gw-admin-history-item${selected?.id === record.id ? ' is-selected' : ''}`}
                    onClick={() => selectRecord(record)}
                  >
                    <div className="gw-admin-history-title">
                      <strong>{itemDescriptor.label}</strong>
                      <span>#{record.id}</span>
                    </div>
                    <div className="gw-admin-history-meta">
                      <span>{record.kind}</span>
                      <span>{record.eventType}</span>
                      <span>rev {record.revision}</span>
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
            {!selected ? <p className="gw-admin-empty">Select a telemetry record to inspect its canonical server payload.</p> : (
              <>
                <div className="gw-admin-detail-header">
                  <div>
                    <span>{selected.kind} · {selected.eventType} · #{selected.id}</span>
                    <h2>{descriptor.label}</h2>
                    <p>{selected.realm || 'Unknown realm'} · {selected.streamKey}</p>
                  </div>
                  <div className="gw-admin-copy-actions">
                    <button type="button" onClick={() => performCopy('payload')} disabled={!selected.payload}>{copyState === 'payload' ? 'Payload copied' : 'Copy payload'}</button>
                    <button type="button" onClick={() => performCopy('share')} disabled={!selected.envelope}>{copyState === 'share' ? 'Full bundle copied' : 'Copy full bundle'}</button>
                  </div>
                </div>

                <dl className="gw-admin-facts">
                  <div><dt>Captured</dt><dd title={formatTime(selected.capturedAt)}>{relativeTime(selected.capturedAt)}</dd></div>
                  <div><dt>Received</dt><dd title={formatTime(selected.receivedAt)}>{relativeTime(selected.receivedAt)}</dd></div>
                  <div><dt>Kind</dt><dd>{selected.kind}</dd></div>
                  <div><dt>Revision</dt><dd>{selected.revision}</dd></div>
                  <div><dt>Schema</dt><dd>{selected.schemaVersion}</dd></div>
                  <div><dt>Character</dt><dd title={selected.characterId}>{selected.characterId ? `${selected.characterId.slice(0, 12)}…` : '—'}</dd></div>
                  <div><dt>Install</dt><dd title={selected.installationId}>{selected.installationId ? `${selected.installationId.slice(0, 12)}…` : '—'}</dd></div>
                  <div><dt>Device</dt><dd title={selected.deviceId}>{selected.deviceId ? `${selected.deviceId.slice(0, 12)}…` : '—'}</dd></div>
                </dl>

                <div className="gw-admin-payload-heading">
                  <div><span>Payload summary</span><strong>{formatBytes(selected.payloadBytes)}</strong></div>
                  {detailLoading ? <span>Loading canonical payload…</span> : null}
                </div>

                {selected.payload ? (
                  <div className="gw-admin-json-summary">
                    {telemetrySummaryEntries(selected).map(([key, value]) => (
                      <div key={key}><span>{humanizeTelemetryName(key)}</span><strong>{telemetryPreview(value)}</strong></div>
                    ))}
                  </div>
                ) : null}

                {payloadSections.length ? (
                  <section className="gw-admin-section-inspector" aria-label="Payload sections">
                    <div className="gw-admin-payload-heading">
                      <div><span>Focus payload</span><strong>{payloadSections.length} sections</strong></div>
                      <button type="button" onClick={() => performCopy('section')} disabled={!selectedSection}>
                        {copyState === 'section' ? 'Section copied for ChatGPT' : 'Copy selected section'}
                      </button>
                    </div>
                    <div className="gw-admin-section-tabs" role="tablist" aria-label="Choose payload section">
                      {payloadSections.map((section) => (
                        <button
                          key={section.key}
                          type="button"
                          role="tab"
                          aria-selected={selectedSection?.key === section.key}
                          className={selectedSection?.key === section.key ? 'is-selected' : ''}
                          onClick={() => setSelectedSectionKey(section.key)}
                        >
                          <span>{section.label}</span>
                          <small>{formatBytes(section.bytes)}</small>
                        </button>
                      ))}
                    </div>
                    <div className="gw-admin-section-heading">
                      <div>
                        <strong>{selectedSection?.label || 'Payload'}</strong>
                        <span>{selectedSection ? formatBytes(selectedSection.bytes) : '0 B'}</span>
                      </div>
                      <button type="button" onClick={() => performCopy('section')} disabled={!selectedSection}>
                        {copyState === 'section' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <pre className="gw-admin-json gw-admin-section-json"><code>{selectedSection ? JSON.stringify(selectedSection.value, null, 2) : 'No section selected.'}</code></pre>
                  </section>
                ) : null}

                <details className="gw-admin-envelope">
                  <summary>
                    <span>Full canonical envelope</span>
                    <strong>{selected.eventType}</strong>
                  </summary>
                  <div className="gw-admin-envelope-actions">
                    <button type="button" onClick={() => performCopy('envelope')}>{copyState === 'envelope' ? 'Envelope copied' : 'Copy envelope'}</button>
                  </div>
                  <pre className="gw-admin-json"><code>{selected.envelope ? JSON.stringify(selected.envelope, null, 2) : 'Loading canonical payload…'}</code></pre>
                </details>
              </>
            )}
          </section>
        </div>
      </section>
    </div>
  )
}
