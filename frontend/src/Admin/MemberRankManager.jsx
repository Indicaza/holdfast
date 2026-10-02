import { useEffect, useMemo, useState } from 'react'
import { apiJson } from '../Api/apiClient.js'
import { runAuthenticatedMutation } from '../Auth/authenticatedMutation.js'
import { useSession } from '../Auth/sessionContext.js'

const FALLBACK_RANKS = [
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

function memberName(member) {
  return member?.displayName || member?.username || 'Member'
}

function MemberRankManager() {
  const session = useSession()
  const [members, setMembers] = useState([])
  const [ranks, setRanks] = useState(FALLBACK_RANKS)
  const [status, setStatus] = useState('loading')
  const [busyMemberId, setBusyMemberId] = useState(null)
  const [reconciling, setReconciling] = useState(false)
  const [message, setMessage] = useState('')

  async function loadMembers() {
    setStatus('loading')

    try {
      const result = await apiJson('/api/guild/members/manage/all')
      setMembers(Array.isArray(result?.members) ? result.members : [])
      setRanks(
        Array.isArray(result?.ranks) && result.ranks.length
          ? result.ranks
          : FALLBACK_RANKS,
      )
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => {
    void loadMembers()
  }, [])

  const orderedMembers = useMemo(
    () =>
      [...members].sort((left, right) =>
        memberName(left).localeCompare(memberName(right), undefined, {
          sensitivity: 'base',
        }),
      ),
    [members],
  )

  async function changeRank(member, rank) {
    if (!rank || rank === member.rank || busyMemberId) return

    setBusyMemberId(member.id)
    setMessage('')

    try {
      const result = await runAuthenticatedMutation({
        request: () =>
          apiJson(
            `/api/guild/members/manage/${encodeURIComponent(member.id)}/rank`,
            {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ rank }),
            },
          ),
        refresh: session.refresh,
        reauthenticate: () => session.signIn('/admin'),
      })

      if (!result) return

      setMembers((current) =>
        current.map((item) =>
          item.id === member.id ? { ...item, rank: result.member.rank } : item,
        ),
      )

      if (result.discordSync?.status === 'pending') {
        setMessage(
          `${memberName(member)} is now ${result.member.rank} on the website. Discord sync is pending and will retry automatically.`,
        )
      } else if (result.discordSync?.status === 'missing') {
        setMessage(
          `${memberName(member)} is now ${result.member.rank}. They are not currently in the Discord server.`,
        )
      } else {
        setMessage(
          `${memberName(member)} is now ${result.member.rank}. Discord is in sync.`,
        )
      }
    } catch (error) {
      if (error?.code === 'owner_rank_locked') {
        setMessage('The configured guild owner is locked to Commander.')
      } else {
        setMessage('Rank change failed. Nothing else was changed in this screen.')
      }
    } finally {
      setBusyMemberId(null)
    }
  }

  async function reconcileRanks() {
    if (reconciling) return

    setReconciling(true)
    setMessage('')

    try {
      const result = await runAuthenticatedMutation({
        request: () =>
          apiJson('/api/guild/members/manage/reconcile-ranks', {
            method: 'POST',
          }),
        refresh: session.refresh,
        reauthenticate: () => session.signIn('/admin'),
      })

      if (!result) return

      const summary = result.summary || {}
      setMessage(
        `Discord rank check complete: ${Number(summary.changed) || 0} repaired, ${Number(summary.unchanged) || 0} already correct, ${Number(summary.missing) || 0} not in Discord, ${Number(summary.failed) || 0} failed.`,
      )
    } catch {
      setMessage('Discord rank reconciliation could not be completed.')
    } finally {
      setReconciling(false)
    }
  }

  return (
    <section className="admin-ranks">
      <div className="admin-ranks__heading">
        <div>
          <span>Membership</span>
          <h2>Member ranks</h2>
          <p>
            The website is authoritative. Rank changes here are pushed to Discord,
            and Discord drift is repaired automatically.
          </p>
        </div>

        <button
          type="button"
          onClick={reconcileRanks}
          disabled={reconciling || status !== 'ready'}
        >
          {reconciling ? 'Checking…' : 'Reconcile Discord'}
        </button>
      </div>

      {message ? (
        <p className="admin-ranks__message" aria-live="polite">
          {message}
        </p>
      ) : null}

      {status === 'loading' ? (
        <p className="admin-ranks__state">Loading members…</p>
      ) : status === 'error' ? (
        <div className="admin-ranks__state admin-ranks__state--error">
          <p>The member directory could not be loaded.</p>
          <button type="button" onClick={loadMembers}>Retry</button>
        </div>
      ) : (
        <div className="admin-ranks__list">
          {orderedMembers.map((member) => (
            <div className="admin-ranks__member" key={member.id}>
              <div>
                <strong>{memberName(member)}</strong>
                <span>@{member.username}</span>
              </div>

              <label>
                <span className="sr-only">
                  Rank for {memberName(member)}
                </span>
                <select
                  value={member.rank || 'Recruit'}
                  disabled={busyMemberId === member.id}
                  onChange={(event) => {
                    void changeRank(member, event.target.value)
                  }}
                >
                  {ranks.map((rank) => (
                    <option key={rank} value={rank}>
                      {rank}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default MemberRankManager
