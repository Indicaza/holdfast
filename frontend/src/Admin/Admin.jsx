import PageShell from '../PageShell/PageShell.jsx'
import { useSession } from '../Auth/sessionContext.js'
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
        eyebrow="Guild Audit"
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
        eyebrow="Guild Audit"
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
        eyebrow="Guild Audit"
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

  const canViewAudit = session.hasPermission('audit.view')

  if (!canViewAudit) {
    return (
      <PageShell
        eyebrow="Guild Audit"
        title="No audit access"
        intro="You are signed in, but this account does not have access to internal administrative records."
        centered
        className="admin-page admin-page--gate"
      />
    )
  }

  return (
    <PageShell
      eyebrow="Guild Audit"
      title="Guild Audit"
      intro="Internal guild records and administrative history."
      centered
      className="admin-page"
    >
      <nav className="gw-admin-nav" aria-label="Admin sections">
        <a href="/admin" aria-current="page">Audit</a>
        {session.hasPermission('site.admin') ? <a href="/admin/guildweaver">Guildweaver</a> : null}
      </nav>
      <AuditLog />
    </PageShell>
  )
}

export default Admin
