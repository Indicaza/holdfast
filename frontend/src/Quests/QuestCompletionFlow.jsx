import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import { apiJson } from '../Api/apiClient.js'
import { runAuthenticatedMutation } from '../Auth/authenticatedMutation.js'
import { questScopeAllows } from './questAuthority.js'
import './QuestCompletionFlow.css'

const CompletionContext = createContext(null)

function formatWhen(value) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function QuestCompletionProvider({ quest, session, children }) {
  const [completions, setCompletions] = useState({})
  const [loading, setLoading] = useState(true)
  const [busyObjectiveId, setBusyObjectiveId] = useState('')
  const [feedback, setFeedback] = useState({})

  const load = useCallback(async () => {
    if (!quest?.id || !session.authenticated) return

    try {
      const result = await apiJson(
        `/api/quests/member/completions?questId=${encodeURIComponent(quest.id)}`,
      )
      setCompletions(result?.completions || {})
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        __quest: error?.message || 'Completion status could not be loaded.',
      }))
    } finally {
      setLoading(false)
    }
  }, [quest?.id, session.authenticated])

  useEffect(() => {
    setLoading(true)
    setCompletions({})
    setFeedback({})
    void load()
  }, [load])

  async function authenticatedMutation(request) {
    return runAuthenticatedMutation({
      request,
      refresh: session.refresh,
      reauthenticate: () =>
        session.signIn(
          window.location.pathname + window.location.search + window.location.hash,
          'member',
        ),
    })
  }

  async function mutate(objectiveId, request, successMessage) {
    setBusyObjectiveId(objectiveId)
    setFeedback((current) => ({ ...current, [objectiveId]: '' }))

    try {
      const result = await authenticatedMutation(request)
      if (!result) return false

      await load()
      setFeedback((current) => ({
        ...current,
        [objectiveId]: successMessage,
      }))
      return true
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [objectiveId]: error?.message || 'Holdfast could not save that change.',
      }))
      return false
    } finally {
      setBusyObjectiveId('')
    }
  }

  const value = {
    session,
    completions,
    loading,
    busyObjectiveId,
    feedback,
    requestCompletion: (objectiveId, note) =>
      mutate(
        objectiveId,
        () =>
          apiJson('/api/quests/member/request-completion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              questId: quest.id,
              objectiveId,
              note,
            }),
          }),
        'Completion requested.',
      ),
    withdrawCompletion: (objectiveId) =>
      mutate(
        objectiveId,
        () =>
          apiJson('/api/quests/member/withdraw-completion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              questId: quest.id,
              objectiveId,
            }),
          }),
        'Completion request withdrawn.',
      ),
    reviewCompletion: (objectiveId, decision, note) =>
      mutate(
        objectiveId,
        () =>
          apiJson('/api/quests/manage/review-completion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              questId: quest.id,
              objectiveId,
              decision,
              note,
            }),
          }),
        decision === 'approved'
          ? 'Work approved.'
          : 'Sent back to the assignee.',
      ),
  }

  return (
    <CompletionContext.Provider value={value}>
      {feedback.__quest ? (
        <p className="quest-completion__load-error">{feedback.__quest}</p>
      ) : null}
      {children}
    </CompletionContext.Provider>
  )
}

export function QuestCompletionControls({
  quest,
  objective,
  selfAssignment,
  rewardApproval,
  hasReward,
  canIssue,
  canIssueNow,
  parentBusy,
  onIssue,
}) {
  const flow = useContext(CompletionContext)
  const [requestNote, setRequestNote] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [reviewNote, setReviewNote] = useState('')

  if (!flow || objective.completed) return null

  const completion = flow.completions[objective.id]
  const status = completion?.status || ''
  const localBusy = flow.busyObjectiveId === objective.id
  const busy = parentBusy || localBusy
  const isRequester = completion?.requestedByMemberId === flow.session.user?.id
  const canReview =
    questScopeAllows(flow.session, 'rewards.issue', quest) &&
    completion?.requestedByMemberId !== flow.session.user?.id
  const canRequest = Boolean(selfAssignment) &&
    (!status || status === 'rejected' || status === 'stale')

  async function requestCompletion() {
    const saved = await flow.requestCompletion(objective.id, requestNote)
    if (saved) setRequestNote('')
  }

  async function rejectCompletion() {
    if (!reviewNote.trim()) return
    const saved = await flow.reviewCompletion(
      objective.id,
      'rejected',
      reviewNote,
    )
    if (saved) {
      setReviewNote('')
      setShowReject(false)
    }
  }

  if (flow.loading && !completion) {
    return (
      <div className="quest-completion quest-completion--loading">
        <span>Checking completion status…</span>
      </div>
    )
  }

  return (
    <section className={`quest-completion${status ? ` quest-completion--${status}` : ''}`}>
      <header className="quest-completion__header">
        <div>
          <span className="quest-completion__eyebrow">Work completion</span>
          <strong>
            {!status
              ? 'Still in progress'
              : status === 'pending'
                ? 'Ready for review'
                : status === 'approved'
                  ? 'Work approved'
                  : status === 'rejected'
                    ? 'Needs changes'
                    : status === 'stale'
                      ? 'Request is outdated'
                      : 'Completed'}
          </strong>
        </div>
        {status ? <span className="quest-completion__status">{status}</span> : null}
      </header>

      {completion ? (
        <div className="quest-completion__history">
          <span>
            Requested by <strong>{completion.requestedByName}</strong>
            {completion.requestedAt ? ` · ${formatWhen(completion.requestedAt)}` : ''}
          </span>
          {completion.requestNote ? <p>{completion.requestNote}</p> : null}
          {completion.reviewedByName ? (
            <span>
              Reviewed by <strong>{completion.reviewedByName}</strong>
              {completion.reviewedAt ? ` · ${formatWhen(completion.reviewedAt)}` : ''}
            </span>
          ) : null}
          {completion.reviewNote ? (
            <p className="quest-completion__review-note">{completion.reviewNote}</p>
          ) : null}
        </div>
      ) : null}

      {status === 'stale' ? (
        <p className="quest-completion__explanation">
          The objective, reward, or assigned members changed after this request.
          Submit it again when the current version is done.
        </p>
      ) : null}

      {status === 'approved' ? (
        <p className="quest-completion__explanation">
          {canIssue
            ? 'The work is verified. Final completion will record contribution and issue any approved rewards.'
            : hasReward && rewardApproval !== 'approved'
              ? 'The work is verified. The reward still needs approval before it can be issued.'
              : 'The work is verified. Waiting for an officer with payout authority to close it out.'}
        </p>
      ) : null}

      {canRequest ? (
        <div className="quest-completion__request">
          <label>
            <span>Completion note <small>optional</small></span>
            <textarea
              rows="2"
              maxLength="800"
              value={requestNote}
              disabled={busy}
              placeholder="What was finished? Anything the reviewer should know?"
              onChange={(event) => setRequestNote(event.target.value)}
            />
          </label>
          <button
            className="quest-completion__primary"
            type="button"
            disabled={busy}
            onClick={requestCompletion}
          >
            {localBusy ? 'Requesting…' : status ? 'Request review again' : 'Request completion'}
          </button>
        </div>
      ) : null}

      {status === 'pending' && isRequester ? (
        <div className="quest-completion__actions">
          <span>An officer can now verify the work.</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => flow.withdrawCompletion(objective.id)}
          >
            Withdraw request
          </button>
        </div>
      ) : null}

      {status === 'pending' && canReview ? (
        <div className="quest-completion__review">
          <div className="quest-completion__actions">
            <button
              className="quest-completion__primary"
              type="button"
              disabled={busy}
              onClick={() =>
                flow.reviewCompletion(objective.id, 'approved', '')
              }
            >
              Approve work
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowReject((current) => !current)}
            >
              Needs changes
            </button>
          </div>

          {showReject ? (
            <div className="quest-completion__reject">
              <label>
                <span>What needs to change?</span>
                <textarea
                  rows="2"
                  maxLength="800"
                  value={reviewNote}
                  disabled={busy}
                  autoFocus
                  onChange={(event) => setReviewNote(event.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={busy || !reviewNote.trim()}
                onClick={rejectCompletion}
              >
                Send back
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {status === 'approved' && canIssue ? (
        <div className="quest-completion__actions quest-completion__actions--issue">
          <span>Final step</span>
          <button
            className="quest-completion__issue"
            type="button"
            disabled={busy || !canIssueNow}
            onClick={() => onIssue?.(quest, objective)}
          >
            Complete &amp; award
          </button>
        </div>
      ) : null}

      {flow.feedback[objective.id] ? (
        <p className="quest-completion__feedback">{flow.feedback[objective.id]}</p>
      ) : null}
    </section>
  )
}
