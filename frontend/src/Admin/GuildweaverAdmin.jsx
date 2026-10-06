import PageShell from '../PageShell/PageShell.jsx'
import { useSession } from '../Auth/sessionContext.js'
import GuildweaverConsole from './GuildweaverConsole.jsx'
import './Admin.css'

function Gate({ session }) {
  if (session.status === 'loading') {
    return <PageShell eyebrow="Guildweaver Admin" title="Checking credentials" intro="Verifying administrative access." centered className="admin-page admin-page--gate" />
  }

  if (session.status === 'error') {
    return (
      <PageShell eyebrow="Guildweaver Admin" title="Backend unavailable" intro="Holdfast could not verify your session." centered className="admin-page admin-page--gate">
        <div className="admin-auth"><button className="admin-auth__primary" type="button" onClick={() => session.refresh()}>Retry connection</button></div>
      </PageShell>
    )
  }

  if (!session.authenticated) {
    return (
      <PageShell eyebrow="Guildweaver Admin" title="Sign in with Discord" intro="Administrative access is required to inspect Guildweaver payloads." centered className="admin-page admin-page--gate">
        <div className="admin-auth"><button className="admin-auth__primary" type="button" onClick={() => session.signIn()}>Continue with Discord</button></div>
      </PageShell>
    )
  }

  return <PageShell eyebrow="Guildweaver Admin" title="No admin access" intro="This account does not have website administration access." centered className="admin-page admin-page--gate" />
}

export default function GuildweaverAdmin() {
  const session = useSession()
  const canView = session.authenticated && session.hasPermission('site.admin')

  if (!canView) return <Gate session={session} />

  return (
    <PageShell
      eyebrow="Guildweaver Admin"
      title="Sync Console"
      intro="See exactly what Guildweaver is sending, when it arrived, and how each character changes over time."
      centered
      className="admin-page guildweaver-admin-page"
    >
      <nav className="admin-nav" aria-label="Admin sections">
        <a href="/admin">Audit</a>
        <a href="/admin/guildweaver" aria-current="page">Guildweaver</a>
      </nav>
      <GuildweaverConsole />
    </PageShell>
  )
}
