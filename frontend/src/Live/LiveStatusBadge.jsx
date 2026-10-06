import { useLiveUpdates } from './LiveUpdatesProvider.jsx'
import './LiveStatusBadge.css'

const LABELS = {
  live: 'Live',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
}

export default function LiveStatusBadge() {
  const { status } = useLiveUpdates()
  const label = LABELS[status] || 'Offline'

  return (
    <span className={`live-status live-status--${status}`} role="status" aria-label={`Live updates: ${label}`}>
      <span className="live-status__dot" aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}
