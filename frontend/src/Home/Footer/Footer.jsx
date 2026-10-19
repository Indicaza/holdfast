import { useGuild } from '../../Guild/guildContext.js'
import { HOLDFAST_SLUG } from '../../routing.js'
import './Footer.css'

const sourceRepositoryUrl = 'https://github.com/Indicaza/holdfast'

// Signed by the guild whose pages these are, or by Guildweaver on its own.
function footerIdentity({ slug, guild, status }) {
  if (status === 'none') return { name: 'Guildweaver', motto: 'Find your guild. Keep it together.', maxim: '' }
  if (slug === HOLDFAST_SLUG) return { name: 'Holdfast', motto: 'Servimus ut permaneat.', maxim: 'Leave it stronger.' }
  return { name: guild?.name || '', motto: guild?.tagline || '', maxim: '' }
}

function Footer() {
  const identity = footerIdentity(useGuild())

  return (
    <footer className="footer">
      <div className="footer__identity">
        <div className="footer__brand">
          <span className="footer__mark" aria-hidden="true">
            ♜
          </span>

          <div>
            <p className="footer__name">{identity.name}</p>
            {identity.motto ? <p className="footer__motto">{identity.motto}</p> : null}
          </div>
        </div>

        {identity.maxim ? <p className="footer__maxim">{identity.maxim}</p> : null}
      </div>

      <div className="footer__meta">
        <nav className="footer__links" aria-label="Footer links">
          <a href="/">Find guilds</a>
          <a href="/privacy">Privacy</a>
          <a href={sourceRepositoryUrl} target="_blank" rel="noreferrer">
            Source
          </a>
        </nav>

        <p className="footer__copyright">© {new Date().getFullYear()} {identity.name || 'Guildweaver'}</p>
      </div>
    </footer>
  )
}

export default Footer
