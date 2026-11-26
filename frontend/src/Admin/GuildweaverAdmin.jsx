import { useEffect, useState } from 'react'
import { apiJson } from '../Api/apiClient.js'
import PageShell from '../PageShell/PageShell.jsx'
import { useSession } from '../Auth/sessionContext.js'
import GuildweaverConsole from './GuildweaverConsole.jsx'
import './Admin.css'

const INGESTION_API = '/api/admin/guildweaver/ingestion'

function IngestionControls() {
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState(null)
  const [configured, setConfigured] = useState(false)
  const [health, setHealth] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [healthError, setHealthError] = useState(false)
  const [notice, setNotice] = useState('')

  async function load() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const data = await apiJson(INGESTION_API)
      setSaved(data.controls)
      setDraft({ blizzard: data.controls.blizzard, addon: data.controls.addon })
      setConfigured(data.blizzardConfigured)
    } catch {
      setError('Could not load ingestion controls. No changes have been made.')
    } finally {
      setBusy(false)
    }
    try {
      setHealth(await apiJson('/api/admin/storage/health', { attempts: 1 }))
      setHealthError(false)
    } catch {
      setHealthError(true)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function save(next) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const data = await apiJson(INGESTION_API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      setSaved(data.controls)
      setDraft({ blizzard: data.controls.blizzard, addon: data.controls.addon })
      setConfigured(data.blizzardConfigured)
      setNotice('Ingestion settings saved.')
    } catch {
      setError('Settings could not be confirmed. Refresh before making another change.')
    } finally {
      setBusy(false)
    }
  }

  const dirty = draft && saved && (draft.blizzard !== saved.blizzard || draft.addon !== saved.addon)
  const disk = health?.disk
  const gib = (bytes) => Number.isFinite(bytes) ? (bytes / 1024 ** 3).toFixed(2) + ' GiB' : 'Unknown'

  return (
    <section className="admin-ingestion" aria-label="Data ingestion controls">
      <header className="admin-ingestion__header">
        <div>
          <h2>Data ingestion</h2>
          <p>Control new Auction House writes without restarting the server. Other telemetry remains active.</p>
        </div>
        <button type="button" className="gw-admin-refresh" onClick={load} disabled={busy}>Refresh</button>
      </header>
      {error && <p role="alert" className="gw-admin-error">{error}</p>}
      {draft ? (
        <>
          <div className="admin-ingestion__sources">
            {[
              { key: 'blizzard', name: 'Blizzard API', description: configured ? 'Scheduled auction house snapshots.' : 'API credentials are not configured; enabling will not start polling.' },
              { key: 'addon', name: 'Player auction scans', description: 'Auction observations uploaded by Guildweaver clients.' },
            ].map(({ key, name, description }) => (
              <label key={key} className="admin-ingestion__source">
                <span><strong>{name}</strong><small>{description}</small><small>Saved state: {saved[key] ? 'Enabled' : 'Paused'}</small></span>
                <input type="checkbox" checked={draft[key]} disabled={busy} onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })} />
              </label>
            ))}
          </div>
          <div className="admin-ingestion__actions">
            <button type="button" className="gw-admin-refresh" disabled={busy || (!dirty && saved.updatedAt != null)} onClick={() => save(draft)}>Save changes</button>
            <button type="button" className="gw-admin-refresh" disabled={busy || (!saved.blizzard && !saved.addon && !dirty && saved.updatedAt != null)} onClick={() => save({ blizzard: false, addon: false })}>Pause all auction ingestion</button>
            <span role="status">{notice || (saved.updatedAt ? 'Last saved ' + new Date(saved.updatedAt).toLocaleString() : 'Initial defaults · not yet saved')}</span>
          </div>
        </>
      ) : !error ? <p>Loading ingestion controls…</p> : null}
      <div className="admin-ingestion__health">
        <h3>Production storage</h3>
        {healthError ? <p>Storage report unavailable. Refresh to try again.</p> : health ? (
          <>
            <div className="admin-ingestion__metrics">
              <div><small>Status</small><strong>{health.status || 'Unknown'}</strong></div>
              <div><small>Disk used</small><strong>{Number.isFinite(disk?.usedPct) ? disk.usedPct + '%' : 'Unknown'}</strong></div>
              <div><small>Free space</small><strong>{gib(disk?.freeBytes)}</strong></div>
              <div><small>Projected days until full</small><strong>{health.daysUntilFull ?? 'Unknown'}</strong></div>
            </div>
            {health.alerts?.length > 0 && <p role="alert" className="gw-admin-error">{health.alerts.join(' · ')}</p>}
          </>
        ) : <p>Loading storage report…</p>}
        <p>Pausing retains existing history. A snapshot already being written may finish; queued client scans can be pruned by the addon's normal queue limits.</p>
      </div>
    </section>
  )
}

function ArchiveDevices() {
  const [hold, setHold] = useState(undefined)
  const [devices, setDevices] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setBusy(true)
    setError('')
    try {
      const result = await apiJson('/api/admin/guildweaver/archive/devices')
      setDevices(result.devices)
      setHold((await apiJson('/api/admin/guildweaver/archive/hold')).hold)
    } catch {
      setError('Could not load archive devices.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { load() }, [])

  async function change(device) {
    setBusy(true)
    setError('')
    try {
      const result = await apiJson('/api/admin/guildweaver/archive/devices/' + encodeURIComponent(device.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !device.archiveEnabled }),
      })
      setDevices((current) => current.map((entry) => entry.id === result.device.id ? { ...entry, ...result.device } : entry))
    } catch {
      setError('Change could not be confirmed. Refresh to verify.')
    } finally {
      setBusy(false)
    }
  }

  async function changeHold(enabled) {
    setBusy(true)
    setError('')
    try {
      const result = await apiJson('/api/admin/guildweaver/archive/hold', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
      })
      setHold(result.hold)
    } catch {
      setError('Archive hold could not be changed. Pause and save both ingestion sources first; retry once current market work finishes.')
    } finally { setBusy(false) }
  }

  return (
    <section className="admin-ingestion" aria-label="Archive devices">
      <header className="admin-ingestion__header">
        <div>
          <h2>Archive devices</h2>
          <p>Authorize your own paired computers to request manual market exports. Nothing is downloaded automatically.</p>
        </div>
        <button type="button" className="gw-admin-refresh" disabled={busy} onClick={load}>Refresh</button>
      </header>
      {error && <p role="alert" className="gw-admin-error">{error}</p>}
      {!devices ? <p>Loading devices…</p> : devices.length === 0 ? <p>Pair a bridge with your administrator account to get started.</p> : (
        <div className="admin-ingestion__sources">
          {devices.map((device) => (
            <label className="admin-ingestion__source" key={device.id}>
              <span>
                <strong>{device.name}</strong>
                <small>Device ID: {device.id}</small>
                <small>Last contact: {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : 'Never'}</small>
                <small>{device.archiveEnabled ? 'Manual archive access enabled' : 'Archive access disabled'}</small>
              </span>
              <input type="checkbox" aria-label={'Archive access for ' + device.name} checked={device.archiveEnabled} disabled={busy} onChange={() => change(device)} />
            </label>
          ))}
        </div>
      )}
      <div className="admin-ingestion__health">
        <h3>Archive hold</h3>
        <p>{hold === undefined ? 'Loading…' : hold ? 'History protected from scheduled retention. Keep this enabled until local verification is complete.' : 'Start the hold once both ingestion sources are paused. This protects retained history before exporting.'}</p>
        {hold && <p><strong>Hold ID:</strong> <code>{hold.id}</code></p>}
        <button type="button" className="gw-admin-refresh" disabled={busy || hold === undefined} onClick={() => changeHold(!hold)}>{hold ? 'Release archive hold' : 'Start archive hold'}</button>
      </div>
      <p>Enabling a device is permission only. Run an explicit archive command on that computer to export a batch.</p>
    </section>
  )
}

function Gate({ session }) {
  if (session.status === 'loading') {
    return <PageShell eyebrow="Guildweaver Admin" title="Checking credentials" intro="Verifying administrative access." centered className="admin-page admin-page--gate" />
  }

  if (session.status === 'error') {
    return (
      <PageShell eyebrow="Guildweaver Admin" title="Backend unavailable" intro="Holdfast could not verify your session." centered className="admin-page admin-page--gate">
        <div className="admin-auth"><button className="admin-auth__primary" type="button" onClick={() => session.refresh()}>Retry connection</button></div>
      </PageShell>
    )
  }

  if (!session.authenticated) {
    return (
      <PageShell eyebrow="Guildweaver Admin" title="Sign in with Discord" intro="Administrative access is required to inspect Guildweaver payloads." centered className="admin-page admin-page--gate">
        <div className="admin-auth"><button className="admin-auth__primary" type="button" onClick={() => session.signIn()}>Continue with Discord</button></div>
      </PageShell>
    )
  }

  return <PageShell eyebrow="Guildweaver Admin" title="No admin access" intro="This account does not have website administration access." centered className="admin-page admin-page--gate" />
}

export default function GuildweaverAdmin() {
  const session = useSession()
  const canView = session.authenticated && session.hasPermission('site.admin')

  if (!canView) return <Gate session={session} />

  return (
    <PageShell
      eyebrow="Guildweaver Admin"
      title="Sync Console"
      intro="See exactly what Guildweaver is sending, when it arrived, and how each character changes over time."
      centered
      className="admin-page guildweaver-admin-page"
    >
      <nav className="admin-nav" aria-label="Admin sections">
        <a href="/admin">Audit</a>
        <a href="/admin/guildweaver" aria-current="page">Guildweaver</a>
        <a href="/admin/dungeons">Dungeon content</a>
      </nav>
      <IngestionControls />
      <ArchiveDevices />
      <GuildweaverConsole />
    </PageShell>
  )
}
