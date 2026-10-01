import { useSession } from '../Auth/sessionContext.js'
import { publicJoinAction } from './publicJoinAction.js'
import './PublicJoinCallout.css'

function PublicJoinCallout({ title, description }) {
  const { authenticated } = useSession()
  const action = publicJoinAction(authenticated)

  return (
    <aside className="public-join-callout" aria-labelledby="public-join-title">
      <div>
        <p className="public-join-callout__eyebrow">{action.eyebrow}</p>
        <h2 id="public-join-title">{title}</h2>
        <p className="public-join-callout__description">{description}</p>
      </div>

      <a className="public-join-callout__action" href={action.href}>
        {action.label}
      </a>
    </aside>
  )
}

export default PublicJoinCallout
