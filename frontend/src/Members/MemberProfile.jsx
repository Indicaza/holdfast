import { useMemo, useState } from 'react'
import { useLiveResource } from '../Live/useLiveResource.js'
import Home from '../Home/Home.jsx'
import PageShell from '../PageShell/PageShell.jsx'
import { useSession } from '../Auth/sessionContext.js'
import MemberAccessModal from './MemberAccessModal.jsx'
import MemberProfileEditor from './MemberProfileEditor.jsx'
import MemberBilletControl from './MemberBilletControl.jsx'
import MemberRankControl from './MemberRankControl.jsx'
import RankPlate from './RankPlate.jsx'
import RepBar from './RepBar.jsx'
import CharacterCard from '../Intelligence/CharacterCard.jsx'
import CharacterProfileModal from '../Intelligence/CharacterProfileModal.jsx'
import { normalizeIntelligence } from '../Intelligence/model.js'
import { useCharacterParam } from '../Intelligence/useCharacterParam.js'
import { raceScene, statsArt } from '../Intelligence/characterArt.js'
import { classIdentity } from '../Intelligence/classIdentity.js'
import { syncedCharacterIndex } from './syncedCharacters.js'
import WowIcon from '../WowAssets/WowIcon.jsx'
import { navigate } from '../Navigation/navigation.js'
import PageLoading from '../PageLoading/PageLoading.jsx'
import './MemberProfile.css'

const SERVICE_PREVIEW = 6

function displayName(member) {
  return member?.displayName || member?.username || 'Member'
}

function formatDate(value, includeDay = true) {
  if (!value) return 'Unknown'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return 'Unknown'

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: includeDay ? 'numeric' : undefined,
    year: 'numeric',
  }).format(date)
}

function tenureText(member) {
  if (member.guildJoinedAt) {
    return `In Holdfast since ${formatDate(member.guildJoinedAt, false)}`
  }

  return `Profile active since ${formatDate(member.firstSeenAt, false)}`
}

function formatNumber(value) {
  return (Number(value) || 0).toLocaleString()
}

function MemberAvatar({ member, mainCharacter = null }) {
  const classIcon = classIdentity(mainCharacter?.className).iconFileId
  if (!member.avatarUrl && classIcon) {
    return <WowIcon iconFileId={classIcon} label={mainCharacter.className} size={128} className="member-profile__avatar-icon" />
  }

  if (member.avatarUrl) {
    return (
      <img
        src={member.avatarUrl}
        alt=""
        width="144"
        height="144"
        decoding="async"
      />
    )
  }

  return <span aria-hidden="true">{member.initials || '?'}</span>
}

function Reward({ reward }) {
  const items = reward?.items || []
  const hasReward = reward?.rep > 0 || reward?.marks > 0 || items.length > 0

  if (!hasReward) {
    return null
  }

  return (
    <div className="member-profile__rewards">
      {reward.rep > 0 ? <span>+{formatNumber(reward.rep)} Rep</span> : null}
      {reward.marks > 0 ? <span>+{formatNumber(reward.marks)} Marks</span> : null}
      {items.map((item) => (
        <span key={item.id || item.name}>
          {item.quantity > 1 ? `${item.quantity}× ` : ''}
          {item.name}
        </span>
      ))}
    </div>
  )
}

function ProfileLoading() {
  return (
    <PageShell className="member-profile member-profile--loaded">
      <div className="member-profile__skeleton" aria-label="Loading member profile">
        <div className="member-profile__skeleton-avatar" />
        <div className="member-profile__skeleton-copy">
          <span />
          <strong />
          <span />
        </div>
      </div>
    </PageShell>
  )
}

function ProfileMessage({ title, body }) {
  return (
    <PageShell className="member-profile member-profile--loaded">
      <nav className="member-profile__crumbs" aria-label="Member profile navigation">
        <a href="/members">Members</a>
        <span aria-hidden="true">/</span>
        <span>Profile</span>
      </nav>

      <section className="member-profile__message">
        <p>Holdfast</p>
        <h1>{title}</h1>
        <span>{body}</span>
        <a href="/members">Back to Members</a>
      </section>

    </PageShell>
  )
}

const STAT_ICONS = {
  marks: <><circle cx="12" cy="12" r="8" /><path d="M12 7v10M9 9.5h4.5a2 2 0 0 1 0 4H10a2 2 0 0 0 0 4h5" /></>,
  objectives: <><path d="M5 12.5l4.5 4.5L19 7.5" /></>,
  assignments: <><path d="M6 21V4M6 4h11l-2.5 4L17 12H6" /></>,
  active: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4.5l3 1.8" /></>,
}

function StatIcon({ name }) {
  return (
    <svg className="member-profile__stat-icon" viewBox="0 0 24 24" aria-hidden="true">
      {STAT_ICONS[name]}
    </svg>
  )
}

function characterDescriptor(character) {
  return [character?.race, character?.spec || character?.className]
    .filter(Boolean)
    .join(' ')
}

// A character listed on the profile that Guildweaver has not synced yet.
function ListedCharacter({ character }) {
  return (
    <article className={`member-profile__listed${character.isMain ? ' member-profile__listed--main' : ''}`}>
      <div>
        {character.isMain ? <span className="member-profile__listed-main">Main</span> : null}
        <h3>{character.name}</h3>
        {characterDescriptor(character) ? <p>{characterDescriptor(character)}</p> : null}
      </div>
      {character.professions?.length ? (
        <div className="member-profile__professions">
          {character.professions.map((profession) => (
            <span key={profession}>{profession}</span>
          ))}
        </div>
      ) : null}
      <small>Not synced yet</small>
    </article>
  )
}

function Characters({ member, synced: syncedIndex, charactersReady, editable, onEdit, onOpenCharacter }) {
  const profile = member.profile || {}
  const listed = Array.isArray(profile.characters) ? profile.characters : []
  const ordered = [...listed].sort((left, right) => Number(Boolean(right.isMain)) - Number(Boolean(left.isMain)))
  // Two listings can name one synced character (listed before and after its
  // first sync); it shows once.
  const seen = new Set()
  const pairs = ordered
    .map((character) => ({ listed: character, synced: syncedIndex.find(character) }))
    .filter((pair) => {
      if (!pair.synced) return true
      if (seen.has(pair.synced.id)) return false
      seen.add(pair.synced.id)
      return true
    })
  const synced = pairs.filter((pair) => pair.synced).map((pair) => pair.synced)
  const listedById = new Map(pairs.filter((pair) => pair.synced).map((pair) => [pair.synced.id, pair.listed]))
  const unsynced = charactersReady ? pairs.filter((pair) => !pair.synced).map((pair) => pair.listed) : []
  const hasAbout = profile.timezone || profile.availability || profile.bio

  return (
    <section className="member-profile__section member-profile__player" aria-labelledby="member-player-title">
      <div className="member-profile__section-heading">
        <div>
          <p>In Azeroth</p>
          <h2 id="member-player-title">Characters</h2>
        </div>
        <div className="member-profile__section-meta">
          <span>
            {pairs.length
              ? `${pairs.length} ${pairs.length === 1 ? 'character' : 'characters'}${synced.length ? ` · ${synced.length} synced` : ''}`
              : 'No characters listed'}
          </span>
          {editable ? (
            <button className="member-profile__edit" type="button" onClick={onEdit}>
              Edit profile
            </button>
          ) : null}
        </div>
      </div>

      <div className={`member-profile__player-body${hasAbout ? '' : ' member-profile__player-body--characters-only'}`}>
        <div className="member-profile__characters">
          {!charactersReady && listed.length ? (
            <div className="member-profile__characters-pending" aria-label="Loading characters" />
          ) : null}
          {synced.length ? (
            <div className="member-profile__character-grid">
              {synced.map((character) => {
                const professions = listedById.get(character.id)?.professions || []
                return (
                  <article className="member-profile__character-tile" key={character.id} style={{ '--class-color': classIdentity(character.className).color }}>
                    <CharacterCard character={character} onOpen={onOpenCharacter} showAffiliation={false} />
                    <div className="member-profile__character-meta">
                      <span className="member-profile__character-class">{characterDescriptor(character) || 'Adventurer'}</span>
                      {character.realm ? <span>{character.realm}</span> : null}
                    </div>
                    {professions.length ? (
                      <div className="member-profile__professions">
                        {professions.map((profession) => <span key={profession}>{profession}</span>)}
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
          ) : null}
          {unsynced.length ? (
            <div className="member-profile__listed-grid">
              {unsynced.map((character) => (
                <ListedCharacter key={character.id || character.name} character={character} />
              ))}
            </div>
          ) : null}
          {!listed.length ? (
            editable ? (
              <button className="member-profile__identity-empty" type="button" onClick={onEdit}>
                <strong>Add your characters</strong>
                <span>List your main and alts so guildmates know who to look for in game. Guildweaver fills in gear, talents and professions once it syncs.</span>
              </button>
            ) : (
              <div className="member-profile__empty">
                <strong>No characters listed yet.</strong>
                <span>Characters appear here once they are added to the profile or synced by Guildweaver.</span>
              </div>
            )
          ) : null}
        </div>

        {hasAbout ? (
          <aside className="member-profile__contact">
            {profile.bio ? (
              <div className="member-profile__bio">
                <span>About</span>
                <p>{profile.bio}</p>
              </div>
            ) : null}
            <dl>
              {profile.timezone ? (
                <div>
                  <dt>Timezone</dt>
                  <dd>{profile.timezone}</dd>
                </div>
              ) : null}
              {profile.availability ? (
                <div>
                  <dt>Usually around</dt>
                  <dd>{profile.availability}</dd>
                </div>
              ) : null}
            </dl>
          </aside>
        ) : null}
      </div>
    </section>
  )
}

function MemberProfile({ memberId }) {
  const session = useSession()
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [showAllService, setShowAllService] = useState(false)

  const isSelfRoute = memberId === 'me'
  const endpoint = isSelfRoute
    ? '/api/guild/members/me'
    : `/api/guild/members/${encodeURIComponent(memberId)}`

  // Cached across page changes; live member, rank and authority changes
  // refresh the profile in place (an open editor keeps its own draft), and
  // this page's own edits apply at once.
  const liveOptions = { topics: ['members', 'ranks', 'authority'], enabled: session.authenticated }
  const profile = useLiveResource(endpoint, liveOptions)
  const billetCatalog = useLiveResource('/api/guild/billets', liveOptions)
  const member = profile.data?.member || null
  const billets = Array.isArray(billetCatalog.data?.billets) ? billetCatalog.data.billets : []
  const setMember = (updatedMember) => profile.mutate((current) => ({ ...current, member: updatedMember }))
  const status = !session.authenticated || profile.status === 'idle'
    ? 'ready'
    : profile.status === 'missing' || (profile.status === 'ready' && !member)
      ? 'not-found'
      : profile.status === 'ready' && billetCatalog.status === 'loading'
        ? 'loading'
        : profile.status

  // Synced characters, shared with GuildOS and the directory (and cached).
  const intelligence = useLiveResource('/api/intelligence', {
    topics: ['intelligence', 'members'],
    select: normalizeIntelligence,
    enabled: session.authenticated,
  })
  const synced = useMemo(() => syncedCharacterIndex(intelligence.data?.characters), [intelligence.data])
  const charactersReady = intelligence.status !== 'loading'
  // The member's main as Guildweaver knows it: the hero's art and featured card.
  const mainCharacter = useMemo(() => {
    const listed = Array.isArray(profile.data?.member?.profile?.characters) ? profile.data.member.profile.characters : []
    const main = listed.find((character) => character.isMain) || listed[0]
    return synced.find(main) || listed.map((character) => synced.find(character)).find(Boolean) || null
  }, [profile.data, synced])
  const [selectedCharacterId, openCharacter] = useCharacterParam()

  const profileUrl = useMemo(() => {
    if (!member?.id) return ''

    return new URL(`/members/${member.id}`, window.location.origin).toString()
  }, [member?.id])

  async function copyProfile() {
    if (!profileUrl) return

    try {
      await navigator.clipboard.writeText(profileUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      return
    }
  }

  const returnTo = isSelfRoute ? '/members/me' : `/members/${memberId}`
  const closeGate = () => navigate('/')

  if (session.status === 'loading') return <PageLoading label="Checking your membership…" />

  if (session.status === 'error') {
    return (
      <Home
        overlay={
          <MemberAccessModal
            returnTo={returnTo}
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
            returnTo={returnTo}
            onClose={closeGate}
          />
        }
      />
    )
  }

  if (status === 'loading') {
    return <ProfileLoading />
  }

  if (status === 'error') {
    return (
      <ProfileMessage
        title="Profile unavailable"
        body="Holdfast could not load this member right now."
      />
    )
  }

  if (status === 'not-found' || !member) {
    return (
      <ProfileMessage
        title="Member not found"
        body="That profile is not in the Holdfast member directory."
      />
    )
  }

  const contribution = member.contribution || {}
  const assignments = member.assignments || []
  const activity = member.activity || []
  const isSelf = member.id === session.user?.id
  const canManageRank = session.hasPermission('members.rank.manage')
  const canManageBillets = session.hasPermission('members.billet.assign')
  const tier = member.rankMeta?.isOfficer ? 'officer' : member.rankMeta?.isLeadership ? 'nco' : 'enlisted'
  const heroArt = mainCharacter
    ? {
        '--hero-scene': raceScene(mainCharacter.race) ? `url("${raceScene(mainCharacter.race)}")` : 'none',
        '--hero-crest': statsArt(mainCharacter.className),
        '--class-color': classIdentity(mainCharacter.className).color,
      }
    : undefined

  return (
    <PageShell className="member-profile member-profile--loaded">
      <nav className="member-profile__crumbs" aria-label="Member profile navigation">
        <a href="/members">Members</a>
        <span aria-hidden="true">/</span>
        <span>{displayName(member)}</span>
      </nav>

      <section
        className={`member-profile__hero member-profile__hero--${tier}${mainCharacter ? ' member-profile__hero--featured' : ''}`}
        style={heroArt}
        aria-labelledby="member-profile-name"
      >
        <div className="member-profile__hero-art" aria-hidden="true">
          <span className="member-profile__hero-scene" />
          <span className="member-profile__hero-crest" />
        </div>

        <div className="member-profile__avatar">
          <MemberAvatar member={member} mainCharacter={mainCharacter} />
          {mainCharacter?.level && !member.avatarUrl ? <b className="member-profile__avatar-level">{mainCharacter.level}</b> : null}
        </div>

        <div className="member-profile__identity">
          <h1 id="member-profile-name">{displayName(member)}</h1>
          <p className="member-profile__meta-row">
            <span className="member-profile__username">@{member.username}</span>
            {member.profile?.battleTag ? (
              <span className="member-profile__battletag">{member.profile.battleTag}</span>
            ) : null}
            <span className="member-profile__tenure">{tenureText(member)}</span>
          </p>
          <RankPlate member={member} size="lg" className="member-profile__rank-plate" />
          <div className="member-profile__actions">
            <button className="member-profile__action" type="button" onClick={copyProfile}>
              {copied ? 'Link copied' : 'Share profile'}
            </button>
            {isSelf ? (
              <button className="member-profile__action member-profile__action--primary" type="button" onClick={() => setEditing(true)}>
                Edit profile
              </button>
            ) : null}
          </div>
        </div>

        {mainCharacter ? (
          <aside className="member-profile__main" aria-label="Main character">
            <span className="member-profile__main-label">Main character</span>
            <CharacterCard character={mainCharacter} onOpen={openCharacter} showAffiliation={false} />
            <span className="member-profile__main-class">{characterDescriptor(mainCharacter)}</span>
          </aside>
        ) : null}

        {!isSelf && (canManageRank || canManageBillets) ? (
          <div className="member-profile__command" aria-label="Rank and billet management">
            <span className="member-profile__command-label">Officer tools</span>
            {canManageRank ? (
              <MemberRankControl member={member} onUpdated={(updatedMember) => setMember(updatedMember)} />
            ) : null}
            {canManageBillets ? (
              <MemberBilletControl
                member={member}
                billets={billets}
                onUpdated={(updatedMember) => setMember(updatedMember)}
                triggerLabel="Manage billets"
                showCount={false}
              />
            ) : null}
          </div>
        ) : null}
      </section>

      <RepBar member={member} className="member-profile__rep" />

      <section className="member-profile__stats" aria-label="Member service totals">
        <article>
          <StatIcon name="marks" />
          <span>Marks earned</span>
          <strong>{formatNumber(contribution.marks)}</strong>
        </article>
        <article>
          <StatIcon name="objectives" />
          <span>Objectives complete</span>
          <strong>{formatNumber(contribution.completedObjectives)}</strong>
        </article>
        <article>
          <StatIcon name="assignments" />
          <span>Active assignments</span>
          <strong>{formatNumber(assignments.length)}</strong>
        </article>
        <article>
          <StatIcon name="active" />
          <span>Last active</span>
          <strong className="member-profile__stat-date">{member.lastActivityAt ? formatDate(member.lastActivityAt) : '—'}</strong>
        </article>
      </section>

      <Characters
        member={member}
        synced={synced}
        charactersReady={charactersReady}
        editable={isSelf}
        onEdit={() => setEditing(true)}
        onOpenCharacter={openCharacter}
      />

      <div className="member-profile__activity-grid">
      <section
        className="member-profile__section"
        aria-labelledby="member-assignments-title"
      >
        <div className="member-profile__section-heading">
          <div>
            <p>Current work</p>
            <h2 id="member-assignments-title">On Assignment</h2>
          </div>

          <div className="member-profile__section-meta">
            <span>
              {assignments.length
                ? `${assignments.length} active ${assignments.length === 1 ? 'objective' : 'objectives'}`
                : 'No active objectives'}
            </span>
            <a href="/quests">Open Quest Board</a>
          </div>
        </div>

        {assignments.length ? (
          <div className="member-profile__assignments">
            {assignments.map((assignment) => (
              <article
                className="member-profile__assignment"
                key={assignment.objectiveId}
              >
                <div className="member-profile__assignment-top">
                  <div>
                    <p>{assignment.questTitle}</p>
                    <h3>{assignment.objectiveTitle}</h3>
                  </div>
                  <span
                    className={`member-profile__priority member-profile__priority--${String(
                      assignment.priority || 'medium',
                    ).toLowerCase()}`}
                  >
                    {assignment.priority || 'Medium'}
                  </span>
                </div>

                <div className="member-profile__assignment-details">
                  {assignment.responsibility ? (
                    <p className="member-profile__responsibility">
                      <strong>Responsibility</strong>
                      <span>{assignment.responsibility}</span>
                    </p>
                  ) : null}

                  {assignment.detail ? (
                    <p className="member-profile__detail">
                      <strong>Notes</strong>
                      <span>{assignment.detail}</span>
                    </p>
                  ) : null}
                </div>

                <div className="member-profile__assignment-footer">
                  <Reward reward={assignment.reward} />
                  <a
                    href={`/quests?q=${encodeURIComponent(assignment.questTitle)}`}
                  >
                    View quest →
                  </a>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="member-profile__empty">
            <strong>Nothing assigned right now.</strong>
            <span>
              This member has no active quest objectives. Check the quest board
              for open work.
            </span>
          </div>
        )}
      </section>

      <section
        className="member-profile__section member-profile__service"
        aria-labelledby="member-service-title"
      >
        <div className="member-profile__section-heading">
          <div>
            <p>Completed work</p>
            <h2 id="member-service-title">Service Record</h2>
          </div>

          <div className="member-profile__section-meta">
            <span>
              {member.activityCount
                ? `${member.activityCount} recorded ${member.activityCount === 1 ? 'entry' : 'entries'}`
                : 'No recorded entries yet'}
            </span>
          </div>
        </div>

        {activity.length ? (
          <div className="member-profile__service-list">
            {(showAllService ? activity : activity.slice(0, SERVICE_PREVIEW)).map((entry) => (
              <article className="member-profile__activity" key={entry.id}>
                <div className="member-profile__activity-main">
                  <p>{entry.questTitle}</p>
                  <h3>{entry.objectiveTitle}</h3>
                  <Reward reward={entry} />
                </div>

                <div className="member-profile__activity-meta">
                  <time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
                  {entry.awardedBy?.displayName ? (
                    <small>Awarded by {entry.awardedBy.displayName}</small>
                  ) : null}
                </div>
              </article>
            ))}
            {activity.length > SERVICE_PREVIEW ? (
              <div className="member-profile__service-more">
                <button className="member-profile__edit" type="button" onClick={() => setShowAllService((value) => !value)}>
                  {showAllService ? 'Show recent only' : `Show ${activity.length - SERVICE_PREVIEW} more`}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="member-profile__empty">
            <strong>The record starts with the work.</strong>
            <span>
              Completed and rewarded guild objectives will appear here over time.
            </span>
          </div>
        )}
      </section>

      </div>

      <CharacterProfileModal characterId={selectedCharacterId} onClose={() => openCharacter('')} />

      {editing ? (
        <MemberProfileEditor
          member={member}
          onClose={() => setEditing(false)}
          onSaved={(updatedMember) => {
            setMember(updatedMember)
            setEditing(false)
          }}
        />
      ) : null}
    </PageShell>
  )
}

export default MemberProfile
