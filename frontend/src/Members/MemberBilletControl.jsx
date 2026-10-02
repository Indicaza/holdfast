import { useState } from 'react'
import { apiJson } from '../Api/apiClient.js'
import { runAuthenticatedMutation } from '../Auth/authenticatedMutation.js'
import { useSession } from '../Auth/sessionContext.js'
import './BilletControls.css'

function assignedIds(member) {
  return new Set(
    (Array.isArray(member?.billets) ? member.billets : []).map(
      (billet) => billet.id,
    ),
  )
}

function MemberBilletControl({ member, billets, onUpdated, compact = false }) {
  const session = useSession()
  const [busyId, setBusyId] = useState(null)
  const [message, setMessage] = useState('')

  if (!session.hasPermission('site.admin')) {
    return null
  }

  const current = assignedIds(member)

  async function setAssignment(billet, assigned) {
    if (busyId) return

    setBusyId(billet.id)
    setMessage('')

    try {
      const result = await runAuthenticatedMutation({
        request: () =>
          apiJson(
            '/api/guild/members/manage/' +
              encodeURIComponent(member.id) +
              '/billets/' +
              encodeURIComponent(billet.id),
            {
              method: assigned ? 'PUT' : 'DELETE',
            },
          ),
        refresh: session.refresh,
        reauthenticate: () =>
          session.signIn(
            window.location.pathname + window.location.search + window.location.hash,
          ),
      })

      if (!result) return

      onUpdated?.(result.member)

      if (result.discordSync?.status === 'pending') {
        setMessage('Saved. Discord repair is queued.')
      } else if (result.discordSync?.status === 'missing') {
        setMessage('Saved. Member is not currently in Discord.')
      } else {
        setMessage('Saved and synced to Discord.')
      }
    } catch {
      setMessage('Billet assignment failed.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <details
      className={
        compact
          ? 'member-billet-control member-billet-control--compact'
          : 'member-billet-control'
      }
    >
      <summary>
        Billets
        <span>{current.size}</span>
      </summary>

      <div className="member-billet-control__menu">
        {billets.length ? (
          billets.map((billet) => (
            <label key={billet.id}>
              <input
                type="checkbox"
                checked={current.has(billet.id)}
                disabled={Boolean(busyId)}
                onChange={(event) => {
                  void setAssignment(billet, event.target.checked)
                }}
              />
              <span>
                <strong>{billet.name}</strong>
                {billet.responsibility ? (
                  <small>{billet.responsibility}</small>
                ) : null}
              </span>
            </label>
          ))
        ) : (
          <p>No billets have been created yet.</p>
        )}

        {message ? (
          <small
            className="member-billet-control__message"
            aria-live="polite"
          >
            {message}
          </small>
        ) : null}
      </div>
    </details>
  )
}

export default MemberBilletControl
