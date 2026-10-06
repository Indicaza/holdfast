import { useCallback, useEffect, useState } from 'react'

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

function formatLag(value) {
  if (value === null || value === undefined) return '—'
  const ms = Number(value)
  if (!Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`
}

function valuePreview(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (typeof value === 'object') return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? '' : 's'}`
  return String(value)
}

async function getJson(url) {
  const response = await fetch(url, { credentials: 'same-origin' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
  return body
}

export default function GuildweaverConsole() {
  const [summary, setSummary] = useState(null)
  const [snapshots, setSnapshots] = useState([])
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (submittedQuery) params.set('q', submittedQuery)
      const [summaryBody, historyBody] = await Promise.all([
        getJson('/api/admin/guildweaver/summary'),
        getJson(`/api/admin/guildweaver/snapshots?${params}`),
      ])
      setSummary(summaryBody.summary)
      setSnapshots(historyBody.snapshots || [])
      setHasMore(Boolean(historyBody.pagination?.hasMore))
    } catch (loadError) {
      setError(loadError.message || 'Unable to load Guildweaver data.')
    } finally {
      setLoading(false)
    }
  }, [offset, submittedQuery])

  const selectSnapshot = useCallback(async (snapshot) => {
    setSelected(snapshot)
    setDetailLoading(true)
    setCopied(false)
    try {
      const body = await getJson(`/api/admin/guildweaver/snapshots/${snapshot.id}`)
      setSelected(body.snapshot)
    } catch (detailError) {
      setError(detailError.message || 'Unable to load snapshot payload.')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!snapshots.length) {
      setSelected(null)
      return
    }
    if (!selected || !snapshots.some((snapshot) => snapshot.id === selected.id)) {
      selectSnapshot(snapshots[0])
    }
  }, [snapshots, selected, selectSnapshot])

  const copyPayload = async () => {
    if (!selected?.payload) return
    await navigator.clipboard.writeText(JSON.stringify(selected.payload, null, 2))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="guildweaver-console-embed">
      {summary ? (
        <section className="gw-admin-stats" aria-label="Guildweaver sync summary">
          <div><strong>{summary.snapshots}</strong><span>Snapshots</span></div>
          <div><strong>{summary.characters}</strong><span>Characters</span></div>
          <div><strong>{summary.devices}</strong><span>Devices</span></div>
          <div><strong>{summary.last24h}</strong><span>Last 24h</span></div>
          <div><strong>{relativeTime(summary.lastReceivedAt)}</strong><span>Last sync</span></div>
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
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search character, member, device, source, or payload…" aria-label="Search Guildweaver snapshots" />
            <button type="submit">Search</button>
            {submittedQuery ? <button type="button" onClick={() => { setQuery(''); setSubmittedQuery(''); setOffset(0) }}>Clear</button> : null}
          </form>
          <button className="gw-admin-refresh" type="button" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </header>

        {error ? <p className="gw-admin-error">{error}</p> : null}

        <div className="gw-admin-workspace">
          <section className="gw-admin-history" aria-label="Snapshot history">
            <div className="gw-admin-pane-heading">
              <div><span>History</span><strong>{snapshots.length ? `${offset + 1}–${offset + snapshots.length}` : '0'} shown</strong></div>
            </div>

            {loading && !snapshots.length ? <p className="gw-admin-empty">Loading snapshots…</p> : null}
            {!loading && !snapshots.length ? <p className="gw-admin-empty">No snapshots match this view.</p> : null}

            <div className="gw-admin-history-list">
              {snapshots.map((snapshot) => (
                <button
                  key={snapshot.id}
                  type="button"
                  className={`gw-admin-history-item${selected?.id === snapshot.id ? ' is-selected' : ''}`}
                  onClick={() => selectSnapshot(snapshot)}
                >
                  <div className="gw-admin-history-title">
                    <strong>{snapshot.characterName}</strong>
                    <span>#{snapshot.id}</span>
                  </div>
                  <div className="gw-admin-history-meta">
                    <span>Lvl {snapshot.level || '?'}</span>
                    <span>{snapshot.className || 'Unknown class'}</span>
                    <span>{snapshot.reason || snapshot.source}</span>
                  </div>
                  <div className="gw-admin-history-time">
                    <span>{relativeTime(snapshot.receivedAt)}</span>
                    <span>{formatBytes(snapshot.payloadBytes)}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="gw-admin-pagination">
              <button type="button" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Newer</button>
              <button type="button" disabled={!hasMore || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>Older</button>
            </div>
          </section>

          <section className="gw-admin-detail" aria-label="Snapshot detail">
            {!selected ? <p className="gw-admin-empty">Select a snapshot to inspect its payload.</p> : (
              <>
                <div className="gw-admin-detail-header">
                  <div>
                    <span>Snapshot #{selected.id}</span>
                    <h2>{selected.characterName}</h2>
                    <p>{selected.memberName} · {selected.payload?.realm || 'Unknown realm'}</p>
                  </div>
                  <button type="button" onClick={copyPayload} disabled={!selected.payload}>{copied ? 'Copied' : 'Copy JSON'}</button>
                </div>

                <dl className="gw-admin-facts">
                  <div><dt>Captured</dt><dd title={formatTime(selected.capturedAt)}>{relativeTime(selected.capturedAt)}</dd></div>
                  <div><dt>Received</dt><dd title={formatTime(selected.receivedAt)}>{relativeTime(selected.receivedAt)}</dd></div>
                  <div><dt>Bridge lag</dt><dd>{formatLag(selected.lagMs)}</dd></div>
                  <div><dt>Revision</dt><dd>{selected.bridgeRevision ?? '—'}</dd></div>
                  <div><dt>Addon</dt><dd>{selected.addonVersion || '—'}</dd></div>
                  <div><dt>Schema</dt><dd>{selected.schemaVersion ?? '—'}</dd></div>
                  <div><dt>Reason</dt><dd>{selected.reason || '—'}</dd></div>
                  <div><dt>Device</dt><dd title={selected.deviceId}>{selected.deviceId ? `${selected.deviceId.slice(0, 8)}…` : '—'}</dd></div>
                </dl>

                <div className="gw-admin-payload-heading">
                  <div><span>Raw payload</span><strong>{formatBytes(selected.payloadBytes)}</strong></div>
                  {detailLoading ? <span>Loading full payload…</span> : null}
                </div>

                {selected.payload ? (
                  <div className="gw-admin-json-summary">
                    {Object.entries(selected.payload).map(([key, value]) => (
                      <div key={key}><span>{key}</span><strong>{valuePreview(value)}</strong></div>
                    ))}
                  </div>
                ) : null}

                <pre className="gw-admin-json"><code>{selected.payload ? JSON.stringify(selected.payload, null, 2) : 'Loading raw payload…'}</code></pre>
              </>
            )}
          </section>
        </div>
      </section>
    </div>
  )
}
