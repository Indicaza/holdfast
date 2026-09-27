import { useMemo, useState } from 'react'
import Modal from '../Modal/Modal.jsx'
import { useSession } from './SessionProvider.jsx'
import './AuthResultModal.css'

function displayName(user) {
  return user?.guildNickname || user?.globalName || user?.username || 'member'
}

function cleanAuthQuery() {
  const url = new URL(window.location.href)
  url.searchParams.delete('auth')
  return `${url.pathname}${url.search}${url.hash}`
}

function AuthResultModal() {
  const session = useSession()
  const [dismissed, setDismissed] = useState(false)
  const authCode = useMemo(
    () => new URLSearchParams(window.location.search).get('auth'),
    [],
  )

  if (!authCode || dismissed) {
    return null
  }

  const currentParams = new URLSearchParams(window.location.search)

  if (
    currentParams.get('signupQuest') &&
    currentParams.get('signupObjective')
  ) {
    return null
  }

  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'

  // The join flow owns its own modal and auth messaging.
  if (pathname === '/join') {
    return null
  }

  function close() {
    window.history.replaceState(null, '', cleanAuthQuery())
    setDismissed(true)
  }

  if (authCode === 'connected') {
    if (session.status === 'loading') {
      return (
        <Modal
          eyebrow="Discord"
          title="Finishing sign in."
          intro="Confirming your Holdfast member session."
          onClose={close}
        >
          <div className="auth-result__loading" aria-hidden="true">
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
          eyebrow="Discord connected"
          title={`Signed in as ${displayName(session.user)}.`}
          intro="Your Holdfast member session is active."
          onClose={close}
        >
          <div className="auth-result__identity">
            <div className="auth-result__avatar" aria-hidden="true">
              {session.user?.avatarUrl ? (
                <img
                  src={session.user.avatarUrl}
                  alt=""
                  width="64"
                  height="64"
                  decoding="async"
                />
              ) : (
                <span>♜</span>
              )}
            </div>
            <div>
              <strong>{displayName(session.user)}</strong>
              <span>@{session.user?.username}</span>
            </div>
          </div>

          <button
            className="auth-result__primary"
            type="button"
            onClick={close}
          >
            Continue
          </button>
        </Modal>
      )
    }

    return (
      <Modal
        eyebrow="Discord"
        title="Sign in could not be confirmed."
        intro="Discord returned successfully, but Holdfast could not verify the member session."
        onClose={close}
      >
        <div className="auth-result__actions">
          <button
            className="auth-result__primary"
            type="button"
            onClick={() => session.signIn()}
          >
            Try again
          </button>
          <button
            className="auth-result__secondary"
            type="button"
            onClick={close}
          >
            Close
          </button>
        </div>
      </Modal>
    )
  }

  const cancelled = authCode === 'cancelled'

  return (
    <Modal
      eyebrow="Discord"
      title={cancelled ? 'Sign-in cancelled.' : 'Discord sign-in failed.'}
      intro={
        cancelled
          ? 'Nothing changed. You can sign in whenever you are ready.'
          : 'Holdfast could not finish the Discord sign-in.'
      }
      onClose={close}
    >
      <div className="auth-result__actions">
        {!cancelled ? (
          <button
            className="auth-result__primary"
            type="button"
            onClick={() => session.signIn()}
          >
            Try again
          </button>
        ) : null}
        <button
          className="auth-result__secondary"
          type="button"
          onClick={close}
        >
          {cancelled ? 'Close' : 'Back'}
        </button>
      </div>
    </Modal>
  )
}

export default AuthResultModal
