import { useLiveResource } from '../Live/useLiveResource.js'
import './Admin.css'

const EVENT_LABELS = {
  'quest.workspace_saved': 'saved the quest workspace',
  'quest.objective_completed': 'completed an objective',
  'quest.objective_joined': 'joined an objective',
  'quest.objective_left': 'left an objective',
}

function eventDetail(event) {
  if (event.eventType === 'quest.objective_completed') {
    const awards = Array.isArray(event.payload?.awards)
      ? event.payload.awards.length
      : 0
    return `${awards} reward${awards === 1 ? '' : 's'} issued`
  }

  const before = event.payload?.revisionBefore
  const after = event.payload?.revisionAfter

  if (Number.isInteger(before) && Number.isInteger(after)) {
    return `Revision ${before} → ${after}`
  }

  return null
}

function formattedDate(value) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Unknown time'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function AuditLog() {
  // Cached across page changes; new activity refreshes the log in place.
  const log = useLiveResource('/api/admin/audit?limit=20', { topics: ['audit'] })
  const events = Array.isArray(log.data?.events) ? log.data.events : []
  const status = log.status === 'missing' ? 'error' : log.status

  return (
    <section className="admin-audit">
      <div className="admin-audit__heading">
        <div>
          <p>Safety log</p>
          <h2>Recent activity</h2>
        </div>
        <span>Owner only</span>
      </div>

      {status === 'loading' ? (
        <p className="admin-audit__state">Loading activity…</p>
      ) : status === 'error' ? (
        <p className="admin-audit__state admin-audit__state--error">
          Activity history could not be loaded.
        </p>
      ) : events.length ? (
        <ol className="admin-audit__events">
          {events.map((event) => {
            const detail = eventDetail(event)

            return (
              <li key={event.id}>
                <span className="admin-audit__marker" aria-hidden="true" />
                <div>
                  <p>
                    <strong>{event.actorName}</strong>{' '}
                    {EVENT_LABELS[event.eventType] || event.eventType}
                  </p>
                  <span>
                    {formattedDate(event.createdAt)}
                    {detail ? ` · ${detail}` : ''}
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="admin-audit__state">No recorded changes yet.</p>
      )}
    </section>
  )
}

export default AuditLog
