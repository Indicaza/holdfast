import { useEffect, useRef, useState } from 'react'
import { useSession } from '../../Auth/sessionContext.js'
import { useGuild } from '../../Guild/guildContext.js'
import { GuildCrest } from '../../Guilds/GuildCrest.jsx'
import NotificationBell from '../../Notifications/NotificationBell.jsx'
import {
  accountMenuLinks,
  guildNavigationLinks,
  isActiveLink,
  myGuildLink,
  platformNavigationLinks,
  signInNavigationLabel,
} from '../../navigation.js'
import { HOLDFAST_SLUG, guildHref, guildNameFromSlug } from '../../routing.js'
import './Navbar.css'

function displayName(user) {
  return user?.guildNickname || user?.globalName || user?.username || 'Member'
}

// The guild's crest and name, home to its pages. Holdfast keeps its rook.
function GuildBrand({ slug, guild }) {
  const name = guild?.name || guildNameFromSlug(slug)
  return (
    <a className="navbar__brand navbar__brand--guild" href={guildHref(slug)} aria-label={`${name} home`}>
      {slug === HOLDFAST_SLUG ? (
        <span className="navbar__brand-mark" aria-hidden="true">♜</span>
      ) : guild ? (
        <span className="navbar__crest" aria-hidden="true">
          <GuildCrest name={guild.name} accentColor={guild.accentColor} faction={guild.faction} size={30} />
        </span>
      ) : (
        <span className="navbar__crest navbar__crest--loading" aria-hidden="true" />
      )}
      <span className="navbar__brand-name">{name}</span>
    </a>
  )
}

function PlatformBrand() {
  return (
    <a className="navbar__brand navbar__brand--platform" href="/" aria-label="Guildweaver home">
      <svg className="navbar__weave" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <path d="M4 7 C10 7 10 21 16 21 S22 7 24 7" />
        <path d="M4 21 C10 21 10 7 16 7 S22 21 24 21" />
      </svg>
      <span className="navbar__brand-name">Guildweaver</span>
    </a>
  )
}

// variant 'platform': Guildweaver's own pages. variant 'guild': every page
// under /:slug, for the guild in GuildContext.
function Navbar({ variant = 'platform' }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const accountRef = useRef(null)
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  const { status, authenticated, user, guild: memberGuild, signIn, signOut, refresh } = useSession()
  const { slug, guild } = useGuild()
  const inGuild = variant === 'guild'
  const links = inGuild ? guildNavigationLinks(slug, authenticated) : platformNavigationLinks
  const myGuild = !inGuild && authenticated ? myGuildLink(memberGuild) : null
  const accountLinks = accountMenuLinks(memberGuild)

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
    <header className={`navbar navbar--${variant}`}>
      <div className="navbar__inner">
        <div className="navbar__identity">
          {inGuild ? <GuildBrand slug={slug} guild={guild} /> : <PlatformBrand />}
          {inGuild ? (
            <a className="navbar__platform-link" href="/" aria-label="Back to Guildweaver">
              <span aria-hidden="true">←</span><span className="navbar__platform-label"> Guildweaver</span>
            </a>
          ) : null}
        </div>

        <div className="navbar__controls">
          <nav className="navbar__links" aria-label="Primary navigation">
            {links.map((link) => {
              const active = isActiveLink(pathname, link)

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
            {myGuild ? (
              <a className="navbar__link navbar__link--my-guild" href={myGuild.href}>
                {myGuild.label} <span aria-hidden="true">→</span>
              </a>
            ) : null}
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
              <>
                <NotificationBell />
                <div className="navbar__account" ref={accountRef}>
                  <button
                    className="navbar__account-button"
                    type="button"
                    aria-label={`Open account menu for ${displayName(user)}`}
                    aria-expanded={accountOpen}
                    onClick={() => setAccountOpen((open) => !open)}
                  >
                    {user?.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" width="36" height="36" decoding="async" />
                    ) : (
                      <span aria-hidden="true">♜</span>
                    )}
                  </button>

                  <div className={`navbar__account-menu ${accountOpen ? 'navbar__account-menu--open' : ''}`}>
                    <div className="navbar__account-identity">
                      <strong>{displayName(user)}</strong>
                      <span>@{user?.username}</span>
                    </div>

                    <div className="navbar__account-links">
                      {accountLinks.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
                      <button type="button" onClick={handleSignOut} disabled={signingOut}>
                        {signingOut ? 'Signing out…' : 'Sign out'}
                      </button>
                      {signOutError ? <p className="navbar__account-error" role="alert">{signOutError}</p> : null}
                    </div>
                  </div>
                </div>
              </>
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
              aria-current={isActiveLink(pathname, link) ? 'page' : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </a>
          ))}
          {myGuild ? (
            <a className="navbar__mobile-link" href={myGuild.href} onClick={() => setMenuOpen(false)}>{myGuild.label} →</a>
          ) : null}
          {authenticated ? accountLinks.filter((link) => link.href !== myGuild?.href && !links.some((shown) => shown.href === link.href)).map((link) => (
            <a key={link.href} className="navbar__mobile-link" href={link.href} aria-current={pathname === link.href ? 'page' : undefined} onClick={() => setMenuOpen(false)}>{link.label}</a>
          )) : null}
          {inGuild ? (
            <a className="navbar__mobile-link navbar__mobile-link--platform" href="/" onClick={() => setMenuOpen(false)}>← Guildweaver · Find guilds</a>
          ) : null}
        </nav>
      </div>
    </header>
  )
}

export default Navbar
