import { useSession } from '../../Auth/sessionContext.js'
import { foundingCalloutContent } from './foundingCalloutContent.js'
import './FoundingCallout.css'

function FoundingCallout({ onJoin }) {
  const { authenticated } = useSession()
  const content = foundingCalloutContent(authenticated)

  return (
    <section
      id="join-holdfast"
      className="founding-callout"
      aria-labelledby="founding-callout-title"
    >
      <div className="founding-callout__copy">
        <p className="founding-callout__eyebrow">{content.eyebrow}</p>
        <h2 id="founding-callout-title">{content.title}</h2>
        <p>{content.description}</p>
      </div>

      {authenticated ? (
        <a className="founding-callout__action" href={content.href}>
          {content.action}
        </a>
      ) : (
        <button
          className="founding-callout__action"
          type="button"
          onClick={onJoin}
        >
          {content.action}
        </button>
      )}

      <div className="founding-callout__mark" aria-hidden="true">
        ♜
      </div>
    </section>
  )
}

export default FoundingCallout
