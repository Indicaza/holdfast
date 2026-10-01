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
        <a className="not-found__secondary" href="/join">
          Join Holdfast
        </a>
      </div>
    </PageShell>
  )
}

export default NotFound
