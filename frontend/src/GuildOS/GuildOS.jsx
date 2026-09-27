import { useCallback } from 'react'
import Home from '../Home/Home.jsx'
import MemberAccessModal from '../Members/MemberAccessModal.jsx'
import PageShell from '../PageShell/PageShell.jsx'
import { useSession } from '../Auth/SessionProvider.jsx'
import './GuildOS.css'

function displayName(user) {
  return user?.guildNickname || user?.globalName || user?.username || 'member'
}

function GuildOS() {
  const session = useSession()
  const close = useCallback(() => {
    window.location.assign('/')
  }, [])

  if (
    session.status === 'loading' ||
    session.status === 'error' ||
    !session.authenticated
  ) {
    return (
      <Home
        overlay={
          <MemberAccessModal
            returnTo="/guildos"
            onClose={close}
          />
        }
      />
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
            Your service record now tracks Rep, Service Marks, completed
            objectives, and current assignments.
          </span>
          <div className="guildos-profile__links">
            <a href="/members/me">My Profile</a>
            <a href="/members">Member Directory</a>
          </div>
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
