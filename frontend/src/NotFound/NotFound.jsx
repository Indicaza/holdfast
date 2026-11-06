import { guildFeaturesEnabled } from '../Features/guildFeatures.js'
import JoinLink from '../Join/JoinLink.jsx'
import PageShell from '../PageShell/PageShell.jsx'
import './NotFound.css'

function NotFound() {
  return (
    <PageShell
      eyebrow="Lost in Azeroth"
      title="Nothing is waiting here."
      intro="This path does not lead anywhere, but the road back is short."
      centered
    >
      <div className="not-found__actions">
        <a className="not-found__primary" href="/">
          Return Home
        </a>
        {guildFeaturesEnabled ? (
          <JoinLink className="not-found__secondary">
            Join Holdfast
          </JoinLink>
        ) : (
          <a className="not-found__secondary" href="/dashboard">
            Open your dashboard
          </a>
        )}
      </div>
    </PageShell>
  )
}

export default NotFound
