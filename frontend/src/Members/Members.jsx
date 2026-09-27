import { useEffect, useMemo, useState } from 'react'
import Home from '../Home/Home.jsx'
import PageShell from '../PageShell/PageShell.jsx'
import { useSession } from '../Auth/SessionProvider.jsx'
import MemberAccessModal from './MemberAccessModal.jsx'
import './Members.css'

const EMPTY_DIRECTORY = {
  members: [],
  summary: {
    memberCount: 0,
    activeAssignmentCount: 0,
  },
}

function memberName(member) {
  return member?.displayName || member?.username || 'Member'
}

function joinedLabel(value) {
  if (!value) return 'Member'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return 'Member'

  return `Joined ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    year: 'numeric',
  }).format(date)}`
}

function MemberAvatar({ member }) {
  if (member.avatarUrl) {
    return (
      <img
        src={member.avatarUrl}
        alt=""
        width="72"
        height="72"
        decoding="async"
      />
    )
  }

  return <span aria-hidden="true">{member.initials || '?'}</span>
}

function MemberCard({ member, isSelf }) {
  const contribution = member.contribution || {}
  const activeAssignments = Number(member.activeAssignmentCount) || 0

  return (
    <a className="members-page__card" href={`/members/${member.id}`}>
      <div className="members-page__avatar">
        <MemberAvatar member={member} />
      </div>

      <div className="members-page__identity">
        <div className="members-page__name-line">
          <h2>{memberName(member)}</h2>
          {isSelf ? <span className="members-page__you">You</span> : null}
          {member.rank ? (
            <span className="members-page__role">{member.rank}</span>
          ) : null}
        </div>
        <p>@{member.username}</p>
        <span>{joinedLabel(member.guildJoinedAt || member.firstSeenAt)}</span>
      </div>

      <div className="members-page__member-meta">
        <div className="members-page__service">
          <span>Rep</span>
          <strong>{Number(contribution.rep) || 0}</strong>
        </div>

        <div
          className={`members-page__assignment ${
            activeAssignments ? 'members-page__assignment--active' : ''
          }`}
        >
          <strong>{activeAssignments}</strong>
          <span>{activeAssignments === 1 ? 'active assignment' : 'active assignments'}</span>
        </div>
      </div>

      <span className="members-page__open" aria-hidden="true">›</span>
    </a>
  )
}

function Members() {
  const session = useSession()
  const [directory, setDirectory] = useState(EMPTY_DIRECTORY)
  const [status, setStatus] = useState('loading')
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(searchInput.trim().toLowerCase())
    }, 180)

    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    if (!session.authenticated) {
      setStatus('ready')
      return undefined
    }

    let active = true

    fetch('/api/guild/members', {
      credentials: 'include',
      cache: 'no-store',
    })
      .then((response) => {
        if (!response.ok) throw new Error('Member directory unavailable')
        return response.json()
      })
      .then((result) => {
        if (!active) return
        setDirectory({
          members: Array.isArray(result?.members) ? result.members : [],
          summary: result?.summary || EMPTY_DIRECTORY.summary,
        })
        setStatus('ready')
      })
      .catch(() => {
        if (!active) return
        setStatus('error')
      })

    return () => {
      active = false
    }
  }, [session.authenticated])

  const visibleMembers = useMemo(() => {
    const members = directory.members.filter((member) => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'active' && member.activeAssignmentCount > 0) ||
        (filter === 'leadership' && member.rankMeta?.isLeadership)

      if (!matchesFilter) return false
      if (!query) return true

      return [
        member.displayName,
        member.username,
        member.rank,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    })

    return members.sort((left, right) => {
      const leftSelf = left.id === session.user?.id
      const rightSelf = right.id === session.user?.id

      if (leftSelf !== rightSelf) {
        return leftSelf ? -1 : 1
      }

      return memberName(left).localeCompare(memberName(right), undefined, {
        sensitivity: 'base',
      })
    })
  }, [directory.members, filter, query, session.user?.id])

  const closeGate = () => window.location.assign('/')

  if (session.status === 'loading' || session.status === 'error') {
    return (
      <Home
        overlay={
          <MemberAccessModal
            returnTo="/members"
            onClose={closeGate}
          />
        }
      />
    )
  }

  if (!session.authenticated) {
    return (
      <Home
        overlay={
          <MemberAccessModal
            returnTo="/members"
            onClose={closeGate}
          />
        }
      />
    )
  }

  return (
    <PageShell
      title="Members"
      intro="Find people, see what they are working on, and open their service record."
      className="members-page"
    >
      {status === 'error' ? (
        <p className="members-page__state members-page__state--error">
          The member directory could not be loaded.
        </p>
      ) : status === 'loading' ? (
        <p className="members-page__state">Opening the member directory…</p>
      ) : (
        <>
          <section className="members-page__tools" aria-label="Member directory tools">
            <div className="members-page__search">
              <label htmlFor="member-search">Find a member</label>
              <div>
                <input
                  id="member-search"
                  type="search"
                  autoComplete="off"
                  value={searchInput}
                  placeholder="Name or Discord username…"
                  onChange={(event) => setSearchInput(event.target.value)}
                />
                {searchInput ? (
                  <button
                    type="button"
                    onClick={() => setSearchInput('')}
                    aria-label="Clear member search"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>

            <div className="members-page__filters" aria-label="Filter members">
              {[
                ['all', 'All'],
                ['active', 'On assignment'],
                ['leadership', 'Leadership'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={filter === value ? 'members-page__filter--active' : ''}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <p className="members-page__result-count" aria-live="polite">
              <span>
                Showing <strong>{visibleMembers.length}</strong>{' '}
                {visibleMembers.length === 1 ? 'member' : 'members'}
              </span>
              <span>
                <strong>{directory.summary.activeAssignmentCount}</strong>{' '}
                active {directory.summary.activeAssignmentCount === 1 ? 'assignment' : 'assignments'}
              </span>
            </p>
          </section>

          {visibleMembers.length ? (
            <section className="members-page__list" aria-label="Holdfast members">
              {visibleMembers.map((member) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  isSelf={member.id === session.user?.id}
                />
              ))}
            </section>
          ) : (
            <section className="members-page__empty">
              <h2>No members found.</h2>
              <p>Try another name or clear the current filter.</p>
              <button
                type="button"
                onClick={() => {
                  setSearchInput('')
                  setFilter('all')
                }}
              >
                Clear filters
              </button>
            </section>
          )}
        </>
      )}
    </PageShell>
  )
}

export default Members
