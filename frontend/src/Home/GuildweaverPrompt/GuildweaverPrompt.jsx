import { useState } from 'react'

import { useSession } from '../../Auth/sessionContext.js'
import GuildweaverModal from '../../Guildweaver/GuildweaverModal.jsx'
import { useGuildweaverStatus } from '../../Guildweaver/useGuildweaverStatus.js'
import './GuildweaverPrompt.css'

export default function GuildweaverPrompt() {
  const session = useSession()
  const status = useGuildweaverStatus()
  const [open, setOpen] = useState(false)
  const shouldOffer =
    session.status === 'ready' &&
    session.authenticated &&
    status.status === 'ready' &&
    !status.connected

  function closeModal() {
    setOpen(false)
    void status.refresh({ quiet: true })
  }

  if (!shouldOffer && !open) {
    return null
  }

  return (
    <>
      {shouldOffer ? (
        <section className="guildweaver-prompt" aria-label="Guildweaver setup">
          <div className="guildweaver-prompt__copy">
            <span>Guildweaver</span>
            <div>
              <strong>Connect WoW to Holdfast.</strong>
              <p>Install the companion once and it handles the addon, character sync, and updates.</p>
            </div>
          </div>
          <button type="button" onClick={() => setOpen(true)}>
            Set up Guildweaver
          </button>
        </section>
      ) : null}

      {open ? (
        <GuildweaverModal
          onClose={closeModal}
          onConnected={() => void status.refresh({ quiet: true })}
        />
      ) : null}
    </>
  )
}
