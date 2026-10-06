import './Footer.css'

const sourceRepositoryUrl = 'https://github.com/Indicaza/holdfast'

function Footer() {
  return (
    <footer className="footer">
      <div className="footer__identity">
        <div className="footer__brand">
          <span className="footer__mark" aria-hidden="true">
            ♜
          </span>

          <div>
            <p className="footer__name">Holdfast</p>
            <p className="footer__motto">Servimus ut permaneat.</p>
          </div>
        </div>

        <p className="footer__maxim">Leave it stronger.</p>
      </div>

      <div className="footer__meta">
        <nav className="footer__links" aria-label="Footer links">
          <a href="/privacy">Privacy</a>
          <a href={sourceRepositoryUrl} target="_blank" rel="noreferrer">
            Source
          </a>
        </nav>

        <p className="footer__copyright">© {new Date().getFullYear()} Holdfast</p>
      </div>
    </footer>
  )
}

export default Footer
