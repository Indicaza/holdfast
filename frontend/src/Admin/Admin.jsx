import PageShell from '../PageShell/PageShell.jsx'
import { useSession } from '../Auth/SessionProvider.jsx'
import QuestEditor from './QuestEditor.jsx'
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
      />
    )
  }

  if (!session.authenticated) {
    return (
      <PageShell
        eyebrow="Control Room"
        title="Sign in with Discord"
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

  if (!session.hasPermission('quests.edit')) {
    return (
      <PageShell
        eyebrow="Control Room"
        title="No management access"
        intro="You are signed in, but this account does not have permission to edit guild quests."
        centered
        className="admin-page"
      />
    )
  }

  return (
    <PageShell
      eyebrow="Control Room"
      title="Guild Quests"
      intro="Publish quests, feature one on the home page, and manage objectives, assignments, and rewards."
      centered
      className="admin-page"
    >
      <QuestEditor />
    </PageShell>
  )
}

export default Admin
