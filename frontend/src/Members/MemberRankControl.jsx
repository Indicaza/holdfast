import { useState } from 'react'
import { apiJson } from '../Api/apiClient.js'
import { runAuthenticatedMutation } from '../Auth/authenticatedMutation.js'
import { useSession } from '../Auth/sessionContext.js'
import './MemberRankControl.css'

const GUILD_RANKS = [
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

function rankOrder(rank) {
  return GUILD_RANKS.indexOf(rank)
}

function MemberRankControl({ member, onUpdated, compact = false }) {
  const session = useSession()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  if (!session.hasPermission('members.rank.manage')) {
    return null
  }

  if (!session.authority?.isOwner && member.id === session.user?.id) {
    return null
  }

  const ceiling = session.authority?.isOwner
    ? 'Commander'
    : session.authority?.maxManagedRank
  const ceilingOrder = rankOrder(ceiling)
  const currentOrder = rankOrder(member.rank || 'Recruit')

  if (ceilingOrder < 0 || currentOrder > ceilingOrder) {
    return null
  }

  const manageableRanks = GUILD_RANKS.filter(
    (rank) => rankOrder(rank) <= ceilingOrder,
  )

  async function saveRank(rank, { force = false } = {}) {
    if (!rank || busy || (!force && rank === member.rank)) {
      return
    }

    setBusy(true)
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
      if (error?.code === 'owner_rank_locked') {
        setMessage('The guild owner is locked to Commander.')
      } else if (error?.code === 'rank_ceiling_exceeded') {
        setMessage('That rank is above your promotion authority.')
      } else if (error?.code === 'self_authority_change_forbidden') {
        setMessage('You cannot change your own authority.')
      } else {
        setMessage('Rank change failed.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`member-rank-control ${
        compact ? 'member-rank-control--compact' : ''
      }`}
    >
      <label>
        <span>Rank</span>
        <select
          aria-label={`Rank for ${memberName(member)}`}
          value={member.rank || 'Recruit'}
          disabled={busy}
          onChange={(event) => {
            void saveRank(event.target.value)
          }}
        >
          {manageableRanks.map((rank) => (
            <option key={rank} value={rank}>
              {rank}
            </option>
          ))}
        </select>
      </label>

      {!member.rankManaged ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void saveRank(member.rank || 'Recruit', { force: true })
          }}
        >
          Use website rank
        </button>
      ) : (
        <span className="member-rank-control__managed">Website managed</span>
      )}

      {message ? (
        <small className="member-rank-control__message" aria-live="polite">
          {message}
        </small>
      ) : null}
    </div>
  )
}

export default MemberRankControl
