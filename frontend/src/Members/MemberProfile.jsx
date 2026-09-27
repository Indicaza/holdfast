import { useEffect, useMemo, useState } from 'react'
import PageShell from '../PageShell/PageShell.jsx'
import { useSession } from '../Auth/SessionProvider.jsx'
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
    return <span className="member-profile__reward-empty">No reward</span>
  }

  return (
    <div className="member-profile__rewards">
      {reward.rep > 0 ? <span>+{reward.rep} Rep</span> : null}
      {reward.marks > 0 ? <span>+{reward.marks} Marks</span> : null}
      {items.map((item) => (
        <span key={item.id || item.name}>
          {item.quantity > 1 ? `${item.quantity}× ` : ''}
          {item.name}
        </span>
      ))}
    </div>
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

  if (session.status === 'loading') {
    return (
      <PageShell title="Member" centered className="member-profile">
        <p className="member-profile__state">Opening member profile…</p>
      </PageShell>
    )
  }

  if (!session.authenticated) {
    return (
      <PageShell
        eyebrow="GuildOS"
        title="Member profile"
        intro="Member profiles are available to Holdfast members."
        centered
        className="member-profile"
      >
        <div className="member-profile__signin">
          <button
            type="button"
            onClick={() =>
              session.signIn(
                isSelfRoute ? '/members/me' : `/members/${memberId}`,
                'member',
              )
            }
          >
            Sign in with Discord
          </button>
          <a href="/join">New here? Join Holdfast</a>
        </div>
      </PageShell>
    )
  }

  if (status === 'loading') {
    return (
      <PageShell title="Member" centered className="member-profile">
        <p className="member-profile__state">Opening member profile…</p>
      </PageShell>
    )
  }

  if (status === 'not-found' || !member) {
    return (
      <PageShell
        eyebrow="Members"
        title="Member not found"
        intro="That profile is not in the Holdfast member directory."
        centered
        className="member-profile"
      >
        <div className="member-profile__back">
          <a href="/members">Back to Members</a>
        </div>
      </PageShell>
    )
  }

  if (status === 'error') {
    return (
      <PageShell
        eyebrow="Members"
        title="Profile unavailable"
        intro="GuildOS could not load this member right now."
        centered
        className="member-profile"
      >
        <div className="member-profile__back">
          <a href="/members">Back to Members</a>
        </div>
      </PageShell>
    )
  }

  const contribution = member.contribution || {}
  const assignments = member.assignments || []
  const activity = member.activity || []

  return (
    <PageShell className="member-profile">
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
          <div className="member-profile__badges">
            {isSelf ? <span>You</span> : null}
            <span>{member.role || 'Member'}</span>
          </div>
          <h1 id="member-profile-name">{displayName(member)}</h1>
          <p>@{member.username}</p>
          <div className="member-profile__meta">
            <span>Member since {formatDate(member.firstSeenAt, false)}</span>
            <span>Last activity {formatDate(member.lastActivityAt)}</span>
          </div>
        </div>

        <div className="member-profile__hero-actions">
          {isSelf ? <a href="/guildos">Open GuildOS</a> : null}
          <button type="button" onClick={copyProfile}>
            {copied ? 'Copied' : 'Copy profile link'}
          </button>
        </div>
      </section>

      <section className="member-profile__stats" aria-label="Member service totals">
        <article>
          <span>Reputation</span>
          <strong>{Number(contribution.rep) || 0}</strong>
          <small>Guild Rep earned</small>
        </article>
        <article>
          <span>Service Marks</span>
          <strong>{Number(contribution.marks) || 0}</strong>
          <small>Available service record</small>
        </article>
        <article>
          <span>Objectives</span>
          <strong>{Number(contribution.completedObjectives) || 0}</strong>
          <small>Completed and rewarded</small>
        </article>
        <article>
          <span>On assignment</span>
          <strong>{assignments.length}</strong>
          <small>Current objectives</small>
        </article>
      </section>

      <div className="member-profile__grid">
        <section className="member-profile__section" aria-labelledby="member-assignments-title">
          <div className="member-profile__section-heading">
            <div>
              <p>Current work</p>
              <h2 id="member-assignments-title">On Assignment</h2>
            </div>
            <a href="/quests">Quest board →</a>
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
                      <strong>Role</strong>
                      {assignment.responsibility}
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
              <strong>No active assignments.</strong>
              <span>This member is not assigned to an open guild objective right now.</span>
            </div>
          )}
        </section>

        <aside className="member-profile__details" aria-labelledby="member-details-title">
          <p>Profile</p>
          <h2 id="member-details-title">Member Details</h2>
          <dl>
            <div>
              <dt>Discord</dt>
              <dd>@{member.username}</dd>
            </div>
            <div>
              <dt>Standing</dt>
              <dd>{member.role || 'Member'}</dd>
            </div>
            <div>
              <dt>Joined GuildOS</dt>
              <dd>{formatDate(member.firstSeenAt)}</dd>
            </div>
            <div>
              <dt>Last activity</dt>
              <dd>{formatDate(member.lastActivityAt)}</dd>
            </div>
          </dl>
        </aside>
      </div>

      <section className="member-profile__section member-profile__service" aria-labelledby="member-service-title">
        <div className="member-profile__section-heading">
          <div>
            <p>History</p>
            <h2 id="member-service-title">Service Record</h2>
          </div>
          <span>{activity.length} recorded {activity.length === 1 ? 'entry' : 'entries'}</span>
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
                  <span>{formatDate(entry.createdAt)}</span>
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
            <strong>No service entries yet.</strong>
            <span>Completed guild objectives will build this record over time.</span>
          </div>
        )}
      </section>
    </PageShell>
  )
}

export default MemberProfile
