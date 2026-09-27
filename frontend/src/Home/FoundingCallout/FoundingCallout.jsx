import { useSession } from '../../Auth/sessionContext.js'
import './FoundingCallout.css'

function FoundingCallout({ onJoin }) {
  const { authenticated } = useSession()

  return (
    <section
      id="join-holdfast"
      className="founding-callout"
      aria-labelledby="founding-callout-title"
    >
      <div className="founding-callout__copy">
        <p className="founding-callout__eyebrow">Join Holdfast</p>
        <h2 id="founding-callout-title">Come play with us.</h2>
        <p>
          No application gauntlet. Meet the guild, find your place, and get
          into the game.
        </p>
      </div>

      {authenticated ? (
        <a className="founding-callout__action" href="/guildos">
          Open GuildOS
        </a>
      ) : (
        <button
          className="founding-callout__action"
          type="button"
          onClick={onJoin}
        >
          Join Holdfast
        </button>
      )}

      <div className="founding-callout__mark" aria-hidden="true">
        ♜
      </div>
    </section>
  )
}

export default FoundingCallout
