import { useEffect, useState } from 'react'
import Modal from '../Modal/Modal.jsx'
import { signInReturnTo } from './returnTo.js'
import { useSession } from './sessionContext.js'
import { authResultMessage } from './authResult.js'
import './AuthResultModal.css'

function cleanAuthQuery() {
  const url = new URL(window.location.href)
  url.searchParams.delete('auth')
  return `${url.pathname}${url.search}${url.hash}`
}

// What came back from Discord sign-in (?auth=...). A successful sign-in just
// continues on the page it returned to: the navbar shows the player's avatar
// and the page shows their data, so there is nothing to confirm. Cancelled,
// failed and expired sign-ins say what happened and offer to try again.
function AuthResultModal() {
  const session = useSession()
  const [authCode, setAuthCode] = useState(() => new URLSearchParams(window.location.search).get('auth'))
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  // The join flow owns its own modal and auth messaging.
  const ownedElsewhere = pathname === '/join' || new URLSearchParams(window.location.search).get('signupQuest')
  const confirmed = authCode === 'connected' && session.status === 'ready' && session.authenticated

  function close() {
    window.history.replaceState(null, '', cleanAuthQuery())
    setAuthCode(null)
  }

  useEffect(() => {
    if (confirmed && !ownedElsewhere) {
      window.history.replaceState(null, '', cleanAuthQuery())
      setAuthCode(null)
    }
  }, [confirmed, ownedElsewhere])

  if (!authCode || ownedElsewhere || confirmed) return null
  // Still confirming the new session: the navbar shows that it is checking.
  if (authCode === 'connected' && session.status === 'loading') return null

  const message = authResultMessage(authCode, session.status)
  const retry = () => session.status === 'error' ? session.refresh() : session.signIn(signInReturnTo())

  return (
    <Modal eyebrow="Discord sign-in" title={message.title} intro={message.intro} onClose={close}>
      <div className="auth-result__actions">
        {message.retry ? (
          <button className="auth-result__primary" type="button" onClick={retry}>
            {message.retry}
          </button>
        ) : null}
        <button className="auth-result__secondary" type="button" onClick={close}>
          {message.retry ? 'Not now' : 'Close'}
        </button>
      </div>
    </Modal>
  )
}

export default AuthResultModal
