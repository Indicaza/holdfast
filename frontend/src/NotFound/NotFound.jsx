import JoinLink from '../Join/JoinLink.jsx'
import PageShell from '../PageShell/PageShell.jsx'
import './NotFound.css'

function NotFound() {
  return (
    <PageShell
      eyebrow="Lost in Azeroth"
      title="Nothing is waiting here."
      intro="This path does not lead anywhere, but the road back to Holdfast is short."
      centered
    >
      <div className="not-found__actions">
        <a className="not-found__primary" href="/">
          Return Home
        </a>
        <JoinLink className="not-found__secondary">
          Join Holdfast
        </JoinLink>
      </div>
    </PageShell>
  )
}

export default NotFound
