import { useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import { runAuthenticatedMutation } from '../Auth/authenticatedMutation.js'
import { signInReturnTo } from '../Auth/returnTo.js'
import { useSession } from '../Auth/sessionContext.js'
import { Button } from '../DesignSystem/index.js'
import Modal from '../Modal/Modal.jsx'
import { SyncCallout } from './PlayerOverview.jsx'
import { relativeTime } from './playerModel.js'
import { EmptyState, Icon, Panel } from './ui.jsx'

function formatDate(value) {
  if (!value) return 'unknown'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'unknown' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

function ConfirmDisconnect({ device, onCancel, onDisconnected }) {
  const session = useSession()
  const [status, setStatus] = useState('idle')

  async function disconnect() {
    setStatus('working')
    try {
      const result = await runAuthenticatedMutation({
        request: () => apiJson(`/api/player/devices/${encodeURIComponent(device.id)}/disconnect`, { method: 'POST' }),
        refresh: session.refresh,
        reauthenticate: () => session.signIn(signInReturnTo()),
      })
      if (result) onDisconnected(result.device)
    } catch {
      setStatus('error')
    }
  }

  return (
    <Modal
      eyebrow="Disconnect device"
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

// The player's own devices: what each last did, and a way to disconnect.
export default function PlayerSync({ data, onChanged }) {
  const [confirming, setConfirming] = useState(null)
  const devices = data.devices || []

  function disconnected(device) {
    setConfirming(null)
    if (!device) return
    onChanged((current) => current && ({
      ...current,
      devices: current.devices.map((entry) => (entry.id === device.id ? device : entry)),
    }))
  }

  return (
    <div className="gw-stack">
      <SyncCallout sync={data.sync} />

      <Panel
        id="player-devices"
        eyebrow="Devices"
        title="Your connected computers"
        description="Each computer running Guildweaver uploads with its own key. Only you can see or disconnect your devices."
        actions={<a className="gw-link" href="/download">Connect another computer <Icon name="chevron" size={14} /></a>}
      >
        {!devices.length ? (
          <EmptyState title="No computers connected yet." icon="guildweaver" action={<a className="gw-btn gw-btn--primary" href="/download">Download Guildweaver</a>}>
            Download Guildweaver and open it. It opens this site to approve the connection.
          </EmptyState>
        ) : (
          <ul className="gw-devices">
            {devices.map((device) => {
              const connected = device.status === 'connected'
              return (
                <li key={device.id} className={`gw-device${connected ? '' : ' is-off'}`}>
                  <div className="gw-device__name">
                    <span className={`gw-dot gw-dot--${connected ? 'synced' : 'off'}`} aria-hidden="true" />
                    <strong>{device.name}</strong>
                    <span className={`gw-tag${connected ? ' gw-tag--ok' : ' gw-tag--quiet'}`}>{connected ? 'Connected' : 'Disconnected'}</span>
                  </div>
                  <dl>
                    <div><dt>Connected</dt><dd>{formatDate(device.connectedAt)}</dd></div>
                    <div><dt>Last upload</dt><dd>{relativeTime(device.lastUploadAt)}</dd></div>
                    <div><dt>Last contact</dt><dd>{relativeTime(device.lastContactAt)}</dd></div>
                    <div><dt>Characters</dt><dd>{device.characterCount}</dd></div>
                  </dl>
                  {connected ? (
                    <Button variant="secondary" size="sm" onClick={() => setConfirming(device)}>Disconnect</Button>
                  ) : (
                    <p className="gw-muted">Disconnected {formatDate(device.revokedAt)}.</p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <Panel id="player-sync-help" eyebrow="How syncing works" title="When new data arrives">
        <ul className="gw-help">
          <li><Icon name="bolt" size={16} /><span>WoW saves addon data only when you <kbd>/reload</kbd>, log out or exit. Guildweaver uploads it right after, so the dashboard updates then, not live while you play.</span></li>
          <li><Icon name="guildweaver" size={16} /><span>Guildweaver must be running on the computer you play on. The installer sets it to start when you sign in, and it updates itself.</span></li>
          <li><Icon name="search" size={16} /><span>Nothing arriving? Check that the device above is connected, then <kbd>/reload</kbd> in game. Type <kbd>/gw sync</kbd> to save and send immediately.</span></li>
        </ul>
      </Panel>

      {confirming ? <ConfirmDisconnect device={confirming} onCancel={() => setConfirming(null)} onDisconnected={disconnected} /> : null}
    </div>
  )
}
