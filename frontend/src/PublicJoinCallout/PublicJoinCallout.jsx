import { useSession } from '../Auth/sessionContext.js'
import { publicJoinAction } from './publicJoinAction.js'
import JoinLink from '../Join/JoinLink.jsx'
import './PublicJoinCallout.css'

function PublicJoinCallout({ title, description }) {
  const { authenticated, status, refresh } = useSession()
  const action = publicJoinAction(authenticated)

  return (
    <aside className="public-join-callout" aria-labelledby="public-join-title">
      <div>
        <p className="public-join-callout__eyebrow">{action.eyebrow}</p>
        <h2 id="public-join-title">{title}</h2>
        <p className="public-join-callout__description">{description}</p>
      </div>

      {status !== 'ready' ? (
        <button className="public-join-callout__action" type="button" disabled={status === 'loading'} onClick={refresh}>
          {status === 'loading' ? 'Checking session…' : 'Retry connection'}
        </button>
      ) : authenticated ? (
        <a className="public-join-callout__action" href={action.href}>{action.label}</a>
      ) : (
        <JoinLink className="public-join-callout__action">{action.label}</JoinLink>
      )}
    </aside>
  )
}

export default PublicJoinCallout
