import './PageLoading.css'

function PageLoading() {
  return (
    <main className="page-loading" aria-live="polite" aria-busy="true">
      <span className="page-loading__mark" aria-hidden="true">
        ♜
      </span>
      <span>Opening Holdfast…</span>
    </main>
  )
}

export default PageLoading
