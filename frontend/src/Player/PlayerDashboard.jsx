import { useEffect, useMemo, useState } from 'react'

import { signInReturnTo } from '../Auth/returnTo.js'
import { useSession } from '../Auth/sessionContext.js'
import { Button, Select } from '../DesignSystem/index.js'
import '../Guildweaver/GuildweaverConnect.css'
import CharacterProfileModal from '../Intelligence/CharacterProfileModal.jsx'
import IntelligenceAppShell from '../Intelligence/IntelligenceAppShell.jsx'
import { useCharacterParam } from '../Intelligence/useCharacterParam.js'
import '../Intelligence/GuildIntelligence.css'
import { useLiveUpdates } from '../Live/liveUpdatesContext.js'
import { useLiveResource } from '../Live/useLiveResource.js'
import { navigate } from '../Navigation/navigation.js'
import PageLoading from '../PageLoading/PageLoading.jsx'
import PageShell from '../PageShell/PageShell.jsx'
import PlayerCharacters from './PlayerCharacters.jsx'
import PlayerFarming from './PlayerFarming.jsx'
import PlayerOverview from './PlayerOverview.jsx'
import PlayerProfessions from './PlayerProfessions.jsx'
import PlayerSync from './PlayerSync.jsx'
import {
  DASHBOARD_VIEWS,
  PLAYER_TOPICS,
  dashboardHref,
  readServerParam,
  relativeTime,
  resolveServer,
  serverLabel,
  storeServer,
  storedServer,
  withServer,
} from './playerModel.js'
import './Player.css'

function SignedOut({ session }) {
  return (
    <PageShell
      eyebrow="Guildweaver"
      title="Your dashboard"
      intro="Your characters, professions, farming and sync status, grouped by server. Private to you. No guild required."
      centered
      compact
    >
      <div className="player-signed-out">
        <p>Sign in with Discord to see your dashboard and connect Guildweaver on your computer.</p>
        <div className="player-signed-out__actions">
          <Button
            variant="primary"
            size="lg"
            onClick={() => (session.status === 'error' ? session.refresh() : session.signIn(signInReturnTo()))}
          >
            {session.status === 'error' ? 'Retry connection' : 'Sign in with Discord'}
          </Button>
          <Button variant="secondary" size="lg" href="/download">Download Guildweaver</Button>
        </div>
        <p className="player-signed-out__note">Discord sign-in only identifies you. It never adds you to a server or a guild.</p>
      </div>
    </PageShell>
  )
}

function ServerSelector({ servers, server, onChange }) {
  if (!servers.length) return null
  return (
    <Select
      className="player-server-select"
      label="Server"
      inline
      size="sm"
      value={server}
      onChange={(event) => onChange(event.target.value)}
      options={[['', 'All servers'], ...servers.map((entry) => [entry.key, `${entry.label} (${entry.characterCount})`])]}
    />
  )
}

// The rail's subtitle: how much the player has synced.
function dashboardTagline(data) {
  const characters = data?.characters?.length || 0
  const servers = data?.servers?.length || 0
  if (!characters) return 'Your Guildweaver data'
  return `${characters} character${characters === 1 ? '' : 's'} · ${servers} server${servers === 1 ? '' : 's'}`
}

// The server in the URL, following Back/Forward.
function useServerParam() {
  const [requested, setRequested] = useState(() => readServerParam())
  useEffect(() => {
    const sync = () => setRequested(readServerParam())
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  return requested
}

export default function PlayerDashboard({ section = 'overview' }) {
  const live = useLiveUpdates()
  const session = useSession()
  const userId = session.authenticated ? session.user?.id || '' : ''
  const overview = useLiveResource('/api/player/overview', { topics: PLAYER_TOPICS, enabled: session.authenticated })
  const servers = useMemo(() => overview.data?.servers || [], [overview.data])
  const requested = useServerParam()
  const ready = overview.status === 'ready'
  const server = ready ? resolveServer({ requested, stored: storedServer(userId), servers }) : requested
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('guildweaver:dashboard:rail') === 'collapsed'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem('guildweaver:dashboard:rail', collapsed ? 'collapsed' : 'expanded')
    } catch {
      // Remembering the rail is a convenience.
    }
  }, [collapsed])
  const [characterId, openCharacter] = useCharacterParam()

  // Once the player's servers are known, the URL names the server shown: the
  // remembered one, or none when the link named a server they do not have.
  useEffect(() => {
    if (!ready || server === requested) return
    window.history.replaceState(null, '', withServer(`${window.location.pathname}${window.location.search}${window.location.hash}`, server))
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [ready, server, requested])

  function changeServer(next) {
    storeServer(userId, next)
    navigate(withServer(`${window.location.pathname}${window.location.search}${window.location.hash}`, next), { preserveScroll: true })
  }

  const views = DASHBOARD_VIEWS.map((view) => ({ ...view, href: dashboardHref(view.id, server) }))

  if (session.status === 'loading') return <PageLoading label="Checking your session…" />
  if (session.status === 'error' || !session.authenticated) return <SignedOut session={session} />

  const sync = overview.data?.sync
  const expired = overview.error?.status === 401
  const lastSync = sync?.lastUploadAt || sync?.lastCharacterAt
  const paused = live.status === 'offline' || live.status === 'reconnecting'

  return (
    <>
      <IntelligenceAppShell
        brand={{ name: 'Dashboard', tagline: dashboardTagline(overview.data), eyebrow: serverLabel(servers, server), mark: '✦' }}
        sectionLabel={false}
        showLive={false}
        variant="player"
        activeView={section}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onSelectView={() => setMobileOpen(false)}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        onToggleMobile={setMobileOpen}
        views={views}
        actions={(
          <div className="player-topbar">
            <ServerSelector servers={servers} server={server} onChange={changeServer} />
            {ready ? (
              <a className="player-topbar__sync" href={dashboardHref('sync', server)} title="Your devices and sync status">
                <span className={`player-dot player-dot--${sync?.state || 'unknown'}`} aria-hidden="true" />
                {lastSync ? `Synced ${relativeTime(lastSync)}` : 'Not synced yet'}
                {paused ? <small className="player-topbar__paused">· updates paused</small> : null}
              </a>
            ) : null}
          </div>
        )}
      >
        {overview.status === 'loading' ? <p className="intel-muted" role="status">Loading your dashboard…</p> : null}
        {overview.status === 'error' || overview.status === 'missing' ? (
          <div className="player-callout player-callout--warning" role="alert">
            <strong>{expired ? 'Your session has ended.' : 'Your dashboard could not be loaded.'}</strong>
            <p>{expired ? 'Sign in again to keep going.' : 'Guildweaver did not answer. Your data is safe; try again in a moment.'}</p>
            <Button variant="primary" size="sm" onClick={() => (expired ? session.signIn(signInReturnTo()) : window.location.reload())}>
              {expired ? 'Sign in with Discord' : 'Try again'}
            </Button>
          </div>
        ) : null}
        {ready ? (
          <>
            {section === 'overview' ? <PlayerOverview data={overview.data} server={server} onOpenCharacter={openCharacter} /> : null}
            {section === 'characters' ? <PlayerCharacters server={server} servers={servers} onOpenCharacter={openCharacter} /> : null}
            {section === 'professions' ? <PlayerProfessions server={server} onOpenCharacter={openCharacter} /> : null}
            {section === 'farming' ? <PlayerFarming server={server} /> : null}
            {section === 'sync' ? <PlayerSync data={overview.data} onChanged={overview.mutate} /> : null}
          </>
        ) : null}
      </IntelligenceAppShell>
      <CharacterProfileModal apiBase="/api/player/characters" characterId={characterId} onClose={() => openCharacter('')} />
    </>
  )
}
