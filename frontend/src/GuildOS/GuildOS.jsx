import PageShell from '../PageShell/PageShell.jsx'
import { useSession } from '../Auth/SessionProvider.jsx'
import './GuildOS.css'

function displayName(user) {
  return user?.guildNickname || user?.globalName || user?.username || 'member'
}

function authMessage(code) {
  if (code === 'not-member') {
    return {
      title: 'Join Discord first.',
      intro:
        'GuildOS uses your Holdfast Discord membership as your guild identity. Join the server, then connect your profile.',
    }
  }

  if (code === 'cancelled') {
    return {
      title: 'Connection cancelled.',
      intro: 'Nothing changed. You can connect your Discord account whenever you are ready.',
    }
  }

  if (code) {
    return {
      title: 'Discord connection failed.',
      intro: 'Try connecting again. If it keeps failing, let us know in Discord.',
    }
  }

  return {
    title: 'Members only.',
    intro: 'Connect the Discord account you use in Holdfast to open your guild workspace.',
  }
}

function GuildOS() {
  const session = useSession()
  const authCode = new URLSearchParams(window.location.search).get('auth')
  const signedOutCopy = authMessage(authCode)
  const joinHref = session.discordInviteUrl || '/#join-holdfast'

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
          {authCode === 'not-member' ? (
            <a
              className="guildos-auth__join"
              href={joinHref}
              {...(session.discordInviteUrl
                ? { target: '_blank', rel: 'noreferrer' }
                : {})}
            >
              Join Discord
            </a>
          ) : null}
          <button type="button" onClick={() => session.signIn('/guildos')}>
            Connect Discord
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
