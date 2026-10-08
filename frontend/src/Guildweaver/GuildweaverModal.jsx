import { useEffect, useRef } from 'react'

import Modal from '../Modal/Modal.jsx'
import GuildweaverDownload from './GuildweaverDownload.jsx'
import { guildweaverRepositories } from './downloads.js'
import { useGuildweaverStatus } from './useGuildweaverStatus.js'
import './GuildweaverModal.css'

export default function GuildweaverModal({
  onClose,
  welcome = false,
  dismissLabel = '',
  onConnected,
}) {
  const status = useGuildweaverStatus({ poll: true })
  const reportedConnected = useRef(false)
  const connected = status.status === 'ready' && status.connected

  useEffect(() => {
    if (!connected || reportedConnected.current) return
    reportedConnected.current = true
    onConnected?.(status)
  }, [connected, onConnected, status])

  return (
    <Modal
      eyebrow={welcome ? 'Welcome to Holdfast' : 'Guildweaver'}
      title={connected ? 'Guildweaver is connected.' : welcome ? 'Bring Holdfast into WoW.' : 'Connect WoW to Holdfast.'}
      intro={
        connected
          ? 'Holdfast can see an active Guildweaver installation for your account.'
          : 'Install the companion once. It finds WoW, installs the addon, syncs supported character data, and keeps itself updated.'
      }
      size="wide"
      onClose={onClose}
    >
      <div className="guildweaver-modal">
        {connected ? (
          <div className="guildweaver-modal__connected" role="status">
            <span className="guildweaver-modal__connected-mark" aria-hidden="true">✓</span>
            <div>
              <strong>Connected</strong>
              <span>
                {status.deviceCount === 1
                  ? '1 active Guildweaver device is linked to your Holdfast account.'
                  : `${status.deviceCount} active Guildweaver devices are linked to your Holdfast account.`}
              </span>
            </div>
          </div>
        ) : null}

        <GuildweaverDownload showLead={false} />

        {!connected ? (
          <ol className="guildweaver-modal__steps">
            <li>
              <span>1</span>
              <div>
                <strong>Download</strong>
                <small>Holdfast picks the installer for this computer.</small>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Open it</strong>
                <small>Guildweaver finds WoW and installs the addon automatically.</small>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Connect</strong>
                <small>Your browser opens once to link this device to your Holdfast profile.</small>
              </div>
            </li>
          </ol>
        ) : (
          <p className="guildweaver-modal__reinstall">
            You only need the installer again for another computer or a clean reinstall.
          </p>
        )}

        {dismissLabel ? (
          <button className="guildweaver-modal__dismiss" type="button" onClick={onClose}>
            {dismissLabel}
          </button>
        ) : null}

        <div className="guildweaver-modal__links" aria-label="Guildweaver resources">
          <a href={guildweaverRepositories[1].href} target="_blank" rel="noreferrer">Source</a>
          <a href="/privacy">Privacy</a>
          <a href="https://github.com/Indicaza/guildweaver-bridge/releases" target="_blank" rel="noreferrer">Releases</a>
        </div>

        <p className="guildweaver-modal__alpha">
          Guildweaver is currently alpha software. Windows builds are unsigned and macOS builds are not yet notarized.
        </p>
      </div>
    </Modal>
  )
}
