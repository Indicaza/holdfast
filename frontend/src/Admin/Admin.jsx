import PageShell from '../PageShell/PageShell.jsx'
import { useSession } from '../Auth/SessionProvider.jsx'
import './Admin.css'

const authMessages = {
  cancelled: 'Discord sign-in was cancelled.',
  'invalid-state': 'That sign-in attempt expired or could not be verified.',
  'missing-code': 'Discord did not return an authorization code.',
  'not-member': 'This Discord account is not a member of the guild server.',
  failed: 'Discord sign-in failed. Please try again.',
}

const permissionLabels = {
  'site.admin': 'Administrator',
  'campaigns.edit': 'Campaign Editor',
}

function displayName(user) {
  return user.guildNickname || user.globalName || user.username
}

function Admin() {
  const session = useSession()
  const authCode = new URLSearchParams(window.location.search).get('auth')
  const authMessage = authCode ? authMessages[authCode] : null

  if (session.status === 'loading') {
    return (
      <PageShell
        eyebrow="Control Room"
        title="Checking credentials."
        intro="The guild is verifying your session."
        centered
      />
    )
  }

  if (session.status === 'error') {
    return (
      <PageShell
        eyebrow="Control Room"
        title="Backend unavailable."
        intro="The guild API could not be reached."
        centered
      />
    )
  }

  if (!session.authenticated) {
    return (
      <PageShell
        eyebrow="Control Room"
        title="Sign in with Discord."
        intro="Discord establishes your identity. Guild permissions decide what you can manage."
        centered
      >
        <div className="admin-auth">
          {authMessage ? <p className="admin-auth__message">{authMessage}</p> : null}
          <button
            className="admin-auth__primary"
            type="button"
            onClick={() => session.signIn()}
          >
            Continue with Discord
          </button>
        </div>
      </PageShell>
    )
  }

  const hasAdminAccess = session.permissions?.length > 0

  return (
    <PageShell
      eyebrow="Control Room"
      title={hasAdminAccess ? 'Access confirmed' : 'Signed in'}
      intro={
        hasAdminAccess
          ? 'Your guild identity and permissions are ready.'
          : 'Your Discord identity is linked, but this account has no guild admin permissions.'
      }
      centered
      className="admin-page"
    >
      <section className="admin-profile" aria-labelledby="admin-profile-title">
        <div className="admin-profile__identity">
          {session.user.avatarUrl ? (
            <img
              src={session.user.avatarUrl}
              alt=""
              width="88"
              height="88"
              decoding="async"
            />
          ) : (
            <span className="admin-profile__avatar-fallback" aria-hidden="true">
              ♜
            </span>
          )}

          <h2 id="admin-profile-title">{displayName(session.user)}</h2>
          <p className="admin-profile__username">@{session.user.username}</p>
        </div>

        <div className="admin-profile__permissions">
          <p className="admin-profile__label">Guild permissions</p>
          {session.permissions?.length ? (
            <ul>
              {session.permissions.map((permission) => (
                <li key={permission}>
                  {permissionLabels[permission] ?? permission}
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-profile__empty">None assigned.</p>
          )}
        </div>
      </section>
    </PageShell>
  )
}

export default Admin
