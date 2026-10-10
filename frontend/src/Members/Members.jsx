import { useEffect, useMemo, useRef, useState } from 'react'
import { apiJson } from '../Api/apiClient.js'
import Home from '../Home/Home.jsx'
import PageShell from '../PageShell/PageShell.jsx'
import { useSession } from '../Auth/sessionContext.js'
import { useLiveRefresh } from '../Live/liveUpdatesContext.js'
import MemberAccessModal from './MemberAccessModal.jsx'
import { navigate } from '../Navigation/navigation.js'
import PageLoading from '../PageLoading/PageLoading.jsx'
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

function MemberCard({ member }) {
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
          {member.rank ? (
            <span className="members-page__role">{member.rank}</span>
          ) : null}
        </div>
        <p>@{member.username}</p>
        {member.billets?.length ? (
          <div className="billet-badges members-page__billets">
            {member.billets.map((billet) => (
              <span key={billet.id}>{billet.name}</span>
            ))}
          </div>
        ) : null}
        {member.mainCharacter ? (
          <span className="members-page__character">
            {member.mainCharacter.name}
            {member.mainCharacter.className
              ? ` · ${member.mainCharacter.className}`
              : ''}
          </span>
        ) : (
          <span>{joinedLabel(member.guildJoinedAt || member.firstSeenAt)}</span>
        )}
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
  const [sort, setSort] = useState('name')
  const searchRef = useRef(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(searchInput.trim().toLowerCase())
    }, 180)

    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      const tagName = document.activeElement?.tagName?.toLowerCase()

      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
        return
      }

      event.preventDefault()
      searchRef.current?.focus()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])


  // Live member, rank and authority changes refresh the directory in place.
  const [revision, setRevision] = useState(0)
  useLiveRefresh(['members', 'ranks', 'authority'], () => setRevision((current) => current + 1), {
    enabled: session.authenticated,
  })

  useEffect(() => {
    if (!session.authenticated) {
      setStatus('ready')
      return undefined
    }

    const controller = new AbortController()
    let active = true

    async function loadDirectory() {
      if (revision === 0) setStatus('loading')

      try {
        const result = await apiJson('/api/guild/members', {
          signal: controller.signal,
        })

        if (!active) return

        setDirectory({
          members: Array.isArray(result?.members) ? result.members : [],
          summary: result?.summary || EMPTY_DIRECTORY.summary,
        })
        setStatus('ready')
      } catch (error) {
        if (!active || error?.name === 'AbortError') return
        // A failed background refresh keeps the directory on screen.
        if (revision === 0) setStatus('error')
      }
    }

    void loadDirectory()

    return () => {
      active = false
      controller.abort()
    }
  }, [revision, session.authenticated])

  const visibleMembers = useMemo(() => {
    const members = directory.members.filter((member) => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'active' && member.activeAssignmentCount > 0) ||
        (filter === 'leadership' && member.rankMeta?.isLeadership)

      if (!matchesFilter) return false
      if (!query) return true

      const profile = member.profile || {}
      const characters = Array.isArray(profile.characters)
        ? profile.characters
        : []
      const characterSearch = characters.flatMap((character) => [
        character.name,
        character.race,
        character.className,
        character.spec,
        ...(character.professions || []),
      ])

      return [
        member.displayName,
        member.username,
        member.rank,
        ...(member.billets || []).flatMap((billet) => [
          billet.name,
          billet.responsibility,
        ]),
        profile.battleTag,
        profile.timezone,
        profile.availability,
        ...characterSearch,
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

      if (sort === 'rank') {
        const rankDelta =
          Number(right.rankMeta?.order || 0) - Number(left.rankMeta?.order || 0)

        if (rankDelta) return rankDelta
      }

      if (sort === 'rep') {
        const repDelta =
          Number(right.contribution?.rep || 0) -
          Number(left.contribution?.rep || 0)

        if (repDelta) return repDelta
      }

      return memberName(left).localeCompare(memberName(right), undefined, {
        sensitivity: 'base',
      })
    })
  }, [directory.members, filter, query, session.user?.id, sort])

  const closeGate = () => navigate('/')

  if (session.status === 'loading') return <PageLoading label="Checking your membership…" />

  if (session.status === 'error') {
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
                  ref={searchRef}
                  type="search"
                  autoComplete="off"
                  value={searchInput}
                  placeholder="Member, character, class, profession, BattleTag…"
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

            <label className="members-page__sort">
              <span>Sort</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="name">Name</option>
                <option value="rank">Rank</option>
                <option value="rep">Rep</option>
              </select>
            </label>

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
                <MemberCard key={member.id} member={member} />
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
