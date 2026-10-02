import PageShell from '../PageShell/PageShell.jsx'
import { useSession } from '../Auth/sessionContext.js'
import QuestEditor from './QuestEditor.jsx'
import AuditLog from './AuditLog.jsx'
import './Admin.css'

const authMessages = {
  cancelled: 'Discord sign-in was cancelled.',
  'invalid-state': 'That sign-in attempt expired or could not be verified.',
  'missing-code': 'Discord did not return an authorization code.',
  'not-member': 'This Discord account is not a member of the guild server.',
  failed: 'Discord sign-in failed. Please try again.',
}

function Admin() {
  const session = useSession()
  const authCode = new URLSearchParams(window.location.search).get('auth')
  const authMessage = authCode ? authMessages[authCode] : null

  if (session.status === 'loading') {
    return (
      <PageShell
        eyebrow="Control Room"
        title="Checking credentials"
        intro="The guild is verifying your session."
        centered
        className="admin-page admin-page--gate"
      />
    )
  }

  if (session.status === 'error') {
    return (
      <PageShell
        eyebrow="Control Room"
        title="Backend unavailable"
        intro="The guild API could not be reached."
        centered
        className="admin-page admin-page--gate"
      >
        <div className="admin-auth">
          <button
            className="admin-auth__primary"
            type="button"
            onClick={() => session.refresh()}
          >
            Retry connection
          </button>
        </div>
      </PageShell>
    )
  }

  if (!session.authenticated) {
    return (
      <PageShell
        eyebrow="Control Room"
        title="Sign in with Discord"
        intro="Discord establishes your identity. Guild permissions decide what you can manage."
        centered
        className="admin-page admin-page--gate"
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

  const canManageQuests = [
    'quests.create',
    'quests.edit',
    'quests.publish',
    'rewards.approve',
    'rewards.issue',
    'rewards.policy.edit',
  ].some((permission) => session.hasPermission(permission))

  if (!canManageQuests) {
    return (
      <PageShell
        eyebrow="Control Room"
        title="No management access"
        intro="You are signed in, but this account does not have quest or reward management authority."
        centered
        className="admin-page admin-page--gate"
      />
    )
  }

  return (
    <PageShell
      eyebrow="Control Room"
      title="Guild Control Room"
      intro="Manage quests, rewards, and guild operations."
      centered
      className="admin-page"
    >
      <QuestEditor />
      {session.hasPermission('audit.view') ? <AuditLog /> : null}
    </PageShell>
  )
}

export default Admin
