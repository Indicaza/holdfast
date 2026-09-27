import Modal from '../Modal/Modal.jsx'
import { useSession } from '../Auth/SessionProvider.jsx'
import './MemberAccessModal.css'

function copyFor(status, authCode) {
  if (status === 'loading') {
    return {
      eyebrow: 'Holdfast',
      title: 'Checking your session',
      intro: 'One moment while Holdfast checks your member access.',
      action: null,
    }
  }

  if (status === 'error') {
    return {
      eyebrow: 'Holdfast',
      title: 'Connection problem',
      intro: 'Holdfast could not verify your member session. Try the connection again.',
      action: 'retry',
    }
  }

  if (authCode === 'cancelled') {
    return {
      eyebrow: 'Holdfast',
      title: 'Sign-in cancelled',
      intro: 'Nothing changed. Sign in when you are ready.',
      action: 'signin',
    }
  }

  if (authCode) {
    return {
      eyebrow: 'Holdfast',
      title: 'Discord sign-in failed',
      intro: 'We could not finish the Discord sign-in. Try again.',
      action: 'signin',
    }
  }

  return {
    eyebrow: 'Holdfast',
    title: 'Member sign in',
    intro: 'Use the Discord account that is already in Holdfast.',
    action: 'signin',
  }
}

function MemberAccessModal({ returnTo, onClose }) {
  const session = useSession()
  const authCode = new URLSearchParams(window.location.search).get('auth')
  const copy = copyFor(session.status, authCode)

  return (
    <Modal
      eyebrow={copy.eyebrow}
      title={copy.title}
      intro={copy.intro}
      onClose={onClose}
    >
      {session.status === 'loading' ? (
        <div className="member-access__loading" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <div className="member-access__actions">
          {copy.action === 'retry' ? (
            <button
              className="member-access__primary"
              type="button"
              onClick={session.refresh}
            >
              Retry
            </button>
          ) : (
            <button
              className="member-access__primary"
              type="button"
              onClick={() => session.signIn(returnTo, 'member')}
            >
              Sign in with Discord
            </button>
          )}

          <button
            className="member-access__secondary"
            type="button"
            onClick={onClose}
          >
            Back
          </button>
        </div>
      )}

      {session.status !== 'loading' ? (
        <a className="member-access__join" href="/join">
          New to Holdfast? Join the guild
        </a>
      ) : null}
    </Modal>
  )
}

export default MemberAccessModal
