import PageShell from '../PageShell/PageShell.jsx'
import { useSession } from '../Auth/SessionProvider.jsx'
import './GuildOS.css'

function displayName(user) {
  return user?.guildNickname || user?.globalName || user?.username || 'member'
}

function authMessage(code) {
  if (code === 'cancelled') {
    return {
      title: 'Sign in cancelled.',
      intro: 'Nothing changed. Sign in whenever you are ready.',
    }
  }

  if (code) {
    return {
      title: 'Discord sign in failed.',
      intro: 'Try again. If it keeps failing, check the backend console for the Discord API error.',
    }
  }

  return {
    title: 'Member sign in.',
    intro: 'Already in Holdfast? Sign in with Discord to open GuildOS.',
  }
}

function GuildOS() {
  const session = useSession()
  const authCode = new URLSearchParams(window.location.search).get('auth')
  const signedOutCopy = authMessage(authCode)

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
        title={signedOutCopy.title}
        intro={signedOutCopy.intro}
        centered
      >
        <div className="guildos-auth">
          <button
            type="button"
            onClick={() => session.signIn('/guildos', 'member')}
          >
            Sign in with Discord
          </button>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell
      eyebrow="GuildOS"
      title={`Welcome, ${displayName(session.user)}.`}
      intro="Your Discord identity is connected and your Holdfast member profile is active."
    >
      <section className="guildos-profile" aria-labelledby="guildos-profile-title">
        <div className="guildos-profile__avatar" aria-hidden="true">
          {session.user?.avatarUrl ? (
            <img
              src={session.user.avatarUrl}
              alt=""
              width="96"
              height="96"
              decoding="async"
            />
          ) : (
            <span>♜</span>
          )}
        </div>

        <div className="guildos-profile__identity">
          <p className="guildos-profile__status">
            <span aria-hidden="true" />
            Discord connected
          </p>
          <h2 id="guildos-profile-title">{displayName(session.user)}</h2>
          <p>@{session.user?.username}</p>
        </div>

        <div className="guildos-profile__note">
          <strong>Member profile active</strong>
          <span>
            Rep, Service Marks, assignments, contributions, and requests will
            live here as those systems come online.
          </span>
        </div>
      </section>

      {session.hasPermission('site.admin') || session.hasPermission('quests.edit') ? (
        <section className="guildos-management">
          <h2>Management access</h2>
          <p>
            Your account can access the <a href="/admin">Control Room</a>.
          </p>
        </section>
      ) : null}
    </PageShell>
  )
}

export default GuildOS
