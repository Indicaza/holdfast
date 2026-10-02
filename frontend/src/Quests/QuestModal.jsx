import { useMemo, useState } from 'react'
import Modal from '../Modal/Modal.jsx'
import { objectiveSelfAssignment } from './QuestSignupFlow.jsx'
import {
  PRIORITIES,
  blankObjective,
  blankRewardApproval,
  createQuestId,
  questScopeAllows,
  rewardApprovalStatus,
  rewardAuthorityAllows,
  rewardHasValue,
} from './questAuthority.js'
import './QuestModal.css'

function RewardSummary({ reward, objective }) {
  const items = reward?.items || []
  const approval = rewardApprovalStatus(objective)

  if (!rewardHasValue(reward)) {
    return <span className="quest-modal__no-reward">No reward</span>
  }

  return (
    <div className="quest-modal__reward-summary">
      {Number(reward.rep) > 0 ? <span><strong>{reward.rep}</strong> Rep</span> : null}
      {Number(reward.marks) > 0 ? <span><strong>{reward.marks}</strong> Marks</span> : null}
      {items.map((item) => (
        <span key={item.id || `${item.name}-${item.quantity}`}>
          <strong>{item.quantity}×</strong> {item.name}
        </span>
      ))}
      <em className={`quest-modal__approval quest-modal__approval--${approval}`}>
        {approval === 'approved'
          ? 'Approved'
          : approval === 'pending'
            ? 'Pending approval'
            : 'No approval needed'}
      </em>
    </div>
  )
}

function AssignmentList({ objective }) {
  const assignments = objective.assignments || []

  if (!assignments.length) {
    return <span className="quest-modal__unassigned">Nobody signed up yet.</span>
  }

  return (
    <div className="quest-modal__assignments">
      {assignments.map((assignment, index) => (
        <span
          className={assignment.isSelf
            ? 'quest-modal__assignment quest-modal__assignment--self'
            : 'quest-modal__assignment'}
          key={`${assignment.memberId || assignment.name}-${index}`}
        >
          {assignment.avatar ? (
            <img src={assignment.avatar} alt="" width="28" height="28" />
          ) : (
            <b aria-hidden="true">{assignment.initials || '?'}</b>
          )}
          {assignment.name}
          {assignment.isSelf ? <small>You</small> : null}
        </span>
      ))}
    </div>
  )
}

function ObjectiveView({
  quest,
  objective,
  index,
  session,
  busy,
  onSignup,
  onLeave,
  onApprove,
  onIssue,
}) {
  const selfAssignment = objectiveSelfAssignment(objective)
  const approval = rewardApprovalStatus(objective)
  const hasReward = rewardHasValue(objective.reward)
  const canApprove =
    !objective.completed &&
    approval === 'pending' &&
    rewardAuthorityAllows(session, 'rewards.approve', quest, objective)
  const canIssue =
    !objective.completed &&
    quest.publication === 'published' &&
    (approval === 'approved' || !hasReward) &&
    rewardAuthorityAllows(session, 'rewards.issue', quest, objective)
  const canIssueNow =
    canIssue && (!hasReward || (objective.assignments || []).length > 0)

  return (
    <article
      className={objective.completed
        ? 'quest-modal__objective quest-modal__objective--complete'
        : 'quest-modal__objective'}
    >
      <header className="quest-modal__objective-heading">
        <div>
          <span>Objective {index + 1}</span>
          <h3>{objective.title}</h3>
        </div>
        <div className="quest-modal__objective-badges">
          <span className={`quest-modal__priority quest-modal__priority--${String(objective.priority || 'Medium').toLowerCase()}`}>
            {objective.priority || 'Medium'}
          </span>
          {objective.completed ? <span className="quest-modal__done">Complete</span> : null}
        </div>
      </header>

      {objective.description ? <p>{objective.description}</p> : null}
      {objective.need ? (
        <p className="quest-modal__need"><strong>Need</strong> {objective.need}</p>
      ) : null}

      <div className="quest-modal__objective-grid">
        <div>
          <span className="quest-modal__label">Assigned</span>
          <AssignmentList objective={objective} />
        </div>
        <div>
          <span className="quest-modal__label">Reward</span>
          <RewardSummary reward={objective.reward} objective={objective} />
        </div>
      </div>

      {!objective.completed ? (
        <footer className="quest-modal__objective-actions">
          <div className="quest-modal__member-action">
            {selfAssignment ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onLeave?.(quest, objective)}
              >
                Leave objective
              </button>
            ) : quest.publication === 'published' ? (
              <button
                className="quest-modal__primary"
                type="button"
                disabled={busy}
                onClick={() => onSignup?.(quest, objective)}
              >
                Sign up
              </button>
            ) : (
              <small>Publish this quest before members can sign up.</small>
            )}
          </div>

          <div className="quest-modal__officer-actions">
            {canApprove ? (
              <button
                className="quest-modal__approve"
                type="button"
                disabled={busy}
                onClick={() => onApprove?.(quest, objective)}
              >
                Approve reward
              </button>
            ) : null}

            {canIssue ? (
              <button
                className="quest-modal__issue"
                type="button"
                disabled={busy || !canIssueNow}
                title={
                  canIssueNow
                    ? ''
                    : 'Rewarded objectives need at least one assigned member.'
                }
                onClick={() => onIssue?.(quest, objective)}
              >
                Complete & award
              </button>
            ) : null}
          </div>
        </footer>
      ) : null}
    </article>
  )
}

function RewardEditor({ objective, limits, onChange }) {
  const reward = objective.reward || { rep: 0, marks: 0, items: [] }
  const items = reward.items || []

  function changeReward(nextReward) {
    onChange({
      ...objective,
      reward: nextReward,
      rewardApproval: blankRewardApproval(),
    })
  }

  return (
    <fieldset className="quest-modal__reward-editor">
      <legend>Reward proposal</legend>
      <div className="quest-modal__reward-numbers">
        <label>
          <span>Rep</span>
          <input
            type="number"
            min="0"
            max={limits?.rep?.max ?? 1000}
            step="1"
            value={reward.rep}
            onChange={(event) =>
              changeReward({ ...reward, rep: Number(event.target.value) || 0 })
            }
          />
          <small>Guild max {limits?.rep?.max ?? 1000}</small>
        </label>
        <label>
          <span>Marks</span>
          <input
            type="number"
            min="0"
            max={limits?.marks?.max ?? 1000}
            step="1"
            value={reward.marks}
            onChange={(event) =>
              changeReward({ ...reward, marks: Number(event.target.value) || 0 })
            }
          />
          <small>Guild max {limits?.marks?.max ?? 1000}</small>
        </label>
      </div>

      <div className="quest-modal__item-editor">
        <div className="quest-modal__subheading">
          <span>Item rewards</span>
          <button
            type="button"
            onClick={() =>
              changeReward({
                ...reward,
                items: [
                  ...items,
                  { id: createQuestId('reward-item'), name: 'Item', quantity: 1 },
                ],
              })
            }
          >
            + Add item
          </button>
        </div>

        {items.map((item, index) => (
          <div className="quest-modal__item-row" key={item.id}>
            <input
              aria-label="Item name"
              value={item.name}
              onChange={(event) =>
                changeReward({
                  ...reward,
                  items: items.map((candidate, currentIndex) =>
                    currentIndex === index
                      ? { ...candidate, name: event.target.value }
                      : candidate,
                  ),
                })
              }
            />
            <input
              aria-label="Item quantity"
              type="number"
              min="1"
              step="1"
              value={item.quantity}
              onChange={(event) =>
                changeReward({
                  ...reward,
                  items: items.map((candidate, currentIndex) =>
                    currentIndex === index
                      ? {
                          ...candidate,
                          quantity: Math.max(1, Number(event.target.value) || 1),
                        }
                      : candidate,
                  ),
                })
              }
            />
            <button
              className="quest-modal__remove"
              type="button"
              onClick={() =>
                changeReward({
                  ...reward,
                  items: items.filter((_, currentIndex) => currentIndex !== index),
                })
              }
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </fieldset>
  )
}

function ObjectiveEditor({ objective, index, limits, locked, onChange, onDelete }) {
  return (
    <section className="quest-modal__objective-editor">
      <header className="quest-modal__subheading">
        <strong>Objective {index + 1}</strong>
        <button
          className="quest-modal__remove"
          type="button"
          disabled={locked}
          onClick={onDelete}
        >
          Delete
        </button>
      </header>

      <div className="quest-modal__fields">
        <label className="quest-modal__field--wide">
          <span>Title</span>
          <input
            value={objective.title}
            disabled={locked}
            onChange={(event) => onChange({ ...objective, title: event.target.value })}
          />
        </label>

        <label>
          <span>Priority</span>
          <select
            value={objective.priority || 'Medium'}
            disabled={locked}
            onChange={(event) => onChange({ ...objective, priority: event.target.value })}
          >
            {PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
          </select>
        </label>

        <label className="quest-modal__field--wide">
          <span>Description</span>
          <textarea
            rows="3"
            value={objective.description || ''}
            disabled={locked}
            onChange={(event) =>
              onChange({ ...objective, description: event.target.value })
            }
          />
        </label>

        <label className="quest-modal__field--wide">
          <span>Need</span>
          <input
            value={objective.need || ''}
            disabled={locked}
            placeholder="Tank + healer, 3 miners, 20 linen…"
            onChange={(event) => onChange({ ...objective, need: event.target.value })}
          />
        </label>
      </div>

      {locked ? (
        <p className="quest-modal__locked">
          Completed objectives are locked because their contribution has already been recorded.
        </p>
      ) : (
        <RewardEditor objective={objective} limits={limits} onChange={onChange} />
      )}

      {(objective.assignments || []).length ? (
        <div className="quest-modal__preserved-assignments">
          <span className="quest-modal__label">Current signups</span>
          <AssignmentList objective={objective} />
          <small>Members manage their own signup from the quest view.</small>
        </div>
      ) : null}
    </section>
  )
}

function QuestEditForm({
  quest,
  session,
  rewardLimits,
  focused,
  isNew,
  busy,
  onCancel,
  onSave,
  onDelete,
}) {
  const canEditContent = isNew
    ? session.hasPermission('quests.create')
    : questScopeAllows(session, 'quests.edit', quest)
  const canPublish = questScopeAllows(session, 'quests.publish', quest)
  const canFeature =
    canPublish && session.authority?.questScopes?.['quests.publish'] === 'all'
  const [draft, setDraft] = useState(() => structuredClone(quest))
  const [featured, setFeatured] = useState(Boolean(focused))
  const [confirmDelete, setConfirmDelete] = useState(false)

  const dirty = useMemo(
    () =>
      JSON.stringify(draft) !== JSON.stringify(quest) ||
      featured !== Boolean(focused),
    [draft, featured, focused, quest],
  )

  function updateObjective(index, nextObjective) {
    setDraft((current) => ({
      ...current,
      objectives: current.objectives.map((objective, currentIndex) =>
        currentIndex === index ? nextObjective : objective,
      ),
    }))
  }

  return (
    <div className="quest-modal__editor">
      <div className="quest-modal__fields">
        <label className="quest-modal__field--wide">
          <span>Quest title</span>
          <input
            autoFocus
            value={draft.title}
            disabled={!canEditContent || busy}
            onChange={(event) => setDraft((current) => ({
              ...current,
              title: event.target.value,
            }))}
          />
        </label>

        <label>
          <span>Type</span>
          <select
            value={draft.mode}
            disabled={!canEditContent || busy}
            onChange={(event) => setDraft((current) => ({
              ...current,
              mode: event.target.value,
            }))}
          >
            <option value="rotating">Rotating</option>
            <option value="permanent">Permanent</option>
          </select>
        </label>

        <label>
          <span>Publication</span>
          <select
            value={draft.publication}
            disabled={!canPublish || busy}
            onChange={(event) => setDraft((current) => ({
              ...current,
              publication: event.target.value,
            }))}
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </label>

        <label className="quest-modal__field--wide">
          <span>Summary</span>
          <textarea
            rows="4"
            value={draft.summary || ''}
            disabled={!canEditContent || busy}
            onChange={(event) => setDraft((current) => ({
              ...current,
              summary: event.target.value,
            }))}
          />
        </label>
      </div>

      {canFeature ? (
        <label className="quest-modal__feature">
          <input
            type="checkbox"
            checked={featured}
            disabled={busy || draft.publication !== 'published'}
            onChange={(event) => setFeatured(event.target.checked)}
          />
          <span>
            <strong>Featured quest</strong>
            <small>Show this as Holdfast&apos;s focused public quest.</small>
          </span>
        </label>
      ) : null}

      <div className="quest-modal__objective-editor-list">
        <div className="quest-modal__subheading">
          <div>
            <span>Objectives</span>
            <small>{draft.objectives.length} total</small>
          </div>
          {canEditContent ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setDraft((current) => ({
                ...current,
                objectives: [...current.objectives, blankObjective()],
              }))}
            >
              + Add objective
            </button>
          ) : null}
        </div>

        {draft.objectives.map((objective, index) => (
          <ObjectiveEditor
            key={objective.id}
            objective={objective}
            index={index}
            limits={rewardLimits}
            locked={objective.completed || !canEditContent || busy}
            onChange={(nextObjective) => updateObjective(index, nextObjective)}
            onDelete={() => setDraft((current) => ({
              ...current,
              objectives: current.objectives.filter(
                (_, currentIndex) => currentIndex !== index,
              ),
            }))}
          />
        ))}
      </div>

      <footer className="quest-modal__editor-actions">
        <div className="quest-modal__save-state">
          {dirty ? 'Unsaved changes' : 'Up to date'}
        </div>

        {!isNew && canEditContent ? (
          confirmDelete ? (
            <div className="quest-modal__delete-confirm">
              <span>Delete this quest?</span>
              <button
                className="quest-modal__danger"
                type="button"
                disabled={busy}
                onClick={() => onDelete?.(quest)}
              >
                Delete permanently
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
              >
                Keep quest
              </button>
            </div>
          ) : (
            <button
              className="quest-modal__danger-link"
              type="button"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              Delete quest
            </button>
          )
        ) : null}

        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          className="quest-modal__primary"
          type="button"
          disabled={busy || !dirty || !draft.title.trim()}
          onClick={() => onSave?.(draft, { featured })}
        >
          {busy ? 'Saving…' : isNew ? 'Create quest' : 'Save quest'}
        </button>
      </footer>
    </div>
  )
}

function QuestModal({
  quest,
  session,
  rewardLimits,
  creatorName,
  focused = false,
  isNew = false,
  busy = false,
  message = '',
  onClose,
  onSave,
  onDelete,
  onApprove,
  onIssue,
  onSignup,
  onLeave,
}) {
  const canEdit =
    isNew
      ? session.hasPermission('quests.create')
      : questScopeAllows(session, 'quests.edit', quest)
  const canPublish = !isNew && questScopeAllows(session, 'quests.publish', quest)
  const [editing, setEditing] = useState(isNew)

  if (editing) {
    return (
      <Modal
        eyebrow={isNew ? 'New quest' : 'Quest management'}
        title={isNew ? 'Create a quest' : quest.title}
        intro={
          isNew
            ? 'Define the work. Rewards can be proposed here, but approval and payout stay separate.'
            : 'Edit only what your Holdfast authority allows.'
        }
        size="wide"
        align="left"
        onClose={busy ? undefined : onClose}
      >
        {message ? <p className="quest-modal__message">{message}</p> : null}
        <QuestEditForm
          quest={quest}
          session={session}
          rewardLimits={rewardLimits}
          focused={focused}
          isNew={isNew}
          busy={busy}
          onCancel={() => (isNew ? onClose?.() : setEditing(false))}
          onSave={onSave}
          onDelete={onDelete}
        />
      </Modal>
    )
  }

  return (
    <Modal
      eyebrow={
        quest.publication === 'published'
          ? focused
            ? 'Featured quest'
            : 'Guild quest'
          : `${quest.publication} quest`
      }
      title={quest.title}
      intro={quest.summary || 'No summary has been written for this quest yet.'}
      size="wide"
      align="left"
      onClose={busy ? undefined : onClose}
    >
      <div className="quest-modal">
        <div className="quest-modal__meta">
          <span>{quest.mode === 'permanent' ? 'Permanent' : 'Rotating'}</span>
          <span>{quest.publication}</span>
          {creatorName ? <span>Created by {creatorName}</span> : null}
          <span>
            {(quest.objectives || []).filter((objective) => objective.completed).length}
            /{(quest.objectives || []).length} complete
          </span>
        </div>

        {message ? <p className="quest-modal__message">{message}</p> : null}

        {(canEdit || canPublish) ? (
          <div className="quest-modal__manage-strip">
            <div>
              <strong>You have management authority here.</strong>
              <span>
                {canEdit
                  ? 'Edit quest content, objectives, and reward proposals.'
                  : 'You can manage publication for this quest.'}
              </span>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              Manage quest
            </button>
          </div>
        ) : null}

        <div className="quest-modal__objectives">
          {(quest.objectives || []).length ? (
            quest.objectives.map((objective, index) => (
              <ObjectiveView
                key={objective.id}
                quest={quest}
                objective={objective}
                index={index}
                session={session}
                busy={busy}
                onSignup={onSignup}
                onLeave={onLeave}
                onApprove={onApprove}
                onIssue={onIssue}
              />
            ))
          ) : (
            <div className="quest-modal__empty">
              No objectives have been added yet.
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default QuestModal
