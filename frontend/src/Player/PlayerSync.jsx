import { useEffect, useRef, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import { runAuthenticatedMutation } from '../Auth/authenticatedMutation.js'
import { signInReturnTo } from '../Auth/returnTo.js'
import { useSession } from '../Auth/sessionContext.js'
import { Button } from '../DesignSystem/index.js'
import Modal from '../Modal/Modal.jsx'
import { SyncCallout } from './PlayerOverview.jsx'
import { relativeTime } from './playerModel.js'
import { EmptyState, Icon, Panel, Tip } from './ui.jsx'

const DEVICE_NAME_MAX = 40

function formatDate(value) {
  if (!value) return 'unknown'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'unknown' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

function exactTime(value) {
  const date = new Date(value || 0)
  return value && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'never'
}

// Posts one of the player's device changes, signing in again if needed.
function useDeviceMutation() {
  const session = useSession()
  return (path, body) => runAuthenticatedMutation({
    request: () => apiJson(path, { method: 'POST', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }),
    refresh: session.refresh,
    reauthenticate: () => session.signIn(signInReturnTo()),
  })
}

function ConfirmDisconnect({ device, onCancel, onDisconnected }) {
  const mutate = useDeviceMutation()
  const [status, setStatus] = useState('idle')

  async function disconnect() {
    setStatus('working')
    try {
      const result = await mutate(`/api/player/devices/${encodeURIComponent(device.id)}/disconnect`)
      if (result) onDisconnected(result.device)
    } catch {
      setStatus('error')
    }
  }

  return (
    <Modal
      title={`Disconnect ${device.name}?`}
      intro="Its key stops working at once, so it can no longer upload. Data it already sent stays on your dashboard. If Guildweaver is still installed there, it will open this site the next time it syncs and ask you to connect it again."
      onClose={onCancel}
    >
      {status === 'error' ? <p className="intel-error" role="alert">The device could not be disconnected. Try again.</p> : null}
      <div className="auth-result__actions">
        <Button variant="danger" loading={status === 'working'} onClick={disconnect}>Disconnect</Button>
        <Button variant="secondary" onClick={onCancel}>Keep connected</Button>
      </div>
    </Modal>
  )
}

// A device's name, renamed in place: Enter saves, Escape cancels.
function DeviceName({ device, onRenamed }) {
  const mutate = useDeviceMutation()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(device.name)
  const [status, setStatus] = useState('idle')
  const input = useRef(null)

  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  function start() {
    setValue(device.name)
    setStatus('idle')
    setEditing(true)
  }

  async function save(event) {
    event.preventDefault()
    const name = value.replace(/\s+/g, ' ').trim()
    if (!name || name === device.name) {
      setEditing(false)
      return
    }
    setStatus('working')
    try {
      const result = await mutate(`/api/player/devices/${encodeURIComponent(device.id)}/rename`, { name })
      if (result) onRenamed(result.device)
      setEditing(false)
    } catch {
      setStatus('error')
    }
  }

  if (editing) {
    return (
      <form className="gw-rename" onSubmit={save}>
        <input
          ref={input}
          className="gw-rename__input"
          aria-label={`Name for ${device.name}`}
          value={value}
          maxLength={DEVICE_NAME_MAX}
          disabled={status === 'working'}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              setEditing(false)
            }
          }}
        />
        <button type="submit" className="gw-btn gw-btn--sm" disabled={status === 'working'}>Save</button>
        <button type="button" className="gw-btn gw-btn--ghost gw-btn--sm" onClick={() => setEditing(false)}>Cancel</button>
        {status === 'error' ? <span className="gw-rename__error" role="alert">Not saved. Try again.</span> : null}
      </form>
    )
  }

  return (
    <span className="gw-device__name">
      <strong>{device.name}</strong>
      <Tip label="Rename">
        <button type="button" className="gw-icon-btn gw-icon-btn--quiet gw-device__rename" aria-label={`Rename ${device.name}`} onClick={start}>
          <Icon name="edit" size={14} />
        </button>
      </Tip>
    </span>
  )
}

// The player's own devices: what each last did, a name to tell them apart,
// and a way to disconnect.
export default function PlayerSync({ data, onChanged }) {
  const [confirming, setConfirming] = useState(null)
  const devices = data.devices || []

  function replaceDevice(device) {
    if (!device) return
    onChanged((current) => current && ({
      ...current,
      devices: current.devices.map((entry) => (entry.id === device.id ? device : entry)),
    }))
  }

  function disconnected(device) {
    setConfirming(null)
    replaceDevice(device)
  }

  return (
    <div className="gw-stack">
      <SyncCallout sync={data.sync} />

      <Panel
        id="player-devices"
        title="Computers"
        actions={<a className="gw-link" href="/download">Connect another <Icon name="chevron" size={14} /></a>}
        flush
      >
        {!devices.length ? (
          <EmptyState title="No computers connected yet." icon="guildweaver" action={<a className="gw-btn gw-btn--primary" href="/download">Download Guildweaver</a>}>
            Download Guildweaver and open it. It opens this site to approve the connection.
          </EmptyState>
        ) : (
          <div className="gw-table-wrap">
            <table className="gw-table gw-devices">
              <thead>
                <tr>
                  <th scope="col">Computer</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="gw-col-num">Characters</th>
                  <th scope="col">Last upload</th>
                  <th scope="col">Added</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => {
                  const connected = device.status === 'connected'
                  return (
                    <tr key={device.id} className={`gw-device${connected ? '' : ' is-off'}`}>
                      <td className="gw-device__cell-name"><DeviceName device={device} onRenamed={replaceDevice} /></td>
                      <td className="gw-device__cell-status">
                        <span className={`gw-tag${connected ? ' gw-tag--ok' : ' gw-tag--quiet'}`}>{connected ? 'Connected' : 'Disconnected'}</span>
                      </td>
                      <td className="gw-col-num" data-label="Characters">{device.characterCount}</td>
                      <td data-label="Last upload">
                        <Tip label={`${exactTime(device.lastUploadAt)} · last contact ${relativeTime(device.lastContactAt)}`}>
                          <span tabIndex={0}>{relativeTime(device.lastUploadAt)}</span>
                        </Tip>
                      </td>
                      <td className="gw-muted" data-label="Added">{formatDate(device.connectedAt)}</td>
                      <td className="gw-device__actions">
                        {connected ? (
                          <button type="button" className="gw-btn gw-btn--ghost gw-btn--sm gw-btn--danger" onClick={() => setConfirming(device)}>Disconnect</button>
                        ) : (
                          <span className="gw-muted">Since {formatDate(device.revokedAt)}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <details className="gw-disclosure" id="player-sync-help">
        <summary><Icon name="info" size={16} />Not seeing new data?</summary>
        <ul className="gw-help">
          <li><Icon name="bolt" size={16} /><span>WoW saves addon data only when you <kbd>/reload</kbd>, log out or exit. Guildweaver uploads it right after, so the dashboard updates then, not live while you play.</span></li>
          <li><Icon name="guildweaver" size={16} /><span>Guildweaver must be running on the computer you play on. The installer sets it to start when you sign in, and it updates itself.</span></li>
          <li><Icon name="search" size={16} /><span>Check that the computer above is connected, then <kbd>/reload</kbd> in game. Type <kbd>/gw sync</kbd> to save and send immediately.</span></li>
        </ul>
      </details>

      {confirming ? <ConfirmDisconnect device={confirming} onCancel={() => setConfirming(null)} onDisconnected={disconnected} /> : null}
    </div>
  )
}
