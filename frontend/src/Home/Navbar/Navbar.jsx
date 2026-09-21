import { useEffect, useRef, useState } from 'react'
import { useSession } from '../../Auth/SessionProvider.jsx'
import './Navbar.css'

const links = [
  { label: 'Home', href: '/' },
  { label: 'Charter', href: '/charter' },
]

function displayName(user) {
  return user?.guildNickname || user?.globalName || user?.username || 'Member'
}

function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const accountRef = useRef(null)
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  const { authenticated, user, hasPermission, signIn, signOut } = useSession()

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
    try {
      await signOut()
      setAccountOpen(false)
    } catch {
      return
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
              const active = pathname === link.href

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
            {!authenticated ? (
              <button
                className="navbar__signin"
                type="button"
                onClick={() => signIn()}
              >
                Sign in
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
                    <a href="/guildos">GuildOS</a>
                    {hasPermission('site.admin') ? (
                      <a href="/admin">Control Room</a>
                    ) : null}
                    <button type="button" onClick={handleSignOut}>
                      Sign out
                    </button>
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
              aria-current={pathname === link.href ? 'page' : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </a>
          ))}
          {!authenticated ? (
            <button
              className="navbar__mobile-link navbar__mobile-signin"
              type="button"
              onClick={() => signIn()}
            >
              Sign in
            </button>
          ) : (
            <a
              className="navbar__mobile-link"
              href="/guildos"
              aria-current={pathname === '/guildos' ? 'page' : undefined}
            >
              GuildOS
            </a>
          )}
        </nav>
      </div>
    </header>
  )
}

export default Navbar
