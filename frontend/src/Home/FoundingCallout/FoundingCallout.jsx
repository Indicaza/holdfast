import { useSession } from '../../Auth/SessionProvider.jsx'
import './FoundingCallout.css'

function FoundingCallout() {
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
          No application gauntlet. See what joining means, connect Discord,
          and get into the guild.
        </p>
      </div>

      <a
        className="founding-callout__action"
        href={authenticated ? '/guildos' : '/join'}
      >
        {authenticated ? 'Open GuildOS' : 'Join Holdfast'}
      </a>

      <div className="founding-callout__mark" aria-hidden="true">
        ♜
      </div>
    </section>
  )
}

export default FoundingCallout
