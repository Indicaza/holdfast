import Footer from '../Home/Footer/Footer.jsx'
import Navbar from '../Home/Navbar/Navbar.jsx'
import './PageShell.css'

function PageShell({
  eyebrow,
  title,
  intro,
  centered = false,
  className = '',
  children,
}) {
  const shellClassName = [
    'page-shell',
    centered ? 'page-shell--centered' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={shellClassName}>
      <div className="page-shell__background" aria-hidden="true" />

      <Navbar />

      <div className="page-shell__frame">
        <main className="page-shell__main">
          <header className="page-shell__header">
            {eyebrow ? <p className="page-shell__eyebrow">{eyebrow}</p> : null}
            <h1>{title}</h1>
            {intro ? <p className="page-shell__intro">{intro}</p> : null}
          </header>

          <div className="page-shell__body">{children}</div>
        </main>

        <Footer />
      </div>
    </div>
  )
}

export default PageShell
