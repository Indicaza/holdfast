import { useSession } from '../../Auth/sessionContext.js'
import { foundingMission } from '../recruitmentContent.js'
import { foundingMissionAction } from './foundingMissionAction.js'
import './FoundingMission.css'

function FoundingMission({ onJoin }) {
  const { authenticated } = useSession()
  const action = foundingMissionAction(authenticated)

  return (
    <section
      className="founding-mission"
      aria-labelledby="founding-mission-title"
    >
      <div className="founding-mission__marker" aria-hidden="true">
        I
      </div>

      <div className="founding-mission__copy">
        <p className="founding-mission__eyebrow">{foundingMission.eyebrow}</p>
        <h2 id="founding-mission-title">{foundingMission.title}</h2>
        <p>{foundingMission.description}</p>
      </div>

      {authenticated ? (
        <a className="founding-mission__action" href={action.href}>
          {action.label}
        </a>
      ) : (
        <button
          className="founding-mission__action"
          type="button"
          onClick={onJoin}
        >
          {action.label}
        </button>
      )}
    </section>
  )
}

export default FoundingMission
