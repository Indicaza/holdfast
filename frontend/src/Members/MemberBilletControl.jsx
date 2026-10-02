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

const RANKS = [
  'Recruit',
  'Private',
  'Corporal',
  'Sergeant',
  'Master Sergeant',
  'Sergeant Major',
  'Lieutenant',
  'Captain',
  'Major',
  'Commander',
]

function rankOrder(rank) {
  return RANKS.indexOf(rank)
}

function canGrantBillet(authority, billet) {
  if (authority?.isOwner) return true

  const permissions = new Set(authority?.permissions || [])

  if ((billet.permissions || []).some((permission) => !permissions.has(permission))) {
    return false
  }

  if (!billet.maxManagedRank) return true
  if (!authority?.maxManagedRank) return false

  return (
    rankOrder(billet.maxManagedRank) <=
    rankOrder(authority.maxManagedRank)
  )
}

function MemberBilletControl({
  member,
  billets,
  onUpdated,
  compact = false,
  triggerLabel = 'Billets',
  showCount = true,
}) {
  const session = useSession()
  const [busyId, setBusyId] = useState(null)
  const [message, setMessage] = useState('')

  if (!session.hasPermission('members.billet.assign')) {
    return null
  }

  if (!session.authority?.isOwner && member.id === session.user?.id) {
    return null
  }

  const ceilingOrder = rankOrder(
    session.authority?.isOwner
      ? 'Commander'
      : session.authority?.maxManagedRank,
  )
  const memberOrder = rankOrder(member.rank || 'Recruit')

  if (ceilingOrder < 0 || memberOrder > ceilingOrder) {
    return null
  }

  const grantableBillets = billets.filter((billet) =>
    canGrantBillet(session.authority, billet),
  )
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
    } catch (error) {
      if (error?.code === 'authority_scope_exceeded') {
        setMessage('That billet is outside your authority.')
      } else if (error?.code === 'self_authority_change_forbidden') {
        setMessage('You cannot change your own authority.')
      } else {
        setMessage('Billet assignment failed.')
      }
    } finally {
      setBusyId(null)
    }
  }

  async function claimAuthority() {
    if (busyId) return

    setBusyId('claim')
    setMessage('')

    try {
      const result = await runAuthenticatedMutation({
        request: () =>
          apiJson(
            '/api/guild/members/manage/' +
              encodeURIComponent(member.id) +
              '/billets/claim',
            {
              method: 'POST',
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
        setMessage('Website authority enabled. Discord repair is queued.')
      } else {
        setMessage('Website now owns this member\'s billet assignments.')
      }
    } catch {
      setMessage('Could not enable website billet authority.')
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
        <strong>{triggerLabel}</strong>
        {showCount ? <span>{current.size}</span> : null}
      </summary>

      <div className="member-billet-control__menu">
        {!member.billetsManaged ? (
          <div className="member-billet-control__authority">
            <p>
              Existing member: confirm the website as the source of truth for
              billet assignments before drift repair begins.
            </p>
            <button
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => {
                void claimAuthority()
              }}
            >
              Use website billets
            </button>
          </div>
        ) : (
          <span className="member-billet-control__managed">
            Website managed
          </span>
        )}

        {grantableBillets.length ? (
          grantableBillets.map((billet) => (
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
          <p>No billets are within your assignment authority.</p>
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
