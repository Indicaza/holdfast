import { useEffect, useMemo, useRef, useState } from 'react'
import Home from '../Home/Home.jsx'
import PageShell from '../PageShell/PageShell.jsx'
import { useSession } from '../Auth/sessionContext.js'
import { useLiveResource } from '../Live/useLiveResource.js'
import CharacterLine from '../Intelligence/CharacterLine.jsx'
import CharacterProfileModal from '../Intelligence/CharacterProfileModal.jsx'
import { normalizeIntelligence } from '../Intelligence/model.js'
import { useCharacterParam } from '../Intelligence/useCharacterParam.js'
import MemberAccessModal from './MemberAccessModal.jsx'
import RankPlate from './RankPlate.jsx'
import { classIdentity } from '../Intelligence/classIdentity.js'
import WowIcon from '../WowAssets/WowIcon.jsx'
import RepBar from './RepBar.jsx'
import { syncedCharacterIndex } from './syncedCharacters.js'
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

function normalizeDirectory(result) {
  return {
    members: Array.isArray(result?.members) ? result.members : [],
    summary: result?.summary || EMPTY_DIRECTORY.summary,
  }
}

function memberName(member) {
  return member?.displayName || member?.username || 'Member'
}

// The Discord picture, else the main character's class portrait.
function MemberAvatar({ member, mainCharacter = null }) {
  const classIcon = classIdentity(mainCharacter?.className).iconFileId
  if (!member.avatarUrl && classIcon) {
    return <WowIcon iconFileId={classIcon} label={mainCharacter.className} size={64} />
  }

  if (member.avatarUrl) {
    return (
      <img
        src={member.avatarUrl}
        alt=""
        width="64"
        height="64"
        decoding="async"
      />
    )
  }

  return <span aria-hidden="true">{member.initials || '?'}</span>
}

function memberTier(member) {
  if (member.rankMeta?.isOfficer) return 'officer'
  if (member.rankMeta?.isLeadership) return 'nco'
  return 'enlisted'
}

const RANK_GROUPS = [
  { id: 'officer', title: 'Officers', detail: 'Appointed leadership' },
  { id: 'nco', title: 'Non-commissioned officers', detail: 'Sergeants who lead the work' },
  { id: 'enlisted', title: 'Enlisted', detail: 'Recruits, Privates and Corporals' },
]

// The member's characters, main first: synced ones as unit frames (they open
// the armory), listed-only ones by name.
function memberCharacters(member, synced) {
  const listed = Array.isArray(member.profile?.characters) ? member.profile.characters : []
  const ordered = [...listed].sort((left, right) => Number(Boolean(right.isMain)) - Number(Boolean(left.isMain)))
  const seen = new Set()
  return ordered
    .map((character) => ({ listed: character, synced: synced.find(character) }))
    .filter((pair) => !pair.synced || (!seen.has(pair.synced.id) && seen.add(pair.synced.id)))
}

function MemberCard({ member, isSelf, synced, charactersReady, onOpenCharacter }) {
  const activeAssignments = Number(member.activeAssignmentCount) || 0
  const characters = memberCharacters(member, synced)
  const [lead, ...rest] = characters

  return (
    <article className={`member-card member-card--${memberTier(member)}${isSelf ? ' member-card--self' : ''}`}>
      <header className="member-card__head">
        <span className="member-card__avatar">
          <MemberAvatar member={member} mainCharacter={lead?.synced} />
        </span>
        <div className="member-card__who">
          <h2>
            <a className="member-card__link" href={`/members/${member.id}`}>
              {memberName(member)}
            </a>
            {isSelf ? <span className="member-card__you">You</span> : null}
            {activeAssignments ? (
              <span
                className="member-card__duty"
                role="img"
                aria-label={`On assignment: ${activeAssignments} active ${activeAssignments === 1 ? 'objective' : 'objectives'}`}
                title={`${activeAssignments} active ${activeAssignments === 1 ? 'objective' : 'objectives'}`}
              />
            ) : null}
          </h2>
          <RankPlate member={member} size="xs" variant="plain" />
        </div>
      </header>

      <div className="member-card__characters">
        {lead?.synced ? (
          <CharacterLine character={lead.synced} onOpen={onOpenCharacter} portrait={false} />
        ) : lead && !charactersReady ? (
          <span className="member-card__pending" aria-hidden="true" />
        ) : lead ? (
          <span className="member-card__listed">
            {lead.listed.name}
            <small>{[lead.listed.race, lead.listed.className].filter(Boolean).join(' ') || 'Not synced yet'}</small>
          </span>
        ) : (
          <span className="member-card__listed member-card__listed--empty">No characters yet</span>
        )}
        {rest.length ? <span className="member-card__more" title={`${rest.length} more ${rest.length === 1 ? 'character' : 'characters'}`}>+{rest.length}</span> : null}
      </div>

      <RepBar member={member} variant="hairline" className="member-card__rep" />
    </article>
  )
}

function DirectorySummary({ members, syncedCount }) {
  const officers = members.filter((member) => member.rankMeta?.isOfficer).length
  const ncos = members.filter((member) => !member.rankMeta?.isOfficer && member.rankMeta?.isLeadership).length
  const onAssignment = members.filter((member) => Number(member.activeAssignmentCount) > 0).length
  const stats = [
    ['Members', members.length],
    ['Officers', officers],
    ['NCOs', ncos],
    ['On assignment', onAssignment],
    ['Characters synced', syncedCount],
  ]

  return (
    <dl className="members-page__summary" aria-label="Guild at a glance">
      {stats.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Members() {
  const session = useSession()
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


  // Cached across page changes; live member, rank and authority changes
  // refresh it in place.
  const { status: directoryStatus, data } = useLiveResource('/api/guild/members', {
    topics: ['members', 'ranks', 'authority'],
    select: normalizeDirectory,
    enabled: session.authenticated,
  })
  const directory = data || EMPTY_DIRECTORY
  const status = directoryStatus === 'idle' ? 'ready' : directoryStatus === 'missing' ? 'error' : directoryStatus

  // Synced characters, shared with GuildOS (and cached with it).
  const { data: intelligence, status: intelligenceStatus } = useLiveResource('/api/intelligence', {
    topics: ['intelligence', 'members'],
    select: normalizeIntelligence,
    enabled: session.authenticated,
  })
  const synced = useMemo(() => syncedCharacterIndex(intelligence?.characters), [intelligence])
  const charactersReady = intelligenceStatus !== 'loading'
  const [selectedCharacterId, openCharacter] = useCharacterParam()

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
      {status === 'ready' ? <DirectorySummary members={directory.members} syncedCount={synced.size} /> : null}

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
                Showing <strong>{visibleMembers.length}</strong> of{' '}
                <strong>{directory.members.length}</strong>{' '}
                {directory.members.length === 1 ? 'member' : 'members'}
              </span>
              <span className="members-page__search-hint">Press <kbd>/</kbd> to search</span>
            </p>

          </section>

          {visibleMembers.length ? (
            sort === 'rank' ? (
              RANK_GROUPS.map((group) => {
                const members = visibleMembers.filter((member) => memberTier(member) === group.id)
                if (!members.length) return null
                return (
                  <section className="members-page__group" key={group.id} aria-labelledby={`members-group-${group.id}`}>
                    <header className="members-page__group-heading">
                      <h2 id={`members-group-${group.id}`}>{group.title}</h2>
                      <span>{group.detail}</span>
                      <strong>{members.length}</strong>
                    </header>
                    <div className="members-page__list">
                      {members.map((member) => (
                        <MemberCard key={member.id} member={member} isSelf={member.id === session.user?.id} synced={synced} charactersReady={charactersReady} onOpenCharacter={openCharacter} />
                      ))}
                    </div>
                  </section>
                )
              })
            ) : (
              <section className="members-page__list" aria-label="Holdfast members">
                {visibleMembers.map((member) => (
                  <MemberCard key={member.id} member={member} isSelf={member.id === session.user?.id} synced={synced} charactersReady={charactersReady} onOpenCharacter={openCharacter} />
                ))}
              </section>
            )
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

      <CharacterProfileModal characterId={selectedCharacterId} onClose={() => openCharacter('')} />
    </PageShell>
  )
}

export default Members
