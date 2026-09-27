import { useSession } from '../../Auth/SessionProvider.jsx'
import './FoundingCallout.css'

function FoundingCallout() {
  const { authenticated, signIn } = useSession()

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
          Sign in with Discord. That joins the Holdfast server and creates your
          GuildOS profile in one step.
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
          onClick={() => signIn('/guildos')}
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
