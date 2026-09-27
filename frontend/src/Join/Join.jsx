import PageShell from '../PageShell/PageShell.jsx'
import { useSession } from '../Auth/SessionProvider.jsx'
import './Join.css'

function noticeFor(code) {
  if (code === 'not-member') {
    return {
      tone: 'info',
      title: 'You are not in Holdfast yet.',
      body: 'Nothing was changed. If you meant to join, continue below. If you were only trying to sign in, you can leave this page.',
    }
  }

  if (code === 'cancelled') {
    return {
      tone: 'quiet',
      title: 'Join cancelled.',
      body: 'Nothing was changed.',
    }
  }

  if (code === 'join-failed') {
    return {
      tone: 'error',
      title: 'Discord could not complete the join.',
      body: 'Your authorization worked, but the Holdfast bot could not add the account to the server. An officer may need to check the Discord integration.',
    }
  }

  if (code) {
    return {
      tone: 'error',
      title: 'Discord connection failed.',
      body: 'Nothing was changed. Try again, or ask an officer if the problem continues.',
    }
  }

  return null
}

function Join() {
  const session = useSession()
  const authCode = new URLSearchParams(window.location.search).get('auth')
  const notice = noticeFor(authCode)

  if (session.status === 'loading') {
    return (
      <PageShell
        eyebrow="Join Holdfast"
        title="Opening the gate."
        intro="Checking whether you are already a member."
        centered
      />
    )
  }

  if (session.authenticated) {
    return (
      <PageShell
        eyebrow="Join Holdfast"
        title="You are already in."
        intro="Your Discord account is connected and your Holdfast member profile is active."
        centered
      >
        <div className="join-complete">
          <a className="join-action join-action--primary" href="/guildos">
            Open GuildOS
          </a>
          <a className="join-action join-action--secondary" href="/">
            Back Home
          </a>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell
      eyebrow="Join Holdfast"
      title="Come play with us."
      intro="Joining should be simple, but it should never happen by accident."
      centered
      className="join-page"
    >
      {notice ? (
        <aside className={`join-notice join-notice--${notice.tone}`}>
          <strong>{notice.title}</strong>
          <span>{notice.body}</span>
        </aside>
      ) : null}

      <div className="join-path">
        <article className="join-step">
          <span className="join-step__number">01</span>
          <div>
            <h2>Know what you are joining.</h2>
            <p>
              Holdfast is an Alliance guild built around organized play,
              mentorship, useful contribution, and a community worth coming
              back to.
            </p>
            <a href="/charter">Read the Charter</a>
          </div>
        </article>

        <article className="join-step">
          <span className="join-step__number">02</span>
          <div>
            <h2>Join with Discord.</h2>
            <p>
              Discord is our front door. Continuing below will authorize your
              Discord account, add it to the Holdfast server, and create your
              GuildOS member profile.
            </p>
          </div>
        </article>

        <article className="join-step">
          <span className="join-step__number">03</span>
          <div>
            <h2>Come play.</h2>
            <p>
              No application gauntlet. Introduce yourself, find some people,
              and start playing. You do not need to arrive finished.
            </p>
          </div>
        </article>
      </div>

      <section className="join-consent" aria-labelledby="join-consent-title">
        <div>
          <p className="join-consent__eyebrow">Ready?</p>
          <h2 id="join-consent-title">Join Holdfast</h2>
          <p>
            This button will add your Discord account to the Holdfast server
            and create your GuildOS profile.
          </p>
        </div>

        <button
          className="join-action join-action--primary"
          type="button"
          onClick={() => session.signIn('/guildos', 'recruit')}
        >
          Continue with Discord
        </button>
      </section>

      <div className="join-member">
        <span>Already in the Holdfast Discord?</span>
        <button
          type="button"
          onClick={() => session.signIn('/guildos', 'member')}
        >
          Member sign in
        </button>
      </div>
    </PageShell>
  )
}

export default Join
