import PageShell from '../PageShell/PageShell.jsx'
import { useSession } from '../Auth/SessionProvider.jsx'
import './GuildOS.css'

function displayName(user) {
  return user?.guildNickname || user?.globalName || user?.username || 'member'
}

function GuildOS() {
  const session = useSession()

  if (session.status === 'loading') {
    return (
      <PageShell
        eyebrow="GuildOS"
        title="Opening GuildOS."
        intro="Checking your guild session."
        centered
      />
    )
  }

  if (!session.authenticated) {
    return (
      <PageShell
        eyebrow="GuildOS"
        title="Members only."
        intro="Sign in with Discord to open your guild workspace."
        centered
      >
        <div className="guildos-auth">
          <button type="button" onClick={() => session.signIn()}>
            Sign in with Discord
          </button>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell
      eyebrow="GuildOS"
      title={`Welcome back, ${displayName(session.user)}.`}
      intro="This is the member side of GuildOS. Your tools will appear here as they come online."
    >
      <h2>Member systems are coming online.</h2>
      <p>
        Discord now establishes your identity and the guild resolves what you
        are allowed to see and manage. This page will become your home for
        missions, characters, professions, reputation, service marks, and
        other guild tools.
      </p>

      {session.hasPermission('site.admin') ? (
        <>
          <h2>Management access</h2>
          <p>
            Your account can access the <a href="/admin">Control Room</a>.
          </p>
        </>
      ) : null}
    </PageShell>
  )
}

export default GuildOS
