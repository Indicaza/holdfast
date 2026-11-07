import Footer from '../Home/Footer/Footer.jsx'
import './PageShell.css'

// The frame for ordinary pages: background, a heading and the footer.
// `compact` uses a smaller heading for app pages such as Account; `bare`
// leaves the whole page, heading included, to the children.
function PageShell({
  eyebrow,
  title,
  intro,
  centered = false,
  compact = false,
  bare = false,
  className = '',
  children,
}) {
  const shellClassName = [
    'page-shell',
    centered ? 'page-shell--centered' : '',
    compact ? 'page-shell--compact' : '',
    bare ? 'page-shell--bare' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={shellClassName}>
      <div className="page-shell__background" aria-hidden="true" />

      <div className="page-shell__frame">
        <main className="page-shell__main">
          {bare ? children : (
            <>
              <header className="page-shell__header">
                {eyebrow ? <p className="page-shell__eyebrow">{eyebrow}</p> : null}
                <h1>{title}</h1>
                {intro ? <p className="page-shell__intro">{intro}</p> : null}
              </header>

              <div className="page-shell__body">{children}</div>
            </>
          )}
        </main>

        <Footer />
      </div>
    </div>
  )
}

export default PageShell
