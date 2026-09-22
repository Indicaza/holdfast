import { useEffect, useMemo, useState } from 'react'
import PageShell from '../PageShell/PageShell.jsx'
import '../Home/QuestBoard/QuestBoard.css'
import './Quests.css'

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

function searchableValue(value) {
  return String(value ?? '').trim().toLowerCase()
}

function questSearchText(quest) {
  return [
    quest.title,
    quest.summary,
    quest.mode,
    quest.completed ? 'complete completed' : 'open active',
  ]
    .map(searchableValue)
    .filter(Boolean)
    .join(' ')
}

function objectiveSearchText(objective) {
  const reward = objective.reward ?? {}
  const assignments = objective.assignments ?? []
  const items = reward.items ?? []

  return [
    objective.title,
    objective.description,
    objective.need,
    priorityOf(objective),
    objective.completed ? 'complete completed' : 'open active',
    reward.rep ? `${reward.rep} rep reputation guild xp` : '',
    reward.marks ? `${reward.marks} marks service marks` : '',
    ...items.flatMap((item) => [item.name, item.quantity]),
    ...assignments.flatMap((assignment) => [
      assignment.name,
      assignment.responsibility,
      assignment.detail,
      assignment.memberId,
    ]),
  ]
    .map(searchableValue)
    .filter(Boolean)
    .join(' ')
}

function searchTerms(value) {
  return searchableValue(value).split(/\s+/).filter(Boolean)
}

function matchesTerms(text, terms) {
  return terms.every((term) => text.includes(term))
}

function availableReward(quest, currency) {
  return quest.objectives.reduce(
    (total, objective) =>
      objective.completed ? total : total + (Number(objective.reward?.[currency]) || 0),
    0,
  )
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

function QuestObjectives({ objectives }) {
  return (
    <>
      <div className="quest-board__columns" aria-hidden="true">
        <span />
        <span>Objective</span>
        <span>Priority</span>
        <span>Assigned</span>
        <span>Reward</span>
      </div>

      <div className="quest-board__objectives">
        {objectives.map((objective, index) => {
          const priority = priorityOf(objective)
          const assignments = objective.assignments ?? []
          const visibleAssignments = assignments.slice(0, MAX_VISIBLE_ASSIGNMENTS)
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
    </>
  )
}

function QuestCard({ quest, featured, visibleObjectives, searchActive }) {
  const { completed, total } = questProgress(quest)

  return (
    <details
      className={`quest-board quests-page__quest${featured ? ' quests-page__quest--featured' : ''}`}
      defaultOpen={featured}
      open={searchActive ? true : undefined}
    >
      <summary className="quest-board__header quests-page__quest-summary">
        <div className="quest-board__heading">
          <div className="quest-board__quest-line">
            <p className="quest-board__eyebrow">
              {featured ? 'Featured quest' : 'Guild quest'}
            </p>
            {quest.mode === 'permanent' ? (
              <span className="quest-board__permanent">Permanent</span>
            ) : null}
            {quest.completed ? (
              <span className="quests-page__complete-badge">Complete</span>
            ) : null}
          </div>
          <h2>{quest.title}</h2>
          {quest.summary ? (
            <p className="quest-board__summary">{quest.summary}</p>
          ) : null}
        </div>

        <div className="quests-page__summary-meta">
          <div className="quest-board__progress">
            <span>Progress</span>
            <strong>{completed}/{total}</strong>
            <small>objectives complete</small>
          </div>
          <span className="quests-page__toggle" aria-hidden="true">+</span>
        </div>
      </summary>

      {visibleObjectives.length ? (
        <QuestObjectives objectives={visibleObjectives} />
      ) : (
        <p className="quests-page__empty">No objectives have been added yet.</p>
      )}
    </details>
  )
}

function Quests() {
  const [catalog, setCatalog] = useState(EMPTY_CATALOG)
  const [status, setStatus] = useState('loading')
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortBy, setSortBy] = useState('featured')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput)
    }, 250)

    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    let active = true

    function loadQuests() {
      fetch('/api/quests', { cache: 'no-store' })
        .then((response) => {
          if (!response.ok) throw new Error('Quests unavailable')
          return response.json()
        })
        .then((result) => {
          if (!active) return
          setCatalog(result?.quests ? result : EMPTY_CATALOG)
          setStatus('ready')
        })
        .catch(() => {
          if (!active) return
          setCatalog(EMPTY_CATALOG)
          setStatus('error')
        })
    }

    function handleStorage(event) {
      if (event.key === QUESTS_CHANGED_KEY) loadQuests()
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') loadQuests()
    }

    loadQuests()
    window.addEventListener('focus', loadQuests)
    window.addEventListener('storage', handleStorage)
    window.addEventListener(QUESTS_CHANGED_KEY, loadQuests)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      active = false
      window.removeEventListener('focus', loadQuests)
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(QUESTS_CHANGED_KEY, loadQuests)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  const queryTerms = useMemo(() => searchTerms(debouncedSearch), [debouncedSearch])
  const searchActive = queryTerms.length > 0

  const questResults = useMemo(() => {
    const prepared = catalog.quests
      .map((quest, index) => {
        const questText = questSearchText(quest)
        const directMatch = !searchActive || matchesTerms(questText, queryTerms)
        const matchingObjectives = !searchActive
          ? quest.objectives
          : quest.objectives.filter((objective) =>
              matchesTerms(`${questText} ${objectiveSearchText(objective)}`, queryTerms),
            )

        if (searchActive && !directMatch && matchingObjectives.length === 0) {
          return null
        }

        return {
          quest,
          index,
          featured: quest.id === catalog.focusedQuestId,
          visibleObjectives: directMatch ? quest.objectives : matchingObjectives,
          repAvailable: availableReward(quest, 'rep'),
          marksAvailable: availableReward(quest, 'marks'),
        }
      })
      .filter(Boolean)

    return prepared.sort((left, right) => {
      if (sortBy === 'rep') {
        return (
          right.repAvailable - left.repAvailable ||
          Number(right.featured) - Number(left.featured) ||
          left.index - right.index
        )
      }

      if (sortBy === 'marks') {
        return (
          right.marksAvailable - left.marksAvailable ||
          Number(right.featured) - Number(left.featured) ||
          left.index - right.index
        )
      }

      return Number(right.featured) - Number(left.featured) || left.index - right.index
    })
  }, [catalog.focusedQuestId, catalog.quests, queryTerms, searchActive, sortBy])

  const completedObjectives = catalog.quests.reduce(
    (total, quest) => total + questProgress(quest).completed,
    0,
  )
  const totalObjectives = catalog.quests.reduce(
    (total, quest) => total + questProgress(quest).total,
    0,
  )
  const openObjectives = Math.max(0, totalObjectives - completedObjectives)
  function clearSearch() {
    setSearchInput('')
    setDebouncedSearch('')
  }

  return (
    <PageShell
      title="Quests"
      centered
      className="quests-page"
    >
      {status === 'loading' ? (
        <p className="quests-page__state">Opening the quest board…</p>
      ) : status === 'error' ? (
        <p className="quests-page__state quests-page__state--error">
          The quest board could not be loaded.
        </p>
      ) : catalog.quests.length ? (
        <>
          <section className="quests-page__tools" aria-label="Quest board tools">
            <div className="quests-page__search">
              <label htmlFor="quest-search">Search</label>
              <div className="quests-page__search-field">
                <input
                  id="quest-search"
                  type="search"
                  value={searchInput}
                  autoComplete="off"
                  placeholder="Quest, objective, member, item…"
                  onChange={(event) => setSearchInput(event.target.value)}
                />
                {searchInput ? (
                  <button type="button" onClick={clearSearch} aria-label="Clear quest search">
                    Clear
                  </button>
                ) : null}
              </div>
            </div>

            <label className="quests-page__sort">
              <span>Sort by</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                <option value="featured">Featured first</option>
                <option value="rep">Most Rep available</option>
                <option value="marks">Most Marks available</option>
              </select>
            </label>

            <p className="quests-page__board-meta" aria-live="polite">
              {searchActive ? (
                <>
                  Showing <strong>{questResults.length}</strong> of <strong>{catalog.quests.length}</strong>{' '}
                  {catalog.quests.length === 1 ? 'quest' : 'quests'}
                </>
              ) : (
                <>
                  <strong>{catalog.quests.length}</strong> {catalog.quests.length === 1 ? 'quest' : 'quests'} ·{' '}
                  <strong>{openObjectives}</strong> open · <strong>{completedObjectives}</strong> complete
                </>
              )}
            </p>
          </section>

          {questResults.length ? (
            <section className="quests-page__list" aria-label="Guild quests">
              {questResults.map(({ quest, featured, visibleObjectives }) => (
                <QuestCard
                  key={quest.id}
                  quest={quest}
                  featured={featured}
                  visibleObjectives={visibleObjectives}
                  searchActive={searchActive}
                />
              ))}
            </section>
          ) : (
            <section className="quests-page__empty-state quests-page__empty-state--search">
              <h2>No quests found.</h2>
              <p>Try a quest, objective, member, reward, item, or priority.</p>
              <button type="button" onClick={clearSearch}>Clear search</button>
            </section>
          )}
        </>
      ) : (
        <section className="quests-page__empty-state">
          <h2>The board is clear.</h2>
          <p>There is nothing the guild is asking for right now. Check back when a new quest goes up.</p>
        </section>
      )}
    </PageShell>
  )
}

export default Quests
