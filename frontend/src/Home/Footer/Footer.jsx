import './Footer.css'

const links = [
  { label: 'Discord', href: '/join' },
  { label: 'GitHub', href: 'https://github.com/Indicaza/holdfast', external: true },
  { label: 'GuildOS', href: '/guildos' },
  { label: 'Privacy', href: '/privacy' },
]

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
        {links.map((link) => (
          <a
            key={link.label}
            href={link.href}
            {...(link.external
              ? { target: '_blank', rel: 'noreferrer' }
              : {})}
          >
            {link.label}
          </a>
        ))}
      </nav>
    </footer>
  )
}

export default Footer
