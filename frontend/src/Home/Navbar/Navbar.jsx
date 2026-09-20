import { useState } from 'react'
import './Navbar.css'

const links = [
  { label: 'Home', href: '/' },
  { label: 'Charter', href: '/charter' },
]

function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'

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
            <a
              className={`navbar__join ${pathname === '/join' ? 'navbar__join--active' : ''}`}
              href="/join"
              aria-current={pathname === '/join' ? 'page' : undefined}
            >
              Join Holdfast
            </a>

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
          <a
            className="navbar__mobile-link navbar__mobile-link--join"
            href="/join"
            aria-current={pathname === '/join' ? 'page' : undefined}
          >
            Join Holdfast
          </a>
        </nav>
      </div>
    </header>
  )
}

export default Navbar
