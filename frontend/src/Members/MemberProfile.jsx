import { useEffect, useMemo, useState } from 'react'
import Home from '../Home/Home.jsx'
import PageShell from '../PageShell/PageShell.jsx'
import { useSession } from '../Auth/SessionProvider.jsx'
import MemberAccessModal from './MemberAccessModal.jsx'
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

  return `GuildOS member since ${formatDate(member.firstSeenAt, false)}`
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

function RepProgress({ member }) {
  const progression = member.repProgression
  const lifetimeRep = Number(member.contribution?.rep) || 0

  if (!progression) {
    return null
  }

  const percent = Math.min(
    100,
    Math.max(0, (Number(progression.progress) || 0) * 100),
  )
  const segmentCurrent =
    progression.mode === 'eligibility'
      ? Math.min(
          Math.max(lifetimeRep - Number(progression.segmentStart || 0), 0),
          Number(progression.segmentSize || 0),
        )
      : Math.min(lifetimeRep, Number(progression.segmentEnd || 42000))

  let note = progression.detail

  if (member.rank === 'Recruit') {
    note =
      'Private promotion is onboarding-based. Rep still accumulates toward the Corporal contribution breakpoint.'
  } else if (progression.mode === 'eligibility' && progression.thresholdMet) {
    note =
      'Rep requirement met. Promotion still depends on trust, recommendation, qualification, and guild need.'
  }

  return (
    <section className="member-profile__rep" aria-labelledby="member-rep-title">
      <div className="member-profile__rep-heading">
        <div>
          <p>Guild Reputation</p>
          <h2 id="member-rep-title">{formatNumber(lifetimeRep)} Rep</h2>
        </div>

        <div className="member-profile__rep-target">
          <span>{progression.label}</span>
          {progression.mode === 'eligibility' ? (
            <strong>
              {progression.thresholdMet
                ? 'Rep floor met'
                : `${formatNumber(progression.remaining)} to go`}
            </strong>
          ) : (
            <strong>Lifetime service</strong>
          )}
        </div>
      </div>

      <div
        className="member-profile__rep-bar"
        role="progressbar"
        aria-label={progression.label}
        aria-valuemin="0"
        aria-valuemax={Number(progression.segmentSize) || Number(progression.segmentEnd) || 42000}
        aria-valuenow={segmentCurrent}
      >
        <span
          className="member-profile__rep-fill"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="member-profile__rep-scale">
        <span>{formatNumber(progression.segmentStart || 0)}</span>
        <strong>
          {progression.mode === 'eligibility'
            ? `${formatNumber(segmentCurrent)} / ${formatNumber(progression.segmentSize)} this tier`
            : `${formatNumber(lifetimeRep)} lifetime`}
        </strong>
        <span>{formatNumber(progression.segmentEnd || 42000)}</span>
      </div>

      <p className="member-profile__rep-note">{note}</p>
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

function MemberProfile({ memberId }) {
  const session = useSession()
  const [member, setMember] = useState(null)
  const [status, setStatus] = useState('loading')
  const [copied, setCopied] = useState(false)

  const isSelfRoute = memberId === 'me'
  const endpoint = isSelfRoute
    ? '/api/guild/members/me'
    : `/api/guild/members/${encodeURIComponent(memberId)}`

  useEffect(() => {
    if (!session.authenticated) {
      setStatus('ready')
      return undefined
    }

    let active = true
    setStatus('loading')

    fetch(endpoint, {
      credentials: 'include',
      cache: 'no-store',
    })
      .then((response) => {
        if (response.status === 404) {
          const error = new Error('Member not found')
          error.code = 'not-found'
          throw error
        }

        if (!response.ok) {
          throw new Error('Member profile unavailable')
        }

        return response.json()
      })
      .then((result) => {
        if (!active) return
        setMember(result?.member || null)
        setStatus(result?.member ? 'ready' : 'not-found')
      })
      .catch((error) => {
        if (!active) return
        setStatus(error.code === 'not-found' ? 'not-found' : 'error')
      })

    return () => {
      active = false
    }
  }, [endpoint, session.authenticated])

  const isSelf = member?.id === session.user?.id

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
          <div className="member-profile__rank">
            <div className="member-profile__rank-icon">
              <RankInsignia rank={member.rank} />
            </div>
            <div>
              <span>Guild Rank</span>
              <strong>{member.rank || 'Recruit'}</strong>
            </div>
          </div>

          <div className="member-profile__name-line">
            <h1 id="member-profile-name">{displayName(member)}</h1>
            {isSelf ? <span>You</span> : null}
          </div>

          <p className="member-profile__username">@{member.username}</p>
          <p className="member-profile__tenure">{tenureText(member)}</p>
        </div>

        <div className="member-profile__hero-actions">
          {isSelf ? <a href="/guildos">Open GuildOS</a> : null}
          <button type="button" onClick={copyProfile}>
            {copied ? 'Profile link copied' : 'Copy profile link'}
          </button>
        </div>
      </section>

      <RepProgress member={member} />

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

                {assignment.responsibility ? (
                  <p className="member-profile__responsibility">
                    <strong>Responsibility</strong>
                    <span>{assignment.responsibility}</span>
                  </p>
                ) : null}

                {assignment.detail ? (
                  <p className="member-profile__detail">{assignment.detail}</p>
                ) : null}

                <Reward reward={assignment.reward} />
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
          <div className="member-profile__timeline">
            {activity.map((entry) => (
              <article className="member-profile__activity" key={entry.id}>
                <div className="member-profile__activity-marker" aria-hidden="true" />

                <div className="member-profile__activity-copy">
                  <div>
                    <p>{entry.questTitle}</p>
                    <h3>{entry.objectiveTitle}</h3>
                  </div>

                  <time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>

                  <Reward reward={entry} />

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
    </PageShell>
  )
}

export default MemberProfile
