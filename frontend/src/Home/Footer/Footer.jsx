import JoinLink from '../../Join/JoinLink.jsx'
import './Footer.css'
import { footerNavigationLinks } from '../../navigation.js'

function Footer() {
  return (
    <footer className="footer">
      <div className="footer__brand">
        <span className="footer__mark" aria-hidden="true">
          ♜
        </span>

        <div>
          <p className="footer__name">Holdfast</p>
          <p className="footer__motto">Servimus ut permaneat.</p>
        </div>
      </div>

      <nav className="footer__links" aria-label="Footer navigation">
        {footerNavigationLinks.map((link) => {
          if (link.href === '/join') {
            return <JoinLink key={link.label}>{link.label}</JoinLink>
          }

          return (
            <a
              key={link.label}
              href={link.href}
              target={link.external ? '_blank' : undefined}
              rel={link.external ? 'noreferrer' : undefined}
            >
              {link.label}
            </a>
          )
        })}
      </nav>
    </footer>
  )
}

export default Footer
