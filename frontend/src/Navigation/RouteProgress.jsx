import './RouteProgress.css'

// A thin bar under the navbar while the next page's code loads. The current
// page stays on screen meanwhile; quick navigations never show it (delay).
export default function RouteProgress({ active }) {
  return <div className={`route-progress${active ? ' route-progress--active' : ''}`} aria-hidden="true" />
}
