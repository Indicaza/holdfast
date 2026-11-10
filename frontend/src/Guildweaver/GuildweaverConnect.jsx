import { useMemo, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import { useSession } from '../Auth/sessionContext.js'
import './GuildweaverConnect.css'

const PAIRING_ERRORS = {
  pairing_not_found_or_expired: 'This code has expired or was already used. Restart pairing from Guildweaver on your computer to get a new one.',
  pairing_already_consumed: 'This computer is already connected. You can close this page.',
  pairing_already_approved: 'This code was approved by a different account. Restart pairing from Guildweaver on your computer.',
  authentication_required: 'Your sign-in expired. Sign in again to connect.',
}

function currentReturnTo() {
  return `${window.location.pathname}${window.location.search}`
}

export default function GuildweaverConnect() {
  const session = useSession()
  const userCode = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    return String(params.get('code') || '').trim().toUpperCase()
  }, [])
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  async function connect() {
    setStatus('connecting')
    setError('')

    try {
      await apiJson('/api/bridge/pairing/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userCode }),
      })
      setStatus('connected')
    } catch (requestError) {
      setError(PAIRING_ERRORS[requestError?.body?.error] || 'Guildweaver could not be connected. Try again, or restart pairing from Guildweaver on your computer.')
      setStatus('error')
    }
  }

  return (
    <main className="guildweaver-connect-page">
      <section className="guildweaver-connect-card">
        <div className="guildweaver-connect-mark">♜</div>
        <p className="guildweaver-connect-eyebrow">Guildweaver</p>
        <h1>Connect this PC</h1>

        {!userCode ? (
          <p className="guildweaver-connect-error">
            This pairing link is missing its connection code. Return to Guildweaver Bridge and start pairing again.
          </p>
        ) : session.status === 'loading' ? (
          <p className="guildweaver-connect-copy">Checking your Guildweaver session…</p>
        ) : status === 'connected' ? (
          <>
            <p className="guildweaver-connect-success">Connected.</p>
            <a className="guildweaver-connect-button" href="/dashboard">Open dashboard</a>
            <p className="guildweaver-connect-copy">
              Guildweaver Bridge is now linked to your Guildweaver account. You can open the dashboard or return to the game.
            </p>
          </>
        ) : !session.authenticated ? (
          <>
            <p className="guildweaver-connect-copy">
              Sign in with Discord to securely connect this installation. You do not need to register or join a guild.
            </p>
            <button
              className="guildweaver-connect-button"
              type="button"
              onClick={() => session.signIn(currentReturnTo(), 'member')}
            >
              Sign in with Discord
            </button>
          </>
        ) : (
          <>
            <p className="guildweaver-connect-copy">
              Connect Guildweaver on this PC to <strong>{session.user?.globalName || session.user?.username || 'your Guildweaver account'}</strong>.
            </p>
            <p className="guildweaver-connect-code">{userCode}</p>
            <button
              className="guildweaver-connect-button"
              type="button"
              disabled={status === 'connecting'}
              onClick={connect}
            >
              {status === 'connecting' ? 'Connecting…' : 'Connect Guildweaver'}
            </button>
            {error ? <p className="guildweaver-connect-error">{error}</p> : null}
          </>
        )}

        <p className="guildweaver-connect-note">
          This computer can only upload the WoW data the Guildweaver addon saves. It never sees your Battle.net password and cannot act in game. You can disconnect it any time from My Devices &amp; Sync.
        </p>
      </section>
    </main>
  )
}
