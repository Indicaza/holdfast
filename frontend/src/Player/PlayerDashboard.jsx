import { useCallback, useEffect, useMemo, useState } from 'react'

import { signInReturnTo } from '../Auth/returnTo.js'
import { useSession } from '../Auth/sessionContext.js'
import { Button } from '../DesignSystem/index.js'
import '../Guildweaver/GuildweaverConnect.css'
import CharacterProfileModal from '../Intelligence/CharacterProfileModal.jsx'
import { useCharacterParam } from '../Intelligence/useCharacterParam.js'
import { useLiveUpdates } from '../Live/liveUpdatesContext.js'
import { useLiveResource } from '../Live/useLiveResource.js'
import { navigate } from '../Navigation/navigation.js'
import PageLoading from '../PageLoading/PageLoading.jsx'
import PageShell from '../PageShell/PageShell.jsx'
import CommandPalette from './CommandPalette.jsx'
import PlayerCharacters from './PlayerCharacters.jsx'
import PlayerFarming from './PlayerFarming.jsx'
import PlayerGathering from './PlayerGathering.jsx'
import PlayerOverview from './PlayerOverview.jsx'
import PlayerProfessions from './PlayerProfessions.jsx'
import PlayerShell from './PlayerShell.jsx'
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
import { Icon, SkeletonRows } from './ui.jsx'
import './Player.css'
import './PlayerApp.css'

function SignedOut({ session }) {
  return (
    <PageShell
      eyebrow="Guildweaver"
      title="Your dashboard"
      intro="Community drop rates for every herb, vein, pool and creature, plus your own characters, professions and gathering. Private to you. No guild required."
      centered
      compact
    >
      <div className="player-signed-out">
        <p>Sign in with Discord to search drop rates and connect Guildweaver on your computer.</p>
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

function ServerPicker({ servers, server, onChange }) {
  return (
    <label className="gw-server">
      <span className="gw-server__label">Server</span>
      <select aria-label="Server" value={server} onChange={(event) => onChange(event.target.value)} disabled={!servers.length}>
        <option value="">All servers</option>
        {servers.map((entry) => <option key={entry.key} value={entry.key}>{entry.label} ({entry.characterCount})</option>)}
      </select>
      <Icon name="sort" size={14} />
    </label>
  )
}

function SyncStatus({ sync, ready, paused, server }) {
  if (!ready) return null
  const lastSync = sync?.lastUploadAt || sync?.lastCharacterAt
  return (
    <a className="gw-sync" href={dashboardHref('sync', server)} title="Your devices and sync status">
      <span className={`gw-dot gw-dot--${sync?.state || 'unknown'}`} aria-hidden="true" />
      <span className="gw-sync__copy">
        <strong>{lastSync ? `Synced ${relativeTime(lastSync)}` : 'Not synced yet'}</strong>
        {paused ? <small>Live updates paused</small> : <small>{sync?.connectedDevices ? `${sync.connectedDevices} device${sync.connectedDevices === 1 ? '' : 's'}` : 'No device connected'}</small>}
      </span>
    </a>
  )
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

function useStoredFlag(key) {
  const [value, setValue] = useState(() => {
    try {
      return window.localStorage.getItem(key) === 'collapsed'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(key, value ? 'collapsed' : 'expanded')
    } catch {
      // Remembering the sidebar is a convenience.
    }
  }, [key, value])
  return [value, setValue]
}

// ⌘K / Ctrl+K anywhere, or / outside a text field, opens search.
function useSearchShortcut(open) {
  useEffect(() => {
    function onKeyDown(event) {
      const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        open()
      } else if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        open()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])
}

export default function PlayerDashboard({ section = 'overview', queryString = '' }) {
  const live = useLiveUpdates()
  const session = useSession()
  const userId = session.authenticated ? session.user?.id || '' : ''
  const overview = useLiveResource('/api/player/overview', { topics: PLAYER_TOPICS, enabled: session.authenticated })
  const servers = useMemo(() => overview.data?.servers || [], [overview.data])
  const requested = useServerParam()
  const ready = overview.status === 'ready'
  const server = ready ? resolveServer({ requested, stored: storedServer(userId), servers }) : requested
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useStoredFlag('guildweaver:dashboard:rail')
  const [searchOpen, setSearchOpen] = useState(false)
  const openSearch = useCallback(() => setSearchOpen(true), [])
  const closeSearch = useCallback(() => setSearchOpen(false), [])
  const [characterId, openCharacter] = useCharacterParam()
  useSearchShortcut(session.authenticated ? openSearch : noop)

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

  const views = useMemo(() => DASHBOARD_VIEWS.map((view) => ({ ...view, href: dashboardHref(view.id, server) })), [server])
  const characters = useMemo(() => overview.data?.characters || [], [overview.data])

  if (session.status === 'loading') return <PageLoading label="Checking your session…" />
  if (session.status === 'error' || !session.authenticated) return <SignedOut session={session} />

  const current = views.find((view) => view.id === section) || views[0]
  const expired = overview.error?.status === 401
  const paused = live.status === 'offline' || live.status === 'reconnecting'
  const sourceOpen = section === 'farming' && new URLSearchParams(queryString).has('source')

  return (
    <>
      <PlayerShell
        views={views}
        activeView={current.id}
        title={current.label}
        eyebrow={current.group === 'explore' ? 'Community' : serverLabel(servers, server)}
        description={sourceOpen ? 'One source: its drop table, hotspots, and what changes the odds' : current.description}
        serverPicker={<ServerPicker servers={servers} server={server} onChange={changeServer} />}
        syncStatus={<SyncStatus sync={overview.data?.sync} ready={ready} paused={paused} server={server} />}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        onToggleMobile={setMobileOpen}
        onOpenSearch={openSearch}
      >
        {overview.status === 'loading' ? <SkeletonRows rows={8} label="Loading your dashboard" /> : null}
        {overview.status === 'error' || overview.status === 'missing' ? (
          <div className="gw-callout gw-callout--warning" role="alert">
            <div>
              <strong>{expired ? 'Your session has ended.' : 'Your dashboard could not be loaded.'}</strong>
              <p>{expired ? 'Sign in again to keep going.' : 'Guildweaver did not answer. Your data is safe; try again in a moment.'}</p>
            </div>
            <button type="button" className="gw-btn gw-btn--primary gw-btn--sm" onClick={() => (expired ? session.signIn(signInReturnTo()) : window.location.reload())}>
              {expired ? 'Sign in with Discord' : 'Try again'}
            </button>
          </div>
        ) : null}
        {ready ? (
          <>
            {section === 'overview' ? <PlayerOverview data={overview.data} server={server} onOpenCharacter={openCharacter} onOpenSearch={openSearch} /> : null}
            {section === 'farming' ? <PlayerFarming server={server} queryString={queryString} /> : null}
            {section === 'characters' ? <PlayerCharacters server={server} servers={servers} onOpenCharacter={openCharacter} /> : null}
            {section === 'professions' ? <PlayerProfessions server={server} onOpenCharacter={openCharacter} /> : null}
            {section === 'gathering' ? <PlayerGathering server={server} /> : null}
            {section === 'sync' ? <PlayerSync data={overview.data} onChanged={overview.mutate} /> : null}
          </>
        ) : null}
      </PlayerShell>
      <CommandPalette open={searchOpen} onClose={closeSearch} characters={characters} views={views} onOpenCharacter={openCharacter} />
      <CharacterProfileModal apiBase="/api/player/characters" characterId={characterId} onClose={() => openCharacter('')} />
    </>
  )
}

function noop() {}
