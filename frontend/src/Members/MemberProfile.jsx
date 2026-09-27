import { useEffect, useMemo, useState } from 'react'
import { apiJson } from '../Api/apiClient.js'
import Home from '../Home/Home.jsx'
import PageShell from '../PageShell/PageShell.jsx'
import { useSession } from '../Auth/SessionProvider.jsx'
import MemberAccessModal from './MemberAccessModal.jsx'
import MemberProfileEditor from './MemberProfileEditor.jsx'
import RankInsignia from './RankInsignia.jsx'
import './MemberProfile.css'

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

function MemberAvatar({ member }) {
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

function fallbackRepProgression(rank, lifetimeRep) {
  const rep = Math.max(0, Number(lifetimeRep) || 0)
  const floors = {
    Recruit: { start: 0, end: 3000, nextRank: 'Corporal', label: 'Corporal breakpoint' },
    Private: { start: 0, end: 3000, nextRank: 'Corporal', label: 'Corporal breakpoint' },
    Corporal: { start: 3000, end: 9000, nextRank: 'Sergeant', label: 'Sergeant Rep floor' },
    Sergeant: { start: 9000, end: 21000, nextRank: 'Master Sergeant', label: 'Master Sergeant Rep floor' },
    'Master Sergeant': { start: 21000, end: 42000, nextRank: 'Sergeant Major', label: 'Sergeant Major Rep floor' },
  }

  const target = floors[rank]

  if (!target) {
    return {
      mode: 'lifetime',
      lifetimeRep: rep,
      segmentStart: 0,
      segmentEnd: 42000,
      segmentSize: 42000,
      remaining: null,
      progress: Math.min(1, rep / 42000),
      thresholdMet: rep >= 42000,
      nextRank: null,
      label: 'Lifetime Rep',
      detail:
        rank === 'Sergeant Major'
          ? 'All enlisted Rep floors are met. Rep continues accumulating.'
          : 'Officer progression is separate from Rep.',
    }
  }

  const segmentSize = target.end - target.start
  const segmentEarned = Math.min(
    segmentSize,
    Math.max(0, rep - target.start),
  )

  return {
    mode: 'eligibility',
    lifetimeRep: rep,
    segmentStart: target.start,
    segmentEnd: target.end,
    segmentSize,
    remaining: Math.max(0, target.end - rep),
    progress: segmentEarned / segmentSize,
    thresholdMet: rep >= target.end,
    nextRank: target.nextRank,
    label: target.label,
    detail:
      rep >= target.end
        ? 'Rep requirement met. Promotion is still a leadership decision.'
        : `${formatNumber(target.end - rep)} Rep remaining.`,
  }
}


function officerRepMilestone(lifetimeRep) {
  const rep = Math.max(0, Number(lifetimeRep) || 0)
  const milestones = [3000, 9000, 21000, 42000]
  const next = milestones.find((value) => rep < value)

  if (!next) {
    return {
      mode: 'lifetime',
      lifetimeRep: rep,
      segmentStart: 0,
      segmentEnd: 42000,
      segmentSize: 42000,
      remaining: null,
      progress: 1,
      thresholdMet: true,
      nextRank: null,
      label: 'Lifetime Rep',
      detail: 'Officer rank is by appointment. Rep continues recording contribution independently.',
    }
  }

  const previous = milestones.filter((value) => value < next).at(-1) || 0
  const segmentSize = next - previous
  const segmentEarned = Math.max(0, rep - previous)

  return {
    mode: 'milestone',
    lifetimeRep: rep,
    segmentStart: previous,
    segmentEnd: next,
    segmentSize,
    remaining: next - rep,
    progress: segmentEarned / segmentSize,
    thresholdMet: false,
    nextRank: null,
    label: `${formatNumber(next)} Rep milestone`,
    detail: 'Officer rank is by appointment. Rep continues recording contribution independently.',
  }
}

function RankProgress({ member }) {
  const lifetimeRep = Number(member.contribution?.rep) || 0
  const isOfficer = Boolean(member.rankMeta?.isOfficer)
  const progression = isOfficer
    ? officerRepMilestone(lifetimeRep)
    : member.repProgression ||
      fallbackRepProgression(member.rank || 'Recruit', lifetimeRep)

  const percent = Math.min(
    100,
    Math.max(0, (Number(progression.progress) || 0) * 100),
  )
  const segmentCurrent =
    progression.mode === 'eligibility' || progression.mode === 'milestone'
      ? Math.min(
          Math.max(lifetimeRep - Number(progression.segmentStart || 0), 0),
          Number(progression.segmentSize || 0),
        )
      : Math.min(lifetimeRep, Number(progression.segmentEnd || 42000))

  let note = progression.detail

  if (member.rank === 'Recruit') {
    note =
      `${formatNumber(progression.remaining)} Rep to the Corporal contribution breakpoint. Private is an onboarding promotion.`
  } else if (progression.mode === 'eligibility' && progression.thresholdMet) {
    note =
      'Rep floor met. Promotion still depends on trust, recommendation, qualification, and guild need.'
  } else if (progression.mode === 'eligibility') {
    note =
      `${formatNumber(progression.remaining)} Rep to ${progression.nextRank || progression.label} eligibility.`
  } else if (progression.mode === 'milestone') {
    note =
      `${formatNumber(progression.remaining)} Rep to the next service milestone. Officer rank is by appointment.`
  }

  return (
    <section
      className="member-profile__progress"
      aria-labelledby="member-rank-title"
    >
      <div className="member-profile__progress-rank">
        <div className="member-profile__progress-insignia">
          <RankInsignia rank={member.rank} />
        </div>

        <div>
          <span>Guild rank</span>
          <h2 id="member-rank-title">{member.rank || 'Recruit'}</h2>
        </div>
      </div>

      <div className="member-profile__progress-rep">
        <div className="member-profile__progress-heading">
          <span>Reputation</span>
          <strong>{formatNumber(lifetimeRep)} Rep</strong>
        </div>

        <div
          className="member-profile__progress-bar"
          role="progressbar"
          aria-label={progression.label}
          aria-valuemin="0"
          aria-valuemax={
            Number(progression.segmentSize) ||
            Number(progression.segmentEnd) ||
            42000
          }
          aria-valuenow={segmentCurrent}
        >
          <span
            className="member-profile__progress-fill"
            data-has-progress={lifetimeRep > 0}
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="member-profile__progress-scale">
          <span>{formatNumber(progression.segmentStart || 0)}</span>
          <strong>
            {progression.mode === 'eligibility'
              ? `${formatNumber(segmentCurrent)} / ${formatNumber(progression.segmentSize)} this tier`
              : progression.mode === 'milestone'
                ? `${formatNumber(segmentCurrent)} / ${formatNumber(progression.segmentSize)} this milestone`
                : `${formatNumber(lifetimeRep)} lifetime`}
          </strong>
          <span>{formatNumber(progression.segmentEnd || 42000)}</span>
        </div>

        <p className="member-profile__progress-note">{note}</p>
      </div>
    </section>
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
        <p>GuildOS</p>
        <h1>{title}</h1>
        <span>{body}</span>
        <a href="/members">Back to Members</a>
      </section>

    </PageShell>
  )
}

function characterDescriptor(character) {
  return [character?.race, character?.className, character?.spec]
    .filter(Boolean)
    .join(' · ')
}

function CharacterCard({ character, main = false }) {
  if (!character) {
    return null
  }

  return (
    <article
      className={`member-profile__character ${
        main ? 'member-profile__character--main' : ''
      }`}
    >
      <div>
        <span>{main ? 'Main character' : 'Alt'}</span>
        <h3>{character.name}</h3>
        {characterDescriptor(character) ? (
          <p>{characterDescriptor(character)}</p>
        ) : null}
      </div>

      {character.professions?.length ? (
        <div className="member-profile__professions">
          {character.professions.map((profession) => (
            <span key={profession}>{profession}</span>
          ))}
        </div>
      ) : null}
    </article>
  )
}

function PlayerIdentity({ member, editable, onEdit }) {
  const profile = member.profile || {}
  const characters = Array.isArray(profile.characters)
    ? profile.characters
    : []
  const mainCharacter =
    member.mainCharacter ||
    characters.find((character) => character.isMain) ||
    characters[0] ||
    null
  const alts = characters.filter(
    (character) => !mainCharacter || character.id !== mainCharacter.id,
  )
  const hasContact =
    profile.timezone || profile.availability || profile.bio
  const hasIdentity = mainCharacter || alts.length || hasContact

  if (!hasIdentity && !editable) {
    return null
  }

  return (
    <section
      className="member-profile__section member-profile__player"
      aria-labelledby="member-player-title"
    >
      <div className="member-profile__section-heading">
        <div>
          <p>Player</p>
          <h2 id="member-player-title">In Azeroth</h2>
        </div>

        {editable ? (
          <button
            className="member-profile__edit"
            type="button"
            onClick={onEdit}
          >
            Edit profile
          </button>
        ) : null}
      </div>

      {hasIdentity ? (
        <div
          className={`member-profile__player-body ${
            hasContact ? '' : 'member-profile__player-body--characters-only'
          }`}
        >
          <div className="member-profile__characters">
            {mainCharacter ? (
              <CharacterCard character={mainCharacter} main />
            ) : (
              <div className="member-profile__player-empty">
                <strong>No main character listed.</strong>
                <span>Add your main so guildmates know who to look for in game.</span>
              </div>
            )}

            {alts.length ? (
              <div className="member-profile__alts">
                {alts.map((character) => (
                  <CharacterCard key={character.id} character={character} />
                ))}
              </div>
            ) : null}
          </div>

          {hasContact ? (
            <aside className="member-profile__contact">
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

              {profile.bio ? (
                <div className="member-profile__bio">
                  <span>About</span>
                  <p>{profile.bio}</p>
                </div>
              ) : null}
            </aside>
          ) : null}
        </div>
      ) : (
        <button
          className="member-profile__identity-empty"
          type="button"
          onClick={onEdit}
        >
          <strong>Build your guild card</strong>
          <span>
            Add your BattleTag, main character, class, spec, professions, and
            when you usually play.
          </span>
        </button>
      )}
    </section>
  )
}

function MemberProfile({ memberId }) {
  const session = useSession()
  const [member, setMember] = useState(null)
  const [status, setStatus] = useState('loading')
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)

  const isSelfRoute = memberId === 'me'
  const endpoint = isSelfRoute
    ? '/api/guild/members/me'
    : `/api/guild/members/${encodeURIComponent(memberId)}`

  useEffect(() => {
    if (!session.authenticated) {
      setStatus('ready')
      return undefined
    }

    const controller = new AbortController()
    let active = true
    setStatus('loading')

    async function loadProfile() {
      try {
        const result = await apiJson(endpoint, {
          signal: controller.signal,
        })

        if (!active) return
        setMember(result?.member || null)
        setStatus(result?.member ? 'ready' : 'not-found')
      } catch (error) {
        if (!active || error?.name === 'AbortError') return
        setStatus(error?.status === 404 ? 'not-found' : 'error')
      }
    }

    void loadProfile()

    return () => {
      active = false
      controller.abort()
    }
  }, [endpoint, session.authenticated])

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
  const closeGate = () => window.location.assign('/')

  if (session.status === 'loading' || session.status === 'error') {
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
        body="GuildOS could not load this member right now."
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

  return (
    <PageShell className="member-profile member-profile--loaded">
      <nav className="member-profile__crumbs" aria-label="Member profile navigation">
        <a href="/members">Members</a>
        <span aria-hidden="true">/</span>
        <span>{displayName(member)}</span>
      </nav>

      <section className="member-profile__hero" aria-labelledby="member-profile-name">
        <div className="member-profile__avatar">
          <MemberAvatar member={member} />
        </div>

        <div className="member-profile__identity">
          <div className="member-profile__name-line">
            <h1 id="member-profile-name">{displayName(member)}</h1>
          </div>

          <div className="member-profile__meta-row">
            <p className="member-profile__username">@{member.username}</p>
            {member.profile?.battleTag ? (
              <span className="member-profile__battletag">
                {member.profile.battleTag}
              </span>
            ) : null}
            <button
              className="member-profile__share"
              type="button"
              onClick={copyProfile}
            >
              {copied ? 'Copied' : 'Share profile'}
            </button>
            {isSelf ? (
              <button
                className="member-profile__share"
                type="button"
                onClick={() => setEditing(true)}
              >
                Edit profile
              </button>
            ) : null}
          </div>
          <p className="member-profile__tenure">{tenureText(member)}</p>
        </div>
      </section>

      <RankProgress member={member} />

      <section className="member-profile__stats" aria-label="Member service totals">
        <article>
          <span>Marks earned</span>
          <strong>{formatNumber(contribution.marks)}</strong>
        </article>
        <article>
          <span>Objectives complete</span>
          <strong>{formatNumber(contribution.completedObjectives)}</strong>
        </article>
        <article>
          <span>Active assignments</span>
          <strong>{formatNumber(assignments.length)}</strong>
        </article>
      </section>

      <PlayerIdentity
        member={member}
        editable={isSelf}
        onEdit={() => setEditing(true)}
      />

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
              This member is free of active GuildOS objectives. Check the quest
              board for open work.
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
            {activity.map((entry) => (
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
