import { useMemo, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import { useSession } from '../Auth/sessionContext.js'
import './GuildweaverConnect.css'

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
      setError(requestError?.body?.error || requestError?.message || 'Unable to connect Guildweaver.')
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
          <p className="guildweaver-connect-copy">Checking your Holdfast session…</p>
        ) : status === 'connected' ? (
          <>
            <p className="guildweaver-connect-success">Connected.</p>
            <p className="guildweaver-connect-copy">
              Guildweaver Bridge is now linked to your Holdfast account. You can close this tab and return to the game.
            </p>
          </>
        ) : !session.authenticated ? (
          <>
            <p className="guildweaver-connect-copy">
              Sign in with Discord so Holdfast can securely link this Guildweaver installation to your member profile.
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
              Connect Guildweaver on this PC to <strong>{session.user?.globalName || session.user?.username || 'your Holdfast account'}</strong>.
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
          This device can sync your WoW character data. It cannot change Holdfast rank, permissions, Rep, or Marks.
        </p>
      </section>
    </main>
  )
}
