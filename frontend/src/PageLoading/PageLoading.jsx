import './PageLoading.css'

// Fills the page area below the navbar: the first page load, and members-only
// pages while the session check is still out (instead of flashing the home page).
function PageLoading({ label = 'Opening Holdfast…' }) {
  return (
    <main className="page-loading" aria-live="polite" aria-busy="true">
      <span className="page-loading__mark" aria-hidden="true">
        ♜
      </span>
      <span>{label}</span>
    </main>
  )
}

export default PageLoading
