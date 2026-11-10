import { useState } from 'react'

import { signInReturnTo } from '../Auth/returnTo.js'
import { useSession } from '../Auth/sessionContext.js'
import { Button } from '../DesignSystem/index.js'
import '../Guildweaver/GuildweaverConnect.css'
import { useLiveResource } from '../Live/useLiveResource.js'
import { playerDisplayName } from '../navigation.js'
import PageLoading from '../PageLoading/PageLoading.jsx'
import PageShell from '../PageShell/PageShell.jsx'
import { PLAYER_TOPICS } from '../Player/playerModel.js'
import './Account.css'

// Account & Privacy: who the player is signed in as, what Guildweaver keeps
// about them and who can see it. Its only controls are ones the server
// enforces: disconnecting devices (on the Sync page) and signing out.
export default function Account() {
  const session = useSession()
  const [signOutState, setSignOutState] = useState('idle')
  const overview = useLiveResource('/api/player/overview', { topics: PLAYER_TOPICS, enabled: session.authenticated })

  if (session.status === 'loading') return <PageLoading label="Checking your session…" />
  if (!session.authenticated) {
    return (
      <PageShell eyebrow="Account" title="Account & Privacy" intro="Sign in with Discord to see your account." centered compact>
        <button className="guildweaver-connect-button" type="button" onClick={() => (session.status === 'error' ? session.refresh() : session.signIn(signInReturnTo()))}>
          {session.status === 'error' ? 'Retry connection' : 'Sign in with Discord'}
        </button>
        <p><a href="/privacy">Read what Guildweaver collects</a></p>
      </PageShell>
    )
  }

  const user = session.user || {}
  const name = playerDisplayName(user)
  const devices = overview.data?.devices || []
  const connected = devices.filter((device) => device.status === 'connected').length
  const characters = overview.data?.characters?.length || 0

  async function signOut() {
    setSignOutState('working')
    try {
      await session.signOut()
    } catch {
      setSignOutState('error')
    }
  }

  return (
    <PageShell eyebrow="Account" title="Account & Privacy" intro="Your sign-in, what Guildweaver stores about you, and who can see it." className="account-page" compact>
      <div className="account-grid">
        <section className="account-card" aria-labelledby="account-identity">
          <h2 id="account-identity">Signed in with Discord</h2>
          <div className="account-identity">
            {user.avatarUrl ? <img src={user.avatarUrl} alt="" width="64" height="64" /> : <span className="account-identity__initial" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}
            <div>
              <strong>{name}</strong>
              {user.username ? <span>@{user.username}</span> : null}
            </div>
          </div>
          <p>Guildweaver uses Discord only to know it is you. It does not post, read your messages, or add you to any server or guild. Your name and avatar update from Discord each time you sign in.</p>
          <div className="account-actions">
            <Button variant="secondary" onClick={signOut} loading={signOutState === 'working'}>Sign out</Button>
            {signOutState === 'error' ? <p className="intel-error" role="alert">Could not sign out. Try again.</p> : null}
          </div>
        </section>

        <section className="account-card account-card--data" aria-labelledby="account-data">
          <h2 id="account-data">Your data</h2>
          <dl className="account-facts">
            <div><dt>Characters synced</dt><dd>{overview.status === 'ready' ? characters : '…'}</dd></div>
            <div><dt>Computers connected</dt><dd>{overview.status === 'ready' ? connected : '…'}</dd></div>
          </dl>
          <ul className="account-list">
            <li><strong>Private to you:</strong> your characters, equipment, stats, talents, bags, gold, professions, recipes, farming history, farming runs and devices. The dashboard shows them only to you; other signed-in players cannot open them, even with a direct link.</li>
            <li><strong>Shared anonymously:</strong> item details and what drops from which node, pool or creature. These are pooled with every player&apos;s observations and never show your name, characters or account. Community maps show where gathers happened, not who gathered or when.</li>
            <li><strong>Site administrators</strong> can inspect raw uploads to keep syncing working.</li>
          </ul>
          <p><a href="/privacy">Read the full privacy notice →</a></p>
        </section>

        <section className="account-card account-card--controls" aria-labelledby="account-controls">
          <h2 id="account-controls">Controls</h2>
          <ul className="account-list">
            <li><a href="/dashboard/sync">Disconnect a computer</a> to stop it uploading. Its key stops working at once.</li>
            <li>There is no self-service account deletion yet. To have your data removed, contact the maintainer through <a href="https://github.com/Indicaza" target="_blank" rel="noreferrer">GitHub</a>.</li>
          </ul>
        </section>
      </div>
    </PageShell>
  )
}
