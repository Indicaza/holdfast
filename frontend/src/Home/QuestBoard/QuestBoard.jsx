import { useEffect, useMemo, useState } from 'react'
import './QuestBoard.css'

const MAX_VISIBLE_ASSIGNMENTS = 8
const MAX_VISIBLE_REWARD_ITEMS = 3
const QUESTS_CHANGED_KEY = 'holdfast:quests-changed'
const EMPTY_CATALOG = { focusedQuestId: '', quests: [] }

function toRoman(value) {
  const numerals = [
    ['M', 1000], ['CM', 900], ['D', 500], ['CD', 400], ['C', 100], ['XC', 90],
    ['L', 50], ['XL', 40], ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1],
  ]
  let remaining = value
  let result = ''

  for (const [symbol, amount] of numerals) {
    while (remaining >= amount) {
      result += symbol
      remaining -= amount
    }
  }

  return result
}

function priorityOf(objective) {
  if (objective.priority) return objective.priority
  const value = String(objective.status || '').toLowerCase()
  if (value === 'critical' || value === 'current') return 'Main'
  if (value === 'high') return 'High'
  if (value === 'low') return 'Low'
  return 'Medium'
}

function questProgress(quest) {
  const completed =
    quest.completedObjectives ??
    quest.objectives.filter((objective) => objective.completed).length
  const total = quest.objectiveCount ?? quest.objectives.length
  return { completed, total }
}

function Assignment({ assignment }) {
  const isOpen = assignment.name === 'Open'

  return (
    <span
      className={`quest-board__assignee${isOpen ? ' quest-board__assignee--open' : ''}`}
      tabIndex="0"
      aria-label={`${assignment.name}: ${assignment.responsibility}. ${assignment.detail}`}
    >
      {assignment.avatar ? (
        <img
          className="quest-board__avatar quest-board__avatar--image"
          src={assignment.avatar}
          alt=""
          width="40"
          height="40"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className="quest-board__avatar" aria-hidden="true">
          {assignment.initials}
        </span>
      )}
      <span className="quest-board__tooltip" role="tooltip">
        <strong>{assignment.name}</strong>
        <span>{assignment.responsibility}</span>
        <small>{assignment.detail}</small>
      </span>
    </span>
  )
}

function Reward({ reward }) {
  const items = reward?.items ?? []
  const visibleItems = items.slice(0, MAX_VISIBLE_REWARD_ITEMS)
  const hiddenItemCount = Math.max(0, items.length - visibleItems.length)

  if (!reward || (!reward.rep && !reward.marks && !items.length)) {
    return null
  }

  return (
    <div className="quest-board__reward">
      <div className="quest-board__reward-values">
        {reward.rep > 0 ? <span><strong>{reward.rep}</strong> Rep</span> : null}
        {reward.marks > 0 ? <span><strong>{reward.marks}</strong> Marks</span> : null}
        {visibleItems.map((item) => (
          <span
            key={item.id || `${item.name}-${item.quantity}`}
            title={`${item.quantity}× ${item.name}`}
          >
            <strong>{item.quantity}×</strong> {item.name}
          </span>
        ))}
        {hiddenItemCount ? (
          <span
            className="quest-board__reward-overflow"
            title={items
              .slice(MAX_VISIBLE_REWARD_ITEMS)
              .map((item) => `${item.quantity}× ${item.name}`)
              .join(' · ')}
          >
            +{hiddenItemCount} more
          </span>
        ) : null}
      </div>
    </div>
  )
}

function QuestBoard() {
  const [catalog, setCatalog] = useState(EMPTY_CATALOG)

  useEffect(() => {
    let active = true

    function clearCatalog() {
      if (!active) return
      setCatalog(EMPTY_CATALOG)
    }

    function applyCatalog(nextCatalog) {
      if (!active) return
      setCatalog(nextCatalog?.quests ? nextCatalog : EMPTY_CATALOG)
    }

    function loadCatalog() {
      fetch('/api/quests', { cache: 'no-store' })
        .then((response) => {
          if (!response.ok) throw new Error('Quests unavailable')
          return response.json()
        })
        .then(applyCatalog)
        .catch(clearCatalog)
    }

    function handleStorage(event) {
      if (event.key === QUESTS_CHANGED_KEY) loadCatalog()
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') loadCatalog()
    }

    loadCatalog()
    window.addEventListener('focus', loadCatalog)
    window.addEventListener('storage', handleStorage)
    window.addEventListener(QUESTS_CHANGED_KEY, loadCatalog)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      active = false
      window.removeEventListener('focus', loadCatalog)
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(QUESTS_CHANGED_KEY, loadCatalog)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  const featuredQuest = useMemo(() => {
    if (!catalog.focusedQuestId) return null
    return (
      catalog.quests.find((quest) => quest.id === catalog.focusedQuestId) ?? null
    )
  }, [catalog])

  if (!featuredQuest) return null

  const { completed: completedObjectives, total: objectiveCount } =
    questProgress(featuredQuest)

  return (
    <section className="quest-board" aria-labelledby="quest-board-title">
      <header className="quest-board__header">
        <div className="quest-board__heading">
          <div className="quest-board__quest-line">
            <p className="quest-board__eyebrow">Featured quest</p>
            {featuredQuest.mode === 'permanent' ? (
              <span className="quest-board__permanent">Permanent</span>
            ) : null}
          </div>
          <h2 id="quest-board-title">{featuredQuest.title}</h2>
          {featuredQuest.summary ? (
            <p className="quest-board__summary">{featuredQuest.summary}</p>
          ) : null}
        </div>

        <div className="quest-board__header-meta">
          <div className="quest-board__progress">
            <span>Quest progress</span>
            <strong>{completedObjectives}/{objectiveCount}</strong>
            <small>objectives complete</small>
          </div>
          <a className="quest-board__all-link" href="/quests">
            View all quests
            <span aria-hidden="true">→</span>
          </a>
        </div>

        <div className="quest-board__insignia" aria-hidden="true">
          <span>♜</span>
        </div>
      </header>

      <div className="quest-board__columns" aria-hidden="true">
        <span />
        <span>Objective</span>
        <span>Priority</span>
        <span>Assigned</span>
        <span>Reward</span>
      </div>

      <div className="quest-board__objectives">
        {featuredQuest.objectives.map((objective, index) => {
          const priority = priorityOf(objective)
          const assignments = objective.assignments ?? []
          const visibleAssignments = assignments.slice(
            0,
            MAX_VISIBLE_ASSIGNMENTS,
          )
          const hiddenAssignmentCount = Math.max(
            0,
            assignments.length - visibleAssignments.length,
          )

          return (
            <article
              className={`quest-board__objective${
                objective.completed ? ' quest-board__objective--complete' : ''
              }`}
              key={objective.id || objective.title}
            >
              <div className="quest-board__objective-number" aria-hidden="true">
                {toRoman(index + 1)}
              </div>

              <div className="quest-board__objective-copy">
                <h3 title={objective.title}>{objective.title}</h3>
                {objective.description ? (
                  <p title={objective.description}>{objective.description}</p>
                ) : null}
                {objective.need ? (
                  <p className="quest-board__need" title={objective.need}>
                    <span>Need</span>
                    {objective.need}
                  </p>
                ) : null}
              </div>

              <div
                className="quest-board__objective-priority"
                aria-label={`Priority: ${priority}`}
              >
                <span
                  className={`quest-board__priority quest-board__priority--${priority.toLowerCase()}`}
                >
                  {priority}
                </span>
              </div>

              <div
                className="quest-board__coverage"
                aria-label={`${assignments.length} assigned member${
                  assignments.length === 1 ? '' : 's'
                }`}
              >
                <div className="quest-board__assignment-row">
                  {assignments.length ? (
                    <>
                      {visibleAssignments.map((assignment, assignmentIndex) => (
                        <Assignment
                          assignment={assignment}
                          key={`${objective.id || objective.title}-${
                            assignment.memberId || assignment.name
                          }-${assignmentIndex}`}
                        />
                      ))}
                      {hiddenAssignmentCount ? (
                        <span
                          className="quest-board__assignment-overflow"
                          title={assignments
                            .slice(MAX_VISIBLE_ASSIGNMENTS)
                            .map((assignment) => assignment.name)
                            .join(' · ')}
                        >
                          +{hiddenAssignmentCount}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>

              <Reward reward={objective.reward} />
            </article>
          )
        })}
      </div>

    </section>
  )
}

export default QuestBoard
