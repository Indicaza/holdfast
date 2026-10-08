import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  humanizeTelemetryName,
  sortTelemetryRecordsNewest,
  stringifyTelemetrySectionShareBundle,
  stringifyTelemetryShareBundle,
  telemetryDomainDescriptor,
  telemetryPayloadLabel,
  telemetryPayloadSections,
  telemetrySessionInfo,
  telemetrySinceForWindow,
  telemetrySourceInfo,
} from './telemetryInspectorModel.js'

const PAGE_SIZE = 40
const CHARACTER_RESULT_LIMIT = 12
const DEBOUNCE_MS = 280
const TIME_WINDOWS = [
  ['', 'Any time'],
  ['15m', 'Last 15 minutes'],
  ['1h', 'Last hour'],
  ['6h', 'Last 6 hours'],
  ['24h', 'Last 24 hours'],
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
]

function useDebouncedValue(value, delay = DEBOUNCE_MS) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timeout)
  }, [delay, value])

  return debounced
}

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function formatClock(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
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

function shortId(value) {
  const text = String(value || '')
  if (!text) return '—'
  return text.length > 18 ? `${text.slice(0, 10)}…${text.slice(-6)}` : text
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

function CharacterOption({ option, onSelect }) {
  const context = [option.memberName, option.className, option.spec, option.realm].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      className="gw-admin-character-option"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSelect(option)}
    >
      <span>
        <strong>{option.characterName || option.characterId}</strong>
        {context ? <small>{context}</small> : null}
      </span>
      <small>{relativeTime(option.lastReceivedAt)}</small>
    </button>
  )
}

export default function TelemetryInspector() {
  const [summary, setSummary] = useState(null)
  const [records, setRecords] = useState([])
  const [selected, setSelected] = useState(null)
  const [selectedSectionKey, setSelectedSectionKey] = useState('overview')
  const [characterInput, setCharacterInput] = useState('')
  const [characterId, setCharacterId] = useState('')
  const [characterOptions, setCharacterOptions] = useState([])
  const [characterOptionsOpen, setCharacterOptionsOpen] = useState(false)
  const [characterOptionsLoading, setCharacterOptionsLoading] = useState(false)
  const [payloadInput, setPayloadInput] = useState('')
  const [timeWindow, setTimeWindow] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [copyState, setCopyState] = useState('')

  const debouncedCharacter = useDebouncedValue(characterInput.trim())
  const debouncedPayload = useDebouncedValue(payloadInput.trim().replace(/\s+/g, '_'))
  const debouncedTimeWindow = useDebouncedValue(timeWindow, 180)
  const orderedRecords = useMemo(() => sortTelemetryRecordsNewest(records), [records])
  const payloadSections = useMemo(() => telemetryPayloadSections(selected), [selected])
  const selectedSection = useMemo(
    () => payloadSections.find((section) => section.key === selectedSectionKey) || payloadSections[0] || null,
    [payloadSections, selectedSectionKey],
  )
  const selectedSession = useMemo(() => telemetrySessionInfo(selected), [selected])
  const selectedSource = useMemo(() => telemetrySourceInfo(selected), [selected])
  const descriptor = telemetryDomainDescriptor(selected)
  const selectedPayloadLabel = telemetryPayloadLabel(selected)
  const activeFilters = Boolean(characterInput.trim() || payloadInput.trim() || timeWindow)

  const loadSummary = useCallback(async () => {
    try {
      const body = await getJson('/api/admin/guildweaver/telemetry/summary')
      setSummary(body.summary)
    } catch (loadError) {
      setError(loadError.message || 'Unable to load Guildweaver telemetry summary.')
    }
  }, [])

  const loadHistory = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      const since = telemetrySinceForWindow(debouncedTimeWindow)
      if (characterId) params.set('characterId', characterId)
      else if (debouncedCharacter) params.set('character', debouncedCharacter)
      if (debouncedPayload) params.set('payloadType', debouncedPayload)
      if (since) params.set('since', since)

      const historyBody = await getJson(`/api/admin/guildweaver/telemetry?${params}`)
      setRecords(historyBody.records || [])
      setHasMore(Boolean(historyBody.pagination?.hasMore))
    } catch (loadError) {
      setError(loadError.message || 'Unable to load Guildweaver telemetry.')
    } finally {
      setLoading(false)
    }
  }, [characterId, debouncedCharacter, debouncedPayload, debouncedTimeWindow, offset])

  const refresh = useCallback(() => {
    loadSummary()
    loadHistory()
  }, [loadHistory, loadSummary])

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

  useEffect(() => { loadSummary() }, [loadSummary])
  useEffect(() => { loadHistory() }, [loadHistory])

  useEffect(() => {
    if (characterId || !debouncedCharacter) {
      setCharacterOptions([])
      setCharacterOptionsLoading(false)
      return undefined
    }

    let cancelled = false
    setCharacterOptionsLoading(true)
    const params = new URLSearchParams({ q: debouncedCharacter, limit: String(CHARACTER_RESULT_LIMIT) })
    getJson(`/api/admin/guildweaver/telemetry/characters?${params}`)
      .then((body) => {
        if (!cancelled) setCharacterOptions(body.characters || [])
      })
      .catch(() => {
        if (!cancelled) setCharacterOptions([])
      })
      .finally(() => {
        if (!cancelled) setCharacterOptionsLoading(false)
      })

    return () => { cancelled = true }
  }, [characterId, debouncedCharacter])

  useEffect(() => {
    if (!orderedRecords.length) {
      setSelected(null)
      return
    }
    if (!selected || !orderedRecords.some((record) => record.id === selected.id)) {
      selectRecord(orderedRecords[0])
    }
  }, [orderedRecords, selected, selectRecord])

  useEffect(() => {
    if (!payloadSections.length) return
    if (!payloadSections.some((section) => section.key === selectedSectionKey)) {
      setSelectedSectionKey(payloadSections[0].key)
    }
  }, [payloadSections, selectedSectionKey])

  const selectCharacter = (option) => {
    setCharacterInput(option.characterName || option.characterId)
    setCharacterId(option.characterId)
    setCharacterOptionsOpen(false)
    setOffset(0)
  }

  const clearFilters = () => {
    setCharacterInput('')
    setCharacterId('')
    setCharacterOptions([])
    setPayloadInput('')
    setTimeWindow('')
    setOffset(0)
  }

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

  return (
    <div className="guildweaver-console-embed">
      <section className="gw-admin-console" aria-label="Guildweaver telemetry workspace">
        <header className="gw-admin-toolbar gw-admin-debug-toolbar">
          <label className="gw-admin-filter-field gw-admin-character-filter">
            <span>Character</span>
            <div className="gw-admin-character-combobox">
              <input
                value={characterInput}
                onChange={(event) => {
                  setCharacterInput(event.target.value)
                  setCharacterId('')
                  setCharacterOptionsOpen(true)
                  setOffset(0)
                }}
                onFocus={() => setCharacterOptionsOpen(true)}
                onBlur={() => window.setTimeout(() => setCharacterOptionsOpen(false), 120)}
                placeholder="Type a character name…"
                aria-label="Filter telemetry by character"
                autoComplete="off"
              />
              {characterOptionsOpen && characterInput.trim() && !characterId ? (
                <div className="gw-admin-character-options" role="listbox" aria-label="Matching characters">
                  {characterOptionsLoading ? <p>Finding characters…</p> : null}
                  {!characterOptionsLoading && characterOptions.map((option) => (
                    <CharacterOption key={option.characterId} option={option} onSelect={selectCharacter} />
                  ))}
                  {!characterOptionsLoading && debouncedCharacter && !characterOptions.length ? <p>No matching characters yet.</p> : null}
                </div>
              ) : null}
            </div>
          </label>

          <label className="gw-admin-filter-field">
            <span>Payload</span>
            <input
              value={payloadInput}
              onChange={(event) => { setPayloadInput(event.target.value); setOffset(0) }}
              placeholder="Talent tree, character…"
              aria-label="Filter telemetry by payload type"
              list="gw-payload-types"
            />
            <datalist id="gw-payload-types">
              {(summary?.eventTypes || []).map((entry) => (
                <option key={entry.eventType} value={entry.eventType}>{humanizeTelemetryName(entry.eventType)}</option>
              ))}
            </datalist>
          </label>

          <label className="gw-admin-filter-field gw-admin-time-filter">
            <span>Received</span>
            <select
              value={timeWindow}
              onChange={(event) => { setTimeWindow(event.target.value); setOffset(0) }}
              aria-label="Filter telemetry by received time"
            >
              {TIME_WINDOWS.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}
            </select>
          </label>

          <div className="gw-admin-toolbar-actions">
            {activeFilters ? <button type="button" className="gw-admin-clear" onClick={clearFilters}>Clear</button> : null}
            <button className="gw-admin-refresh" type="button" onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          </div>

          <div className="gw-admin-toolbar-status" aria-label="Guildweaver telemetry summary">
            <strong>{summary?.records ?? 0}</strong><span>records</span>
            <i aria-hidden="true">·</i>
            <strong>{summary?.characters ?? 0}</strong><span>characters</span>
            <i aria-hidden="true">·</i>
            <span>last received {relativeTime(summary?.lastReceivedAt)}</span>
          </div>
        </header>

        {error ? <p className="gw-admin-error">{error}</p> : null}

        <div className="gw-admin-workspace">
          <section className="gw-admin-history" aria-label="Latest telemetry activity">
            <div className="gw-admin-pane-heading">
              <div>
                <span>Latest activity</span>
                <strong>{orderedRecords.length ? `${offset + 1}–${offset + orderedRecords.length}` : '0'}</strong>
              </div>
              <small>Newest first</small>
            </div>

            {loading && !orderedRecords.length ? <p className="gw-admin-empty">Loading telemetry…</p> : null}
            {!loading && !orderedRecords.length ? <p className="gw-admin-empty">Nothing has arrived for these filters yet.</p> : null}

            <div className="gw-admin-history-list">
              {orderedRecords.map((record) => {
                const source = telemetrySourceInfo(record)
                const payloadLabel = telemetryPayloadLabel(record)
                return (
                  <button
                    key={record.id}
                    type="button"
                    className={`gw-admin-history-item gw-admin-activity-card${selected?.id === record.id ? ' is-selected' : ''}`}
                    onClick={() => selectRecord(record)}
                  >
                    <div className="gw-admin-activity-topline">
                      <strong>{payloadLabel}</strong>
                      <time dateTime={record.receivedAt} title={formatTime(record.receivedAt)}>
                        <b>{formatClock(record.receivedAt)}</b>
                        <span>{formatDate(record.receivedAt)}</span>
                      </time>
                    </div>
                    <div className="gw-admin-activity-source">
                      <span>From</span>
                      <strong>{source.primary}</strong>
                    </div>
                    <div className="gw-admin-activity-context">
                      <span>{source.secondary || record.realm || 'No source details'}</span>
                      <span>{relativeTime(record.receivedAt)}</span>
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
            {!selected ? <p className="gw-admin-empty">Select an activity card to inspect its payload.</p> : (
              <>
                <div className="gw-admin-detail-header gw-admin-debug-detail-header">
                  <div>
                    <span>{descriptor.label}</span>
                    <h2>{selectedPayloadLabel}</h2>
                    <p className="gw-admin-detail-source">From <strong>{selectedSource.primary}</strong>{selectedSource.secondary ? ` · ${selectedSource.secondary}` : ''}</p>
                    <p>
                      Received {formatTime(selected.receivedAt)} ({relativeTime(selected.receivedAt)})
                      {' · '}rev {selected.revision} · {formatBytes(selected.payloadBytes)}
                      {selectedSession.sessionId ? ` · session ${shortId(selectedSession.sessionId)}` : ''}
                    </p>
                  </div>
                  {detailLoading ? <small>Loading payload…</small> : null}
                </div>

                {payloadSections.length ? (
                  <section className="gw-admin-section-inspector" aria-label="Payload sections">
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
                        {copyState === 'section' ? 'Copied for ChatGPT' : 'Copy section'}
                      </button>
                    </div>
                    <pre className="gw-admin-json gw-admin-section-json"><code>{selectedSection ? JSON.stringify(selectedSection.value, null, 2) : 'No section selected.'}</code></pre>
                  </section>
                ) : null}

                <div className="gw-admin-advanced-row">
                  <details className="gw-admin-record-details">
                    <summary>Technical details</summary>
                    <dl className="gw-admin-facts">
                      <div><dt>Captured</dt><dd title={formatTime(selected.capturedAt)}>{formatTime(selected.capturedAt)}</dd></div>
                      <div><dt>Received</dt><dd title={formatTime(selected.receivedAt)}>{formatTime(selected.receivedAt)}</dd></div>
                      <div><dt>Character</dt><dd title={selected.characterId}>{selected.characterName || selected.characterId || '—'}</dd></div>
                      <div><dt>Member</dt><dd title={selected.memberId}>{selected.memberName || selected.memberId || '—'}</dd></div>
                      <div><dt>Event</dt><dd>{selected.eventType}</dd></div>
                      <div><dt>Kind</dt><dd>{selected.kind}</dd></div>
                      <div><dt>Schema</dt><dd>{selected.schemaVersion}</dd></div>
                      <div><dt>Session</dt><dd title={selectedSession.sessionId}>{shortId(selectedSession.sessionId)}</dd></div>
                      <div><dt>Checkpoint</dt><dd>{selectedSession.checkpointLabel || '—'}</dd></div>
                      <div><dt>Reason</dt><dd>{selectedSession.reason || '—'}</dd></div>
                      <div><dt>Install</dt><dd title={selected.installationId}>{shortId(selected.installationId)}</dd></div>
                      <div><dt>Device</dt><dd title={selected.deviceId}>{shortId(selected.deviceId)}</dd></div>
                      <div><dt>Stream</dt><dd title={selected.streamKey}>{selected.streamKey || '—'}</dd></div>
                    </dl>
                    <div className="gw-admin-advanced-actions">
                      <button type="button" onClick={() => performCopy('payload')} disabled={!selected.payload}>{copyState === 'payload' ? 'Payload copied' : 'Copy payload'}</button>
                      <button type="button" onClick={() => performCopy('share')} disabled={!selected.envelope}>{copyState === 'share' ? 'Bundle copied' : 'Copy debug bundle'}</button>
                    </div>
                  </details>

                  <details className="gw-admin-envelope">
                    <summary>Full envelope</summary>
                    <div className="gw-admin-envelope-actions">
                      <button type="button" onClick={() => performCopy('envelope')}>{copyState === 'envelope' ? 'Envelope copied' : 'Copy envelope'}</button>
                    </div>
                    <pre className="gw-admin-json"><code>{selected.envelope ? JSON.stringify(selected.envelope, null, 2) : 'Loading canonical payload…'}</code></pre>
                  </details>
                </div>
              </>
            )}
          </section>
        </div>
      </section>
    </div>
  )
}
