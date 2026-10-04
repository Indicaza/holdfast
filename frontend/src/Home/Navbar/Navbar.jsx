import { useEffect, useRef, useState } from 'react'
import { useSession } from '../../Auth/sessionContext.js'
import {
  primaryNavigationLinks,
  signInNavigationLabel,
} from '../../navigation.js'
import './Navbar.css'

function displayName(user) {
  return user?.guildNickname || user?.globalName || user?.username || 'Member'
}

function isActiveLink(pathname, href) {
  if (href === '/members') {
    return pathname === '/members' || pathname.startsWith('/members/')
  }

  return pathname === href
}

function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const accountRef = useRef(null)
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  const { status, authenticated, user, hasPermission, signIn, signOut, refresh } = useSession()
  const links = primaryNavigationLinks(authenticated)

  useEffect(() => {
    if (!accountOpen) {
      return undefined
    }

    function handlePointerDown(event) {
      if (!accountRef.current?.contains(event.target)) {
        setAccountOpen(false)
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setAccountOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [accountOpen])

  async function handleSignOut() {
    setSigningOut(true)
    setSignOutError('')
    try {
      await signOut()
      setAccountOpen(false)
    } catch {
      setSignOutError('Could not sign out. Try again.')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <header className="navbar">
      <div className="navbar__inner">
        <a className="navbar__brand" href="/" aria-label="Holdfast home">
          <span className="navbar__brand-mark" aria-hidden="true">
            ♜
          </span>
          <span className="navbar__brand-name">Holdfast</span>
        </a>

        <div className="navbar__controls">
          <nav className="navbar__links" aria-label="Primary navigation">
            {links.map((link) => {
              const active = isActiveLink(pathname, link.href)

              return (
                <a
                  key={link.href}
                  className={`navbar__link ${active ? 'navbar__link--active' : ''}`}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                >
                  {link.label}
                </a>
              )
            })}
          </nav>

          <div className="navbar__actions">
            {status === 'loading' ? (
              <span className="navbar__session-state" role="status" aria-label="Checking member session" aria-busy="true">
                <span aria-hidden="true">•••</span>
              </span>
            ) : status === 'error' ? (
              <button className="navbar__sign-in-button" type="button" onClick={refresh}>Retry connection</button>
            ) : !authenticated ? (
              <button
                className="navbar__sign-in-button"
                type="button"
                onClick={() => signIn()}
              >
                {signInNavigationLabel}
              </button>
            ) : (
              <div className="navbar__account" ref={accountRef}>
                <button
                  className="navbar__account-button"
                  type="button"
                  aria-label={`Open account menu for ${displayName(user)}`}
                  aria-expanded={accountOpen}
                  onClick={() => setAccountOpen((open) => !open)}
                >
                  {user?.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt=""
                      width="36"
                      height="36"
                      decoding="async"
                    />
                  ) : (
                    <span aria-hidden="true">♜</span>
                  )}
                </button>

                <div
                  className={`navbar__account-menu ${accountOpen ? 'navbar__account-menu--open' : ''}`}
                >
                  <div className="navbar__account-identity">
                    <strong>{displayName(user)}</strong>
                    <span>@{user?.username}</span>
                  </div>

                  <div className="navbar__account-links">
                    <a href="/members/me">My Profile</a>
                    <a href="/members">Members</a>
                    {hasPermission('audit.view') ? (
                      <a href="/admin">Audit Log</a>
                    ) : null}
                    <button type="button" onClick={handleSignOut} disabled={signingOut}>
                      {signingOut ? 'Signing out…' : 'Sign out'}
                    </button>
                    {signOutError ? <p className="navbar__account-error" role="alert">{signOutError}</p> : null}
                  </div>
                </div>
              </div>
            )}

            <button
              className="navbar__menu-button"
              type="button"
              aria-label="Toggle navigation"
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span />
              <span />
            </button>
          </div>
        </div>

        <nav
          id="mobile-navigation"
          className={`navbar__mobile ${menuOpen ? 'navbar__mobile--open' : ''}`}
          aria-label="Mobile navigation"
        >
          {links.map((link) => (
            <a
              key={link.href}
              className="navbar__mobile-link"
              href={link.href}
              aria-current={isActiveLink(pathname, link.href) ? 'page' : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </a>
          ))}
          {authenticated ? (
            <>
              <a
                className="navbar__mobile-link"
                href="/members/me"
                aria-current={pathname === '/members/me' ? 'page' : undefined}
              >
                My Profile
              </a>
            </>
          ) : null}
        </nav>
      </div>
    </header>
  )
}

export default Navbar
