import { useEffect, useMemo, useState } from 'react'
import { useSession } from '../Auth/SessionProvider.jsx'
import './QuestEditor.css'

const PRIORITIES = ['Main', 'High', 'Medium', 'Low']
const PUBLICATION_OPTIONS = [
  ['draft', 'Draft'],
  ['published', 'Published'],
]
const QUEST_MODES = [
  ['rotating', 'Rotating'],
  ['permanent', 'Permanent'],
]
const DEFAULT_LIMITS = {
  rep: { min: 0, max: 1000 },
  marks: { min: 0, max: 1000 },
}
const QUESTS_CHANGED_KEY = 'holdfast:quests-changed'

function announceQuestsChanged() {
  try {
    localStorage.setItem(QUESTS_CHANGED_KEY, String(Date.now()))
  } catch {
    // Cross-tab refresh is best-effort; the API remains the source of truth.
  }

  window.dispatchEvent(new Event(QUESTS_CHANGED_KEY))
}

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`
}

const blankReward = () => ({ rep: 0, marks: 0, items: [] })

const blankRewardItem = () => ({
  id: createId('reward-item'),
  name: '',
  quantity: 1,
})

const blankAssignment = () => ({
  memberId: '',
  name: 'Open',
  responsibility: '',
  detail: '',
  initials: '+',
})

const blankObjective = () => ({
  id: createId('objective'),
  title: 'New objective',
  description: '',
  priority: 'Medium',
  completed: false,
  need: '',
  reward: blankReward(),
  assignments: [],
})

const blankQuest = () => ({
  id: createId('quest'),
  publication: 'draft',
  mode: 'rotating',
  title: 'New quest',
  summary: '',
  objectives: [blankObjective()],
  completed: false,
})

function moveItem(items, index, direction) {
  const target = index + direction
  if (target < 0 || target >= items.length) return items

  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

function questCompleted(quest) {
  return (
    quest.mode !== 'permanent' &&
    quest.objectives.length > 0 &&
    quest.objectives.every((objective) => objective.completed)
  )
}

function withDerivedCompletion(document) {
  return {
    ...document,
    quests: document.quests.map((quest) => ({
      ...quest,
      completed: questCompleted(quest),
    })),
  }
}

function ensureFocus(document) {
  const publishedQuests = document.quests.filter(
    (quest) => quest.publication === 'published',
  )
  const focused = publishedQuests.find(
    (quest) => quest.id === document.focusedQuestId,
  )

  if (focused) return document

  return {
    ...document,
    focusedQuestId: publishedQuests.length === 1 ? publishedQuests[0].id : '',
  }
}

function progress(count, total, singular) {
  return `${count}/${total} ${singular}${total === 1 ? '' : 's'}`
}

async function fetchGuildMembers() {
  const response = await fetch('/api/guild/members', {
    credentials: 'include',
    cache: 'no-store',
  })

  if (!response.ok) return []
  const result = await response.json()
  return result.members ?? []
}

function RewardFields({ value, limits, onChange }) {
  const fields = [
    ['rep', 'Guild XP / Rep', limits.rep],
    ['marks', 'Service Marks', limits.marks],
  ]
  const items = value.items ?? []

  function updateItem(index, nextItem) {
    onChange({
      ...value,
      items: items.map((item, currentIndex) =>
        currentIndex === index ? nextItem : item,
      ),
    })
  }

  function removeItem(index) {
    onChange({
      ...value,
      items: items.filter((_, currentIndex) => currentIndex !== index),
    })
  }

  return (
    <div className="quest-editor__reward-editor">
      <div className="quest-editor__reward-grid">
        {fields.map(([key, label, range]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              type="number"
              min="0"
              max={range.max}
              step="1"
              value={value[key]}
              onChange={(event) =>
                onChange({ ...value, [key]: Number(event.target.value) })
              }
            />
            <small>0 or {range.min}–{range.max}</small>
          </label>
        ))}
      </div>

      <div className="quest-editor__reward-items">
        <div className="quest-editor__fieldset-heading">
          <span>In-game items</span>
          <button
            className="quest-editor__secondary"
            type="button"
            onClick={() =>
              onChange({ ...value, items: [...items, blankRewardItem()] })
            }
          >
            + Add item
          </button>
        </div>

        {items.length ? (
          <div className="quest-editor__reward-item-list">
            {items.map((item, index) => (
              <div className="quest-editor__reward-item" key={item.id}>
                <label>
                  <span>Item</span>
                  <input
                    value={item.name}
                    placeholder="Item name"
                    onChange={(event) =>
                      updateItem(index, { ...item, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Qty</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={item.quantity}
                    onChange={(event) =>
                      updateItem(index, {
                        ...item,
                        quantity: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <ActionButton tone="danger" onClick={() => removeItem(index)}>
                  Remove
                </ActionButton>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ConfirmDialog({ confirmation, onCancel, onConfirm }) {
  if (!confirmation) return null

  return (
    <div
      className="quest-editor__confirm-backdrop"
      role="presentation"
      onMouseDown={onCancel}
    >
      <div
        className="quest-editor__confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="quest-confirm-title"
        aria-describedby="quest-confirm-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="quest-editor__kicker">{confirmation.kicker}</p>
        <h2 id="quest-confirm-title">{confirmation.title}</h2>
        <p id="quest-confirm-description">{confirmation.message}</p>
        <div className="quest-editor__confirm-actions">
          <button
            className="quest-editor__secondary"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className={
              confirmation.danger
                ? 'quest-editor__danger-action'
                : 'quest-editor__primary'
            }
            type="button"
            onClick={onConfirm}
          >
            {confirmation.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function OrderActions({ index, length, label, onMove }) {
  return (
    <div className="quest-editor__order-actions" aria-label={`${label} order`}>
      <button
        type="button"
        aria-label={`Move ${label} up`}
        disabled={index === 0}
        onClick={() => onMove(index, -1)}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label={`Move ${label} down`}
        disabled={index === length - 1}
        onClick={() => onMove(index, 1)}
      >
        ↓
      </button>
    </div>
  )
}

function ActionButton({ tone = 'normal', children, ...props }) {
  return (
    <button
      className={`quest-editor__action-button quest-editor__action-button--${tone}`}
      type="button"
      {...props}
    >
      {children}
    </button>
  )
}

function assignmentFromMember(member) {
  if (!member) return blankAssignment()

  return {
    memberId: member.id,
    name: member.displayName,
    responsibility: '',
    detail: '',
    initials: member.initials || '?',
    ...(member.avatarUrl ? { avatar: member.avatarUrl } : {}),
  }
}

function AssignmentEditor({
  assignment,
  members,
  assignedMemberIds,
  onChange,
  onRemove,
}) {
  const legacyValue =
    !assignment.memberId && assignment.name && assignment.name !== 'Open'
      ? `legacy:${assignment.name}`
      : ''
  const selectValue = assignment.memberId || legacyValue

  function changeMember(event) {
    const memberId = event.target.value

    if (!memberId) {
      onChange({
        ...blankAssignment(),
        responsibility: assignment.responsibility,
        detail: assignment.detail,
      })
      return
    }

    if (memberId.startsWith('legacy:')) return
    if (
      assignedMemberIds.has(memberId) &&
      memberId !== assignment.memberId
    ) {
      return
    }

    const member = members.find((item) => item.id === memberId)
    if (!member) return

    onChange({
      ...assignmentFromMember(member),
      responsibility: assignment.responsibility,
      detail: assignment.detail,
    })
  }

  return (
    <div className="quest-editor__assignment">
      <div className="quest-editor__grid quest-editor__grid--assignment">
        <label>
          <span>Guild member</span>
          <select value={selectValue} onChange={changeMember}>
            <option value="">Open / unassigned</option>
            {legacyValue ? (
              <option value={legacyValue}>{assignment.name} (legacy)</option>
            ) : null}
            {members.map((member) => {
              const alreadyAssigned =
                assignedMemberIds.has(member.id) &&
                member.id !== assignment.memberId

              return (
                <option
                  key={member.id}
                  value={member.id}
                  disabled={alreadyAssigned}
                >
                  {member.displayName} · @{member.username}
                  {alreadyAssigned ? ' · already assigned' : ''}
                </option>
              )
            })}
          </select>
        </label>

        <label>
          <span>Responsibility</span>
          <input
            value={assignment.responsibility}
            onChange={(event) =>
              onChange({ ...assignment, responsibility: event.target.value })
            }
          />
        </label>

        <label>
          <span>Detail</span>
          <input
            value={assignment.detail}
            onChange={(event) =>
              onChange({ ...assignment, detail: event.target.value })
            }
          />
        </label>
      </div>

      <ActionButton tone="danger" onClick={onRemove}>
        Remove assignment
      </ActionButton>
    </div>
  )
}

function ObjectiveEditor({
  objective,
  index,
  count,
  members,
  rewardLimits,
  canComplete,
  onChange,
  onMove,
  onDelete,
  onComplete,
}) {
  const assignedMemberIds = new Set(
    objective.assignments.map((assignment) => assignment.memberId).filter(Boolean),
  )
  const assignedCount = assignedMemberIds.size
  const hasReward =
    objective.reward.rep > 0 ||
    objective.reward.marks > 0 ||
    objective.reward.items.length > 0
  const completionReady = canComplete && (!hasReward || assignedCount > 0)

  function updateAssignment(assignmentIndex, nextAssignment) {
    onChange({
      ...objective,
      assignments: objective.assignments.map((assignment, currentIndex) =>
        currentIndex === assignmentIndex ? nextAssignment : assignment,
      ),
    })
  }

  function removeAssignment(assignmentIndex) {
    onChange({
      ...objective,
      assignments: objective.assignments.filter(
        (_, currentIndex) => currentIndex !== assignmentIndex,
      ),
    })
  }

  return (
    <details className="quest-editor__objective">
      <summary>
        <div className="quest-editor__summary-copy">
          <span>Objective {index + 1}</span>
          <strong>{objective.title || 'Untitled objective'}</strong>
        </div>
        <div className="quest-editor__summary-badges">
          <span
            className={`quest-editor__priority quest-editor__priority--${objective.priority.toLowerCase()}`}
          >
            {objective.priority}
          </span>
          {objective.completed ? (
            <span className="quest-editor__badge--complete">Complete</span>
          ) : null}
          <span className="quest-editor__toggle" aria-hidden="true">+</span>
        </div>
      </summary>

      <div className="quest-editor__entity-body">
        <div className="quest-editor__entity-actions">
          <OrderActions
            index={index}
            length={count}
            label="objective"
            onMove={onMove}
          />
          <ActionButton
            tone="danger"
            disabled={objective.completed}
            onClick={onDelete}
          >
            Delete objective
          </ActionButton>
        </div>

        <div
          className={`quest-editor__completion-row${
            objective.completed ? ' quest-editor__completion-row--complete' : ''
          }`}
        >
          <div>
            <strong>{objective.completed ? 'Reward issued' : 'Ready to close?'}</strong>
            <small>
              {objective.completed
                ? 'This objective is locked because its contribution reward has been recorded.'
                : !canComplete
                  ? 'Publish this quest before completing objectives.'
                  : hasReward && assignedCount === 0
                    ? 'Assign at least one guild member before issuing this reward.'
                    : 'Completing saves current changes and permanently awards each assigned member.'}
            </small>
          </div>
          {!objective.completed ? (
            <ActionButton
              tone="complete"
              disabled={!completionReady}
              onClick={onComplete}
            >
              Complete & award
            </ActionButton>
          ) : null}
        </div>

        <fieldset
          className="quest-editor__objective-fields"
          disabled={objective.completed}
        >
          <div className="quest-editor__grid">
            <label className="quest-editor__field--wide">
              <span>Title</span>
              <input
                value={objective.title}
                onChange={(event) =>
                  onChange({ ...objective, title: event.target.value })
                }
              />
            </label>

            <label>
              <span>Priority</span>
              <select
                className={`quest-editor__priority-select quest-editor__priority-select--${objective.priority.toLowerCase()}`}
                value={objective.priority}
                onChange={(event) =>
                  onChange({ ...objective, priority: event.target.value })
                }
              >
                {PRIORITIES.map((priority) => (
                  <option key={priority}>{priority}</option>
                ))}
              </select>
            </label>

            <label className="quest-editor__field--wide">
              <span>Description</span>
              <textarea
                rows="3"
                value={objective.description}
                onChange={(event) =>
                  onChange({ ...objective, description: event.target.value })
                }
              />
            </label>

            <label className="quest-editor__field--wide">
              <span>Need</span>
              <input
                value={objective.need}
                onChange={(event) =>
                  onChange({ ...objective, need: event.target.value })
                }
              />
            </label>
          </div>

          <fieldset className="quest-editor__fieldset">
            <legend>Reward</legend>
            <RewardFields
              value={objective.reward}
              limits={rewardLimits}
              onChange={(reward) => onChange({ ...objective, reward })}
            />
          </fieldset>

          <fieldset className="quest-editor__fieldset">
            <legend>Assignments</legend>
            <div className="quest-editor__fieldset-heading">
              <div>
                <span>Coverage</span>
                <small>Members appear after their first Holdfast sign-in.</small>
              </div>
              <button
                className="quest-editor__secondary"
                type="button"
                onClick={() =>
                  onChange({
                    ...objective,
                    assignments: [...objective.assignments, blankAssignment()],
                  })
                }
              >
                + Add assignment
              </button>
            </div>

            {objective.assignments.length ? (
              <div className="quest-editor__stack">
                {objective.assignments.map((assignment, assignmentIndex) => (
                  <AssignmentEditor
                    key={`${objective.id}-assignment-${assignmentIndex}`}
                    assignment={assignment}
                    members={members}
                    assignedMemberIds={assignedMemberIds}
                    onChange={(nextAssignment) =>
                      updateAssignment(assignmentIndex, nextAssignment)
                    }
                    onRemove={() => removeAssignment(assignmentIndex)}
                  />
                ))}
              </div>
            ) : null}
          </fieldset>
        </fieldset>
      </div>
    </details>
  )
}

function EconomySettings({ document, canEdit, onChange }) {
  function updateLimit(currency, key, value) {
    onChange({
      ...document,
      rewardLimits: {
        ...document.rewardLimits,
        [currency]: {
          ...document.rewardLimits[currency],
          [key]: Number(value),
        },
      },
    })
  }

  return (
    <details className="quest-editor__panel quest-editor__economy-panel">
      <summary className="quest-editor__economy-summary">
        <div>
          <span className="quest-editor__kicker">Guild economy</span>
          <strong>Reward guardrails</strong>
        </div>
        <span>
          Rep {document.rewardLimits.rep.min}–{document.rewardLimits.rep.max}
          {' · '}
          Marks {document.rewardLimits.marks.min}–{document.rewardLimits.marks.max}
        </span>
      </summary>

      <div className="quest-editor__economy-body">
        {!canEdit ? (
          <>
            <p>{document.rewardPolicy || 'No guild reward policy set.'}</p>
            <small>Only authorized reward-policy editors can change these rules.</small>
          </>
        ) : (
          <>
            <label>
              <span>Policy</span>
              <textarea
                rows="3"
                value={document.rewardPolicy}
                onChange={(event) =>
                  onChange({ ...document, rewardPolicy: event.target.value })
                }
              />
            </label>

            <div className="quest-editor__economy-grid">
              {[
                ['rep', 'Guild XP / Rep'],
                ['marks', 'Service Marks'],
              ].map(([currency, label]) => (
                <div key={currency} className="quest-editor__economy-range">
                  <strong>{label}</strong>
                  <label>
                    <span>Minimum</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={document.rewardLimits[currency].min}
                      onChange={(event) =>
                        updateLimit(currency, 'min', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Maximum</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={document.rewardLimits[currency].max}
                      onChange={(event) =>
                        updateLimit(currency, 'max', event.target.value)
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </details>
  )
}

function QuestCard({
  quest,
  index,
  count,
  members,
  rewardLimits,
  focused,
  onChange,
  onPublicationChange,
  onMove,
  onArchive,
  onRestore,
  onDelete,
  onConfirm,
  onCompleteObjective,
}) {
  const completedCount = quest.objectives.filter(
    (objective) => objective.completed,
  ).length

  function updateObjective(objectiveIndex, nextObjective) {
    onChange({
      ...quest,
      objectives: quest.objectives.map((objective, currentIndex) =>
        currentIndex === objectiveIndex ? nextObjective : objective,
      ),
    })
  }

  function confirmDeleteObjective(objective) {
    onConfirm({
      kicker: 'Delete objective',
      title: `Delete “${objective.title}”?`,
      message:
        'This removes the objective, its assignments, progress, and reward after you save.',
      confirmLabel: 'Delete objective',
      danger: true,
      action: () =>
        onChange({
          ...quest,
          objectives: quest.objectives.filter(
            (item) => item.id !== objective.id,
          ),
        }),
    })
  }

  function confirmCompleteObjective(objective) {
    const assignees = new Set(
      objective.assignments
        .map((assignment) => assignment.memberId)
        .filter(Boolean),
    )
    const rewards = []
    if (objective.reward.rep > 0) rewards.push(`${objective.reward.rep} Rep`)
    if (objective.reward.marks > 0) rewards.push(`${objective.reward.marks} Marks`)
    if (objective.reward.items.length) {
      rewards.push(
        `${objective.reward.items.length} item reward${
          objective.reward.items.length === 1 ? '' : 's'
        }`,
      )
    }

    onConfirm({
      kicker: 'Complete objective',
      title: `Complete “${objective.title}”?`,
      message: `This saves current changes and awards ${
        rewards.length ? rewards.join(', ') : 'no currency reward'
      } to each of ${assignees.size} assigned member${
        assignees.size === 1 ? '' : 's'
      }. The payout is permanent and cannot be issued twice.`,
      confirmLabel: 'Complete and award',
      action: () => onCompleteObjective(quest.id, objective.id),
    })
  }

  return (
    <details className="quest-editor__quest" defaultOpen={focused}>
      <summary>
        <div className="quest-editor__summary-copy">
          <div className="quest-editor__summary-badges">
            <span>{quest.publication}</span>
            {quest.mode === 'permanent' ? <span>Permanent</span> : null}
            {focused ? (
              <span className="quest-editor__badge--focus">Featured</span>
            ) : null}
            {questCompleted(quest) ? (
              <span className="quest-editor__badge--complete">Complete</span>
            ) : null}
          </div>
          <strong>{quest.title || 'Untitled quest'}</strong>
          <small>
            {progress(completedCount, quest.objectives.length, 'objective')} complete
          </small>
        </div>
        <span className="quest-editor__toggle" aria-hidden="true">+</span>
      </summary>

      <div className="quest-editor__quest-body">
        <div className="quest-editor__entity-actions">
          <OrderActions
            index={index}
            length={count}
            label="quest"
            onMove={onMove}
          />
          <div className="quest-editor__lifecycle-actions">
            {quest.publication !== 'archived' ? (
              <ActionButton tone="archive" onClick={onArchive}>
                Archive
              </ActionButton>
            ) : (
              <ActionButton tone="restore" onClick={onRestore}>
                Restore to draft
              </ActionButton>
            )}
            <ActionButton tone="danger" onClick={onDelete}>
              Delete
            </ActionButton>
          </div>
        </div>

        <div className="quest-editor__grid">
          <label className="quest-editor__field--wide">
            <span>Quest title</span>
            <input
              value={quest.title}
              onChange={(event) =>
                onChange({ ...quest, title: event.target.value })
              }
            />
          </label>

          <label>
            <span>Publication</span>
            <select
              value={
                quest.publication === 'archived' ? 'draft' : quest.publication
              }
              disabled={quest.publication === 'archived'}
              onChange={(event) => onPublicationChange(event.target.value)}
            >
              {PUBLICATION_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Quest type</span>
            <select
              value={quest.mode}
              onChange={(event) =>
                onChange({ ...quest, mode: event.target.value })
              }
            >
              {QUEST_MODES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label className="quest-editor__field--wide">
            <span>Summary</span>
            <textarea
              rows="3"
              value={quest.summary}
              onChange={(event) =>
                onChange({ ...quest, summary: event.target.value })
              }
            />
          </label>
        </div>

        <div className="quest-editor__subsection-heading">
          <h3>Objectives</h3>
          <button
            className="quest-editor__secondary"
            type="button"
            onClick={() =>
              onChange({
                ...quest,
                objectives: [...quest.objectives, blankObjective()],
              })
            }
          >
            + Add objective
          </button>
        </div>

        <div className="quest-editor__objectives">
          {quest.objectives.length ? (
            quest.objectives.map((objective, objectiveIndex) => (
              <ObjectiveEditor
                key={objective.id}
                objective={objective}
                index={objectiveIndex}
                count={quest.objectives.length}
                members={members}
                rewardLimits={rewardLimits}
                canComplete={quest.publication === 'published'}
                onChange={(nextObjective) =>
                  updateObjective(objectiveIndex, nextObjective)
                }
                onMove={(itemIndex, direction) =>
                  onChange({
                    ...quest,
                    objectives: moveItem(
                      quest.objectives,
                      itemIndex,
                      direction,
                    ),
                  })
                }
                onDelete={() => confirmDeleteObjective(objective)}
                onComplete={() => confirmCompleteObjective(objective)}
              />
            ))
          ) : (
            <p className="quest-editor__empty quest-editor__empty--padded">
              No objectives yet. Add one when this quest has work to assign.
            </p>
          )}
        </div>
      </div>
    </details>
  )
}

function QuestEditor() {
  const session = useSession()
  const canEditRewardPolicy = session.hasPermission('rewards.policy.edit')
  const [draft, setDraft] = useState(null)
  const [saved, setSaved] = useState(null)
  const [members, setMembers] = useState([])
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('Loading quests…')
  const [confirmation, setConfirmation] = useState(null)

  useEffect(() => {
    let active = true

    Promise.all([
      fetch('/api/quests/manage', {
        credentials: 'include',
        cache: 'no-store',
      }).then(async (response) => {
        if (!response.ok) throw new Error('Quests could not be loaded.')
        return response.json()
      }),
      fetchGuildMembers(),
    ])
      .then(([document, guildMembers]) => {
        if (!active) return
        setDraft(document)
        setSaved(document)
        setMembers(guildMembers)
        setStatus('ready')
        setMessage('Quests loaded.')
      })
      .catch((error) => {
        if (!active) return
        setStatus('error')
        setMessage(error.message)
      })

    return () => {
      active = false
    }
  }, [])

  const dirty = useMemo(() => {
    if (!draft || !saved) return false
    return JSON.stringify(draft) !== JSON.stringify(saved)
  }, [draft, saved])

  useEffect(() => {
    if (!dirty) return undefined

    function warnBeforeLeave(event) {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', warnBeforeLeave)
    return () => window.removeEventListener('beforeunload', warnBeforeLeave)
  }, [dirty])

  function setDocument(updater) {
    setDraft((current) =>
      ensureFocus(
        withDerivedCompletion(
          typeof updater === 'function' ? updater(current) : updater,
        ),
      ),
    )
  }

  function updateQuest(id, nextQuest) {
    setDocument((current) => ({
      ...current,
      quests: current.quests.map((quest) =>
        quest.id === id ? nextQuest : quest,
      ),
    }))
  }

  function changeQuestPublication(id, publication) {
    setDocument((current) => {
      const next = {
        ...current,
        quests: current.quests.map((quest) =>
          quest.id === id ? { ...quest, publication } : quest,
        ),
      }

      const hasFeaturedQuest = next.quests.some(
        (quest) =>
          quest.id === next.focusedQuestId &&
          quest.publication === 'published',
      )

      if (publication === 'published' && !hasFeaturedQuest) {
        next.focusedQuestId = id
      }

      return next
    })

    setStatus('ready')
    setMessage(
      publication === 'published'
        ? 'Quest published. It will become featured if nothing else is featured.'
        : 'Quest moved to draft. Save changes to make it live.',
    )
  }

  function moveQuest(id, direction) {
    setDocument((current) => {
      const source = current.quests.find((quest) => quest.id === id)
      if (!source) return current

      const sourceArchived = source.publication === 'archived'
      const peers = current.quests.filter(
        (quest) => (quest.publication === 'archived') === sourceArchived,
      )
      const peerIndex = peers.findIndex((quest) => quest.id === id)
      const moved = moveItem(peers, peerIndex, direction)
      if (moved === peers) return current

      let cursor = 0
      return {
        ...current,
        quests: current.quests.map((quest) =>
          (quest.publication === 'archived') === sourceArchived
            ? moved[cursor++]
            : quest,
        ),
      }
    })
  }

  function requestArchiveQuest(quest) {
    setConfirmation({
      kicker: 'Archive quest',
      title: `Put “${quest.title}” on hold?`,
      message:
        'It will disappear from the public site, but its objectives, assignments, progress, and rewards are preserved.',
      confirmLabel: 'Archive quest',
      action: () =>
        updateQuest(quest.id, { ...quest, publication: 'archived' }),
    })
  }

  function requestDeleteQuest(quest) {
    setConfirmation({
      kicker: 'Permanent deletion',
      title: `Delete “${quest.title}”?`,
      message:
        'This removes the quest and every objective, assignment, and reward inside it after you save.',
      confirmLabel: 'Delete permanently',
      danger: true,
      action: () => {
        setDocument((current) => ({
          ...current,
          quests: current.quests.filter((item) => item.id !== quest.id),
        }))
        setStatus('ready')
        setMessage('Quest deleted from the draft. Save changes to make it live.')
      },
    })
  }

  function confirmAction() {
    const action = confirmation?.action
    setConfirmation(null)
    action?.()
  }

  async function completeObjective(questId, objectiveId) {
    setStatus('saving')
    setMessage('Completing objective and issuing rewards…')

    try {
      const response = await fetch('/api/quests/manage/complete-objective', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document: draft,
          questId,
          objectiveId,
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.message || 'Objective could not be completed.')
      }

      setDraft(result.document)
      setSaved(result.document)
      setMembers(await fetchGuildMembers())
      setStatus('ready')

      const rep = result.awards.reduce(
        (total, award) => total + (Number(award.rep) || 0),
        0,
      )
      const marks = result.awards.reduce(
        (total, award) => total + (Number(award.marks) || 0),
        0,
      )
      const people = result.awards.length
      setMessage(
        `Objective complete. Issued ${rep} Rep and ${marks} Marks across ${people} member${
          people === 1 ? '' : 's'
        }.`,
      )
      announceQuestsChanged()
    } catch (error) {
      setStatus('error')
      setMessage(error.message)
    }
  }

  function reset() {
    setDraft(saved)
    setStatus('ready')
    setMessage('Changes discarded.')
  }

  async function save(event) {
    event.preventDefault()
    setStatus('saving')
    setMessage('Saving…')

    try {
      const response = await fetch('/api/quests/manage', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.message || 'Quests could not be saved.')
      }

      setDraft(result)
      setSaved(result)
      setStatus('ready')
      setMessage(
        result.quests.length === 0
          ? 'Saved. There are no quests.'
          : result.focusedQuestId
            ? 'Saved. Featured quest is live.'
            : 'Saved. No quest is currently featured.',
      )
      announceQuestsChanged()
    } catch (error) {
      setStatus('error')
      setMessage(error.message)
    }
  }

  if (status === 'loading') {
    return <p className="quest-editor__state">{message}</p>
  }

  if (!draft) {
    return (
      <p className="quest-editor__state quest-editor__state--error">
        {message}
      </p>
    )
  }

  const availableQuests = draft.quests.filter(
    (quest) => quest.publication !== 'archived',
  )
  const publishedQuests = draft.quests.filter(
    (quest) => quest.publication === 'published',
  )
  const archivedQuests = draft.quests.filter(
    (quest) => quest.publication === 'archived',
  )
  const currentMember = members.find((member) => member.id === session.user?.id)

  return (
    <form className="quest-editor" onSubmit={save}>
      <div className="quest-editor__toolbar">
        <div>
          <p
            className={`quest-editor__status${
              status === 'error' ? ' quest-editor__status--error' : ''
            }`}
            aria-live="polite"
          >
            {status === 'error'
              ? message
              : dirty && status !== 'saving'
                ? `${message === 'Quests loaded.' ? '' : `${message} `}Unsaved changes are not live.`
                : message}
          </p>
          {currentMember ? (
            <p className="quest-editor__balance">
              <strong>{currentMember.contribution?.rep ?? 0}</strong> Rep
              <span>·</span>
              <strong>{currentMember.contribution?.marks ?? 0}</strong> Marks
            </p>
          ) : null}
        </div>
        <div className="quest-editor__toolbar-actions">
          <button
            className="quest-editor__secondary"
            type="button"
            disabled={!dirty || status === 'saving'}
            onClick={reset}
          >
            Reset
          </button>
          <button
            className="quest-editor__primary"
            type="submit"
            disabled={!dirty || status === 'saving'}
          >
            {status === 'saving' ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      <section className="quest-editor__panel quest-editor__focus-control">
        <div>
          <p className="quest-editor__kicker">Home page</p>
          <h2>Featured quest</h2>
          <p>
            Publishing makes a quest public. If nothing is featured yet, the
            published quest takes the featured slot automatically.
          </p>
        </div>
        <label>
          <span>Featured quest</span>
          <select
            value={draft.focusedQuestId}
            onChange={(event) =>
              setDocument((current) => ({
                ...current,
                focusedQuestId: event.target.value,
              }))
            }
          >
            <option value="">
              {publishedQuests.length
                ? 'No featured quest'
                : 'No published quests'}
            </option>
            {publishedQuests.map((quest) => (
              <option key={quest.id} value={quest.id}>
                {quest.title}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="quest-editor__panel">
        <div className="quest-editor__section-heading">
          <div>
            <p className="quest-editor__kicker">Guild work</p>
            <h2>Quests</h2>
          </div>
          <button
            className="quest-editor__secondary"
            type="button"
            onClick={() =>
              setDocument((current) => ({
                ...current,
                quests: [...current.quests, blankQuest()],
              }))
            }
          >
            + Add quest
          </button>
        </div>

        <div className="quest-editor__quests">
          {availableQuests.length ? (
            availableQuests.map((quest, index) => (
              <QuestCard
                key={quest.id}
                quest={quest}
                index={index}
                count={availableQuests.length}
                members={members}
                rewardLimits={draft.rewardLimits}
                focused={quest.id === draft.focusedQuestId}
                onChange={(nextQuest) => updateQuest(quest.id, nextQuest)}
                onPublicationChange={(publication) =>
                  changeQuestPublication(quest.id, publication)
                }
                onMove={(_, direction) => moveQuest(quest.id, direction)}
                onArchive={() => requestArchiveQuest(quest)}
                onRestore={() =>
                  updateQuest(quest.id, { ...quest, publication: 'draft' })
                }
                onDelete={() => requestDeleteQuest(quest)}
                onConfirm={setConfirmation}
                onCompleteObjective={completeObjective}
              />
            ))
          ) : (
            <p className="quest-editor__empty quest-editor__empty--padded">
              {archivedQuests.length
                ? 'No active quests. Add one or restore an archived quest.'
                : 'No quests yet. Add one when you are ready.'}
            </p>
          )}
        </div>
      </section>

      {archivedQuests.length ? (
        <section className="quest-editor__panel quest-editor__archived-section">
          <details>
            <summary>
              <span>Archived quests</span>
              <strong>{archivedQuests.length}</strong>
            </summary>
            <div className="quest-editor__quests">
              {archivedQuests.map((quest, index) => (
                <QuestCard
                  key={quest.id}
                  quest={quest}
                  index={index}
                  count={archivedQuests.length}
                  members={members}
                  rewardLimits={draft.rewardLimits}
                  focused={false}
                  onChange={(nextQuest) => updateQuest(quest.id, nextQuest)}
                  onPublicationChange={(publication) =>
                    changeQuestPublication(quest.id, publication)
                  }
                  onMove={(_, direction) => moveQuest(quest.id, direction)}
                  onArchive={() => requestArchiveQuest(quest)}
                  onRestore={() =>
                    updateQuest(quest.id, { ...quest, publication: 'draft' })
                  }
                  onDelete={() => requestDeleteQuest(quest)}
                  onConfirm={setConfirmation}
                  onCompleteObjective={completeObjective}
                />
              ))}
            </div>
          </details>
        </section>
      ) : null}

      <EconomySettings
        document={draft}
        canEdit={canEditRewardPolicy}
        onChange={setDocument}
      />

      <div className="quest-editor__bottom-save">
        <span>{dirty ? 'Changes are not live yet.' : 'Everything is saved.'}</span>
        <button
          className="quest-editor__primary"
          type="submit"
          disabled={!dirty || status === 'saving'}
        >
          {status === 'saving' ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      <ConfirmDialog
        confirmation={confirmation}
        onCancel={() => setConfirmation(null)}
        onConfirm={confirmAction}
      />
    </form>
  )
}

export default QuestEditor
