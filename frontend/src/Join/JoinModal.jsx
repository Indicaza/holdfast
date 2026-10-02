import Modal from '../Modal/Modal.jsx'
import { useSession } from '../Auth/sessionContext.js'
import './Join.css'

function noticeFor(code) {
  if (code === 'not-member') {
    return {
      tone: 'info',
      title: 'New to Holdfast?',
      body: 'That Discord account is not a member yet. If you are here to join, continue below.',
    }
  }

  if (code === 'cancelled') {
    return {
      tone: 'quiet',
      title: 'Discord connection cancelled.',
      body: 'You can continue whenever you are ready.',
    }
  }

  if (code === 'join-failed') {
    return {
      tone: 'error',
      title: 'We could not finish the Discord join.',
      body: 'Try again, or ask an officer if the problem continues.',
    }
  }

  if (code) {
    return {
      tone: 'error',
      title: 'Discord connection failed.',
      body: 'Try again, or ask an officer if the problem continues.',
    }
  }

  return null
}

function safeReturnTo(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/'
  }

  return value
}

function JoinModal({ onClose }) {
  const session = useSession()
  const searchParams = new URLSearchParams(window.location.search)
  const authCode = searchParams.get('auth')
  const returnTo = safeReturnTo(searchParams.get('returnTo'))
  const notice = noticeFor(authCode)

  if (session.status === 'loading') {
    return (
      <Modal
        eyebrow="Join Holdfast"
        title="Opening the gate."
        intro="Checking your Holdfast session."
        onClose={onClose}
      >
        <div className="join-loading" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </Modal>
    )
  }

  if (session.authenticated) {
    return (
      <Modal
        eyebrow="Holdfast"
        title="You are already in."
        intro="Your Discord identity is connected and your Holdfast member profile is active."
        onClose={onClose}
      >
        <div className="join-actions join-actions--centered">
          <a className="join-action join-action--primary" href="/members/me">
            My Profile
          </a>
          <button
            className="join-action join-action--secondary"
            type="button"
            onClick={onClose}
          >
            Back Home
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      eyebrow="Join Holdfast"
      title="Come play with us."
      intro="Continue with Discord to join the Holdfast server and create your member profile. No application. No interview."
      onClose={onClose}
    >
      {notice ? (
        <aside className={`join-notice join-notice--${notice.tone}`}>
          <strong>{notice.title}</strong>
          <span>{notice.body}</span>
        </aside>
      ) : null}

      <div className="join-quick-facts" aria-label="Holdfast recruitment basics">
        <span>New players welcome</span>
        <span>No attendance requirement</span>
        <span>PvP realm at launch</span>
      </div>

      <div className="join-actions join-actions--single">
        <button
          className="join-action join-action--primary"
          type="button"
          onClick={() => session.signIn(returnTo, 'recruit')}
        >
          Continue with Discord
        </button>
      </div>

      <a className="join-charter-link" href="/charter">
        Read the Charter
      </a>

      <div className="join-member">
        <span>Already a member?</span>
        <button
          type="button"
          onClick={() => session.signIn(returnTo, 'member')}
        >
          Sign in
        </button>
      </div>
    </Modal>
  )
}

export default JoinModal
