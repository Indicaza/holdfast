import { useSession } from '../../Auth/SessionProvider.jsx'
import './FoundingCallout.css'

function FoundingCallout() {
  const { authenticated, discordInviteUrl, signIn } = useSession()
  const joinHref = discordInviteUrl || '#join-holdfast'

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
          No application gauntlet. Join the Discord, connect the same account,
          and your guild profile is ready.
        </p>
      </div>

      <div className="founding-callout__steps">
        <article className="founding-callout__step">
          <span className="founding-callout__step-number">01</span>
          <div>
            <h3>Join Discord</h3>
            <p>Meet the guild and get into the conversation.</p>
          </div>
          <a
            className="founding-callout__primary"
            href={joinHref}
            {...(discordInviteUrl ? { target: '_blank', rel: 'noreferrer' } : {})}
          >
            Join Discord
          </a>
        </article>

        <article className="founding-callout__step">
          <span className="founding-callout__step-number">02</span>
          <div>
            <h3>{authenticated ? 'Profile connected' : 'Create guild profile'}</h3>
            <p>
              {authenticated
                ? 'Your Discord identity is connected to GuildOS.'
                : 'Use Discord once more to create your member profile.'}
            </p>
          </div>

          {authenticated ? (
            <a className="founding-callout__secondary" href="/guildos">
              Open GuildOS
            </a>
          ) : (
            <button
              className="founding-callout__secondary"
              type="button"
              onClick={() => signIn('/guildos')}
            >
              Connect Profile
            </button>
          )}
        </article>
      </div>

      <div className="founding-callout__mark" aria-hidden="true">
        ♜
      </div>
    </section>
  )
}

export default FoundingCallout
