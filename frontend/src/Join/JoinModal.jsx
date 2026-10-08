import { useEffect, useState } from 'react'
import { apiJson } from '../Api/apiClient.js'
import Modal from '../Modal/Modal.jsx'
import { useSession } from '../Auth/sessionContext.js'
import './Join.css'
import { currentReturnTo, safeReturnTo } from './joinDestination.js'

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

function JoinModal({ onClose, returnTo: requestedReturnTo = currentReturnTo() }) {
  const session = useSession()
  const [discordTarget, setDiscordTarget] = useState({
    appUrl: 'discord://-/channels/@me',
    webUrl: 'https://discord.com/app',
  })
  const searchParams = new URLSearchParams(window.location.search)
  const authCode = searchParams.get('auth')
  const returnTo = safeReturnTo(requestedReturnTo)
  const destination = new URL(returnTo, window.location.origin)
  const pendingSignup = destination.searchParams.has('signupQuest') && destination.searchParams.has('signupObjective')
  const notice = noticeFor(authCode)

  useEffect(() => {
    if (!session.authenticated || authCode !== 'connected') {
      return undefined
    }

    let active = true

    apiJson('/api/auth/discord/server')
      .then((target) => {
        if (
          active &&
          typeof target?.appUrl === 'string' &&
          target.appUrl.startsWith('discord://') &&
          typeof target?.webUrl === 'string' &&
          target.webUrl.startsWith('https://discord.com/')
        ) {
          setDiscordTarget(target)
        }
      })
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [authCode, session.authenticated])

  function openDiscord() {
    const fallback = window.setTimeout(() => {
      if (
        document.visibilityState === 'visible' &&
        document.hasFocus()
      ) {
        window.location.assign(discordTarget.webUrl)
      }
    }, 1600)

    const cancelFallback = () => window.clearTimeout(fallback)
    window.addEventListener('pagehide', cancelFallback, { once: true })

    try {
      window.location.assign(discordTarget.appUrl)
    } catch {
      cancelFallback()
      window.location.assign(discordTarget.webUrl)
    }
  }

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

  if (session.status === 'error') {
    return (
      <Modal eyebrow="Holdfast" title="Connection problem" intro="We could not check your member session. Try again to continue." onClose={onClose}>
        <div className="join-actions join-actions--single">
          <button className="join-action join-action--primary" type="button" onClick={session.refresh}>Retry connection</button>
        </div>
      </Modal>
    )
  }

  if (session.authenticated) {
    if (authCode === 'connected') {
      return (
        <Modal
          eyebrow="Welcome to Holdfast"
          title="You're in."
          intro="Discord is connected. Meet the crew, finish your profile, and get into the game."
          onClose={onClose}
        >
          <ol className="join-onboarding">
            <li>
              <strong>Open Discord.</strong>
              <span>Your account is already connected to the Holdfast server.</span>
            </li>
            <li>
              <strong>Say hello and play.</strong>
              <span>Find the crew, ask questions, or jump into a group.</span>
            </li>
            <li>
              <strong>Finish your profile.</strong>
              <span>Add whatever details you want the guild to see.</span>
            </li>
          </ol>

          <div className="join-actions">
            <button
              className="join-action join-action--primary"
              type="button"
              onClick={openDiscord}
            >
              Open Discord
            </button>
            <a className="join-action join-action--secondary" href={pendingSignup ? returnTo : '/members/me'}>
              {pendingSignup ? 'Continue to objective' : 'Set Up My Profile'}
            </a>
          </div>
        </Modal>
      )
    }

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
            Back
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

      {pendingSignup ? (
        <aside className="join-notice join-notice--info">
          <strong>Join first, then lend a hand.</strong>
          <span>We will bring you back to this objective so you can confirm your signup.</span>
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
