import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { signInReturnTo } from '../../Auth/returnTo.js'
import { useSession } from '../../Auth/sessionContext.js'
import { guildFeaturesEnabled } from '../../Features/guildFeatures.js'
import { useGuild } from '../../Guild/guildContext.js'
import { GuildCrest } from '../../Guilds/GuildCrest.jsx'
import { subscribeLocation } from '../../Navigation/navigation.js'
import NotificationBell from '../../Notifications/NotificationBell.jsx'
import {
  accountMenuLinks,
  guildNavigationLinks,
  isActiveLink,
  myGuildLink,
  playerDisplayName,
  primaryNavigationLinks,
  signInNavigationLabel,
} from '../../navigation.js'
import { HOLDFAST_SLUG, guildHref, guildNameFromSlug } from '../../routing.js'
import './Navbar.css'

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

function initials(name) {
  return String(name || '?').trim().slice(0, 1).toUpperCase() || '?'
}

// Closes a popup on Escape (focus back to its button), on a press outside it,
// and when the page changes.
function useDismiss(open, setOpen, { containerRef, buttonRef }) {
  useEffect(() => {
    if (!open) return undefined
    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) setOpen(false)
    }
    function handleKeyDown(event) {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, setOpen, containerRef, buttonRef])

  useEffect(() => subscribeLocation(() => setOpen(false)), [setOpen])
}

// The signed-in player's avatar and menu (a menu button: arrow keys, Home and
// End move between items; Escape and Tab close it).
function AccountMenu({ user, links, pathname, onSignOut }) {
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const containerRef = useRef(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const focusFirst = useRef(false)
  const menuId = useId()
  const name = playerDisplayName(user, { guildFeatures: guildFeaturesEnabled })
  useDismiss(open, setOpen, { containerRef, buttonRef })

  const items = useCallback(() => [...(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])], [])

  useEffect(() => {
    if (open && focusFirst.current) items()[0]?.focus()
    focusFirst.current = false
  }, [open, items])

  function openMenu(withFocus) {
    focusFirst.current = withFocus
    setOpen(true)
  }

  function handleButtonKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openMenu(true)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      requestAnimationFrame(() => items().at(-1)?.focus())
    }
  }

  function handleMenuKeyDown(event) {
    const list = items()
    const index = list.indexOf(document.activeElement)
    const move = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: list.length - 1 }[event.key]
    if (move !== undefined) {
      event.preventDefault()
      list[(move + list.length) % list.length]?.focus()
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  async function handleSignOut() {
    setSigningOut(true)
    setSignOutError('')
    try {
      await onSignOut()
      setOpen(false)
    } catch {
      setSignOutError('Could not sign out. Try again.')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="navbar__account" ref={containerRef}>
      <button
        ref={buttonRef}
        className="navbar__account-button"
        type="button"
        aria-label={`Account menu for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => (open ? setOpen(false) : openMenu(false))}
        onKeyDown={handleButtonKeyDown}
      >
        {user?.avatarUrl ? (
          <img src={user.avatarUrl} alt="" width="36" height="36" decoding="async" />
        ) : (
          <span className="navbar__account-initial" aria-hidden="true">{initials(name)}</span>
        )}
      </button>

      <div
        id={menuId}
        ref={menuRef}
        className={`navbar__account-menu ${open ? 'navbar__account-menu--open' : ''}`}
        role="menu"
        aria-label="Account"
        onKeyDown={handleMenuKeyDown}
      >
        <div className="navbar__account-identity" role="presentation">
          <strong>{name}</strong>
          {user?.username ? <span>@{user.username}</span> : null}
        </div>

        <div className="navbar__account-links" role="presentation">
          {links.map((link) => (
            <a
              key={link.href}
              role="menuitem"
              tabIndex={-1}
              href={link.href}
              aria-current={isActiveLink(pathname, link) ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <button role="menuitem" tabIndex={-1} type="button" onClick={handleSignOut} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
          {signOutError ? <p className="navbar__account-error" role="alert">{signOutError}</p> : null}
        </div>
      </div>
    </div>
  )
}

// variant 'platform': Guildweaver's own pages. variant 'guild': every page
// under /:slug, for the guild in GuildContext (guild features only).
function Navbar({ variant = 'platform' }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuContainerRef = useRef(null)
  const menuButtonRef = useRef(null)
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  const { status, authenticated, user, guild: memberGuild, signIn, signOut, refresh, hasPermission } = useSession()
  const { slug, guild } = useGuild()
  const inGuild = variant === 'guild'
  const links = inGuild ? guildNavigationLinks(slug, authenticated) : primaryNavigationLinks(guildFeaturesEnabled)
  const myGuild = guildFeaturesEnabled && !inGuild && authenticated ? myGuildLink(memberGuild) : null
  const accountLinks = accountMenuLinks(memberGuild, { guildFeatures: guildFeaturesEnabled, admin: hasPermission('site.admin') })
  useDismiss(menuOpen, setMenuOpen, { containerRef: menuContainerRef, buttonRef: menuButtonRef })

  return (
    <header className={`navbar navbar--${variant}`}>
      <div className="navbar__inner" ref={menuContainerRef}>
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
              // Holds the avatar's place so nothing shifts when the session
              // answers.
              <span className="navbar__session-state" role="status" aria-label="Checking sign-in" aria-busy="true" />
            ) : status === 'error' ? (
              <button className="navbar__sign-in-button" type="button" onClick={refresh}>Retry connection</button>
            ) : !authenticated ? (
              <button className="navbar__sign-in-button" type="button" onClick={() => signIn(signInReturnTo())}>
                {signInNavigationLabel}
              </button>
            ) : (
              <>
                {guildFeaturesEnabled ? <NotificationBell /> : null}
                <AccountMenu user={user} links={accountLinks} pathname={pathname} onSignOut={signOut} />
              </>
            )}

            <button
              ref={menuButtonRef}
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
            <a key={link.href} className="navbar__mobile-link" href={link.href} aria-current={isActiveLink(pathname, link) ? 'page' : undefined} onClick={() => setMenuOpen(false)}>{link.label}</a>
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
