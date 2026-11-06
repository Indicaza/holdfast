import { useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import { runAuthenticatedMutation } from '../Auth/authenticatedMutation.js'
import { signInReturnTo } from '../Auth/returnTo.js'
import { useSession } from '../Auth/sessionContext.js'
import { Badge, Button } from '../DesignSystem/index.js'
import EmptyTelemetry from '../Intelligence/EmptyTelemetry.jsx'
import Modal from '../Modal/Modal.jsx'
import { SyncCallout } from './PlayerOverview.jsx'
import { relativeTime } from './playerModel.js'

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
    <>
      <SyncCallout sync={data.sync} />

      <section className="intel-panel" aria-labelledby="player-devices-title">
        <div className="intel-panel__heading intel-panel__heading--split">
          <div>
            <span>Devices</span>
            <h2 id="player-devices-title">Your connected computers</h2>
            <p>Each computer running Guildweaver uploads with its own key. Only you can see or disconnect your devices.</p>
          </div>
          <a href="/download">Connect another computer →</a>
        </div>

        {!devices.length ? (
          <EmptyTelemetry title="No computers connected yet.">
            Download Guildweaver and open it. It opens this site to approve the connection.
          </EmptyTelemetry>
        ) : (
          <ul className="player-devices">
            {devices.map((device) => (
              <li key={device.id} className={`player-device player-device--${device.status}`}>
                <div className="player-device__name">
                  <strong>{device.name}</strong>
                  <Badge tone={device.status === 'connected' ? 'success' : 'neutral'}>{device.status === 'connected' ? 'Connected' : 'Disconnected'}</Badge>
                </div>
                <dl>
                  <div><dt>Connected</dt><dd>{formatDate(device.connectedAt)}</dd></div>
                  <div><dt>Last upload</dt><dd>{relativeTime(device.lastUploadAt)}</dd></div>
                  <div><dt>Last contact</dt><dd>{relativeTime(device.lastContactAt)}</dd></div>
                  <div><dt>Characters</dt><dd>{device.characterCount}</dd></div>
                </dl>
                {device.status === 'connected' ? (
                  <Button variant="secondary" size="sm" onClick={() => setConfirming(device)}>Disconnect</Button>
                ) : (
                  <p className="player-device__note">Disconnected {formatDate(device.revokedAt)}.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="intel-panel" aria-labelledby="player-sync-help">
        <div className="intel-panel__heading">
          <span>How syncing works</span>
          <h2 id="player-sync-help">When new data arrives</h2>
        </div>
        <ul className="player-help">
          <li>WoW saves addon data only when you <kbd>/reload</kbd>, log out or exit. Guildweaver uploads it right after, so the dashboard updates then, not live while you play.</li>
          <li>Guildweaver must be running on the computer you play on. The installer sets it to start when you sign in to your computer, and it updates itself.</li>
          <li>Nothing arriving? Check that the device above is connected, then <kbd>/reload</kbd> in game. Type <kbd>/gw sync</kbd> to save and send immediately.</li>
        </ul>
      </section>

      {confirming ? <ConfirmDisconnect device={confirming} onCancel={() => setConfirming(null)} onDisconnected={disconnected} /> : null}
    </>
  )
}
