import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiJson } from '../Api/apiClient.js'
import { runAuthenticatedMutation } from '../Auth/authenticatedMutation.js'
import { useSession } from '../Auth/sessionContext.js'
import Home from '../Home/Home.jsx'
import MemberAccessModal from '../Members/MemberAccessModal.jsx'
import PageShell from '../PageShell/PageShell.jsx'
import QuestEconomyModal from './QuestEconomyModal.jsx'
import QuestJsonImportModal from './QuestJsonImportModal.jsx'
import QuestModal from './QuestModal.jsx'
import { useQuestSignup } from './QuestSignupFlow.jsx'
import {
  blankQuest,
  canManageAnyQuest,
  rewardApprovalStatus,
  withSelfAssignments,
} from './questAuthority.js'
import './Quests.css'

const QUESTS_CHANGED_KEY = 'holdfast:quests-changed'
const EMPTY_CATALOG = { focusedQuestId: '', quests: [] }

function searchableValue(value) {
  return String(value ?? '').trim().toLowerCase()
}

function searchTerms(value) {
  return searchableValue(value).split(/\s+/).filter(Boolean)
}

function questProgress(quest) {
  const objectives = quest.objectives || []
  const completed =
    quest.completedObjectives ??
    objectives.filter((objective) => objective.completed).length
  const total = quest.objectiveCount ?? objectives.length
  return { completed, total }
}

function questRewardTotals(quest) {
  return (quest.objectives || []).reduce(
    (totals, objective) => {
      if (objective.completed) return totals

      const approval = rewardApprovalStatus(objective)

      if (approval === 'pending') {
        totals.pending += 1
      }

      totals.rep += Number(objective.reward?.rep) || 0
      totals.marks += Number(objective.reward?.marks) || 0
      return totals
    },
    { rep: 0, marks: 0, pending: 0 },
  )
}

function questSearchText(quest) {
  return [
    quest.title,
    quest.summary,
    quest.mode,
    quest.publication,
    quest.createdByMemberId,
    ...(quest.objectives || []).flatMap((objective) => [
      objective.title,
      objective.description,
      objective.need,
      objective.priority,
      objective.reward?.rep,
      objective.reward?.marks,
      ...(objective.reward?.items || []).map((item) => item.name),
      ...(objective.assignments || []).map((assignment) => assignment.name),
    ]),
  ]
    .map(searchableValue)
    .filter(Boolean)
    .join(' ')
}

function QuestCard({ quest, featured, creatorName, onOpen }) {
  const { completed, total } = questProgress(quest)
  const rewards = questRewardTotals(quest)
  const publication = quest.publication || 'published'

  return (
    <button
      className={`quests-page__card${
        featured ? ' quests-page__card--featured' : ''
      }`}
      type="button"
      onClick={onOpen}
    >
      <div className="quests-page__card-topline">
        <div className="quests-page__card-badges">
          {featured ? <span className="quests-page__badge--featured">Featured</span> : null}
          <span className={`quests-page__badge--${publication}`}>
            {publication}
          </span>
          {quest.mode === 'permanent' ? <span>Permanent</span> : null}
        </div>
        <span className="quests-page__card-open">Open ↗</span>
      </div>

      <div className="quests-page__card-copy">
        <h2>{quest.title}</h2>
        <p>{quest.summary || 'No summary yet.'}</p>
      </div>

      <div className="quests-page__card-meta">
        <span>
          <strong>{completed}/{total}</strong>
          objectives
        </span>
        {rewards.rep > 0 ? (
          <span>
            <strong>{rewards.rep}</strong>
            Rep
          </span>
        ) : null}
        {rewards.marks > 0 ? (
          <span>
            <strong>{rewards.marks}</strong>
            Marks
          </span>
        ) : null}
        {rewards.pending > 0 ? (
          <span className="quests-page__pending">
            <strong>{rewards.pending}</strong>
            pending approval
          </span>
        ) : null}
      </div>

      {creatorName ? (
        <footer className="quests-page__card-footer">
          Created by {creatorName}
        </footer>
      ) : null}
    </button>
  )
}

function Quests() {
  const session = useSession()
  const initialSearch =
    new URLSearchParams(window.location.search).get('q') || ''
  const [catalog, setCatalog] = useState(EMPTY_CATALOG)
  const [workspace, setWorkspace] = useState(null)
  const [members, setMembers] = useState([])
  const [status, setStatus] = useState('loading')
  const [searchInput, setSearchInput] = useState(initialSearch)
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch)
  const [sortBy, setSortBy] = useState('featured')
  const [visibility, setVisibility] = useState('active')
  const [modal, setModal] = useState(null)
  const [mutationBusy, setMutationBusy] = useState(false)
  const [modalMessage, setModalMessage] = useState('')
  const signup = useQuestSignup({ catalog, setCatalog })

  const canManage = canManageAnyQuest(session)
  const canCreate = session.hasPermission('quests.create')
  const canEditEconomy =
    session.hasPermission('rewards.policy.edit') ||
    Boolean(session.authority?.isOwner)

  const loadData = useCallback(
    async (signal) => {
      if (!session.authenticated) return

      try {
        const requests = [
          apiJson('/api/quests/member', { signal }),
          apiJson('/api/guild/members', { signal }).catch((error) => {
            if (error?.name === 'AbortError') throw error
            return { members: [] }
          }),
        ]

        if (canManage) {
          requests.push(apiJson('/api/quests/manage', { signal }))
        }

        const [memberCatalog, memberResult, managementWorkspace] =
          await Promise.all(requests)

        if (signal?.aborted) return

        setCatalog(memberCatalog?.quests ? memberCatalog : EMPTY_CATALOG)
        setMembers(memberResult?.members || [])
        setWorkspace(canManage ? managementWorkspace || null : null)
        setStatus('ready')
      } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) return
        setStatus('error')
      }
    },
    [canManage, session.authenticated],
  )

  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    void loadData(controller.signal)

    function refresh() {
      void loadData()
    }

    function handleStorage(event) {
      if (event.key === QUESTS_CHANGED_KEY) refresh()
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') refresh()
    }

    window.addEventListener('focus', refresh)
    window.addEventListener('storage', handleStorage)
    window.addEventListener(QUESTS_CHANGED_KEY, refresh)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      controller.abort()
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(QUESTS_CHANGED_KEY, refresh)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [loadData])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput)
    }, 250)

    return () => window.clearTimeout(timer)
  }, [searchInput])

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

  async function refreshCatalog() {
    const result = await apiJson('/api/quests/member')
    setCatalog(result?.quests ? result : EMPTY_CATALOG)
  }

  function announceChanged() {
    try {
      localStorage.setItem(QUESTS_CHANGED_KEY, String(Date.now()))
    } catch {
      // Cross-tab refresh is best effort.
    }

    window.dispatchEvent(new Event(QUESTS_CHANGED_KEY))
  }

  async function saveWorkspace(nextWorkspace, successMessage) {
    setMutationBusy(true)
    setModalMessage('Saving…')

    try {
      const result = await authenticatedMutation(() =>
        apiJson('/api/quests/manage', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextWorkspace),
        }),
      )

      if (!result) return null

      setWorkspace(result)
      await refreshCatalog()
      setModalMessage(successMessage)
      announceChanged()
      return result
    } catch (error) {
      if (error?.code === 'quest_revision_conflict') {
        await loadData()
        setModalMessage(
          'Someone changed the quest board first. Close and reopen this quest to load the latest version.',
        )
      } else {
        setModalMessage(error?.message || 'Holdfast could not save that change.')
      }
      return null
    } finally {
      setMutationBusy(false)
    }
  }

  async function saveQuest(draft, { featured }) {
    if (!workspace) {
      setModalMessage('The management workspace is not available.')
      return
    }

    const exists = workspace.quests.some((quest) => quest.id === draft.id)
    const next = structuredClone(workspace)
    next.quests = exists
      ? next.quests.map((quest) => (quest.id === draft.id ? draft : quest))
      : [...next.quests, draft]

    const canFeature =
      session.hasPermission('quests.publish') &&
      session.authority?.questScopes?.['quests.publish'] === 'all'

    if (canFeature) {
      if (featured && draft.publication === 'published') {
        next.focusedQuestId = draft.id
      } else if (next.focusedQuestId === draft.id) {
        next.focusedQuestId = ''
      }
    }

    const result = await saveWorkspace(
      next,
      exists ? 'Quest saved.' : 'Quest created.',
    )

    if (result) {
      setModal({ kind: 'quest', questId: draft.id })
    }
  }

  async function deleteQuest(quest) {
    if (!workspace) return

    const next = structuredClone(workspace)
    next.quests = next.quests.filter((candidate) => candidate.id !== quest.id)

    if (next.focusedQuestId === quest.id) {
      next.focusedQuestId = ''
    }

    const result = await saveWorkspace(next, 'Quest deleted.')

    if (result) {
      setModal(null)
      setModalMessage('')
    }
  }

  async function approveReward(quest, objective) {
    if (!workspace) return

    setMutationBusy(true)
    setModalMessage('Approving reward…')

    try {
      const result = await authenticatedMutation(() =>
        apiJson('/api/quests/manage/approve-reward', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            revision: workspace.revision,
            questId: quest.id,
            objectiveId: objective.id,
          }),
        }),
      )

      if (!result) return

      setWorkspace(result)
      await refreshCatalog()
      setModalMessage('Reward approved. Any reward change will require approval again.')
      announceChanged()
    } catch (error) {
      setModalMessage(error?.message || 'Reward approval failed.')
    } finally {
      setMutationBusy(false)
    }
  }

  async function issueReward(quest, objective) {
    if (!workspace) return

    setMutationBusy(true)
    setModalMessage('Completing objective and issuing rewards…')

    try {
      const result = await authenticatedMutation(() =>
        apiJson('/api/quests/manage/complete-objective', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            revision: workspace.revision,
            questId: quest.id,
            objectiveId: objective.id,
          }),
        }),
      )

      if (!result) return

      setWorkspace(result.document)
      await refreshCatalog()
      const people = result.awards?.length || 0
      const rep = (result.awards || []).reduce(
        (total, award) => total + (Number(award.rep) || 0),
        0,
      )
      const marks = (result.awards || []).reduce(
        (total, award) => total + (Number(award.marks) || 0),
        0,
      )
      setModalMessage(
        `Objective complete. Issued ${rep} Rep and ${marks} Marks across ${people} member${people === 1 ? '' : 's'}.`,
      )
      announceChanged()
    } catch (error) {
      setModalMessage(error?.message || 'Objective completion failed.')
    } finally {
      setMutationBusy(false)
    }
  }

  async function saveEconomy({ rewardPolicy, rewardLimits }) {
    if (!workspace) return

    setMutationBusy(true)
    setModalMessage('Saving…')

    try {
      const result = await authenticatedMutation(() =>
        apiJson('/api/quests/manage/economy', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            revision: workspace.revision,
            rewardPolicy,
            rewardLimits,
          }),
        }),
      )

      if (!result) return

      setWorkspace(result)
      announceChanged()
      setModal(null)
      setModalMessage('')
    } catch (error) {
      if (error?.code === 'quest_revision_conflict') {
        setModalMessage(
          'The quest economy changed after you opened it. Close and reopen Economy to load the latest values.',
        )
      } else {
        setModalMessage(error?.message || 'Holdfast could not save reward policy.')
      }
    } finally {
      setMutationBusy(false)
    }
  }

  async function importQuests(nextWorkspace, result) {
    const saved = await saveWorkspace(
      nextWorkspace,
      `Imported ${result.importedCount} quest${result.importedCount === 1 ? '' : 's'}.`,
    )

    if (saved) {
      setModal(null)
      setModalMessage('')
    }

    return saved
  }

  function openQuest(quest) {
    setModalMessage('')
    setModal({ kind: 'quest', questId: quest.id })
  }

  function startCreateQuest() {
    setModalMessage('')
    setModal({
      kind: 'new',
      quest: blankQuest(session.user?.id || ''),
    })
  }

  function requestSignup(quest, objective) {
    setModal(null)
    setModalMessage('')
    signup.requestSignup(quest, objective)
  }

  function requestLeave(quest, objective) {
    setModal(null)
    setModalMessage('')
    signup.requestLeave(quest, objective)
  }

  const memberById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  )

  function creatorName(quest) {
    if (!quest?.createdByMemberId) return ''
    const creator = memberById.get(quest.createdByMemberId)
    return creator?.displayName || creator?.username || 'Former member'
  }

  const source = workspace || catalog
  const allQuests = useMemo(
    () =>
      (source.quests || []).map((quest) =>
        withSelfAssignments(quest, session.user?.id),
      ),
    [session.user?.id, source],
  )

  const queryTerms = useMemo(
    () => searchTerms(debouncedSearch),
    [debouncedSearch],
  )

  const questResults = useMemo(() => {
    let prepared = allQuests.filter((quest) => {
      if (!workspace) return true

      if (visibility === 'published') return quest.publication === 'published'
      if (visibility === 'drafts') return quest.publication === 'draft'
      if (visibility === 'archived') return quest.publication === 'archived'
      if (visibility === 'active') return quest.publication !== 'archived'
      return true
    })

    if (queryTerms.length) {
      prepared = prepared.filter((quest) => {
        const haystack = questSearchText(quest)
        return queryTerms.every((term) => haystack.includes(term))
      })
    }

    return prepared
      .map((quest, index) => ({
        quest,
        index,
        featured: quest.id === source.focusedQuestId,
        rewards: questRewardTotals(quest),
      }))
      .sort((left, right) => {
        if (sortBy === 'rep') {
          return (
            right.rewards.rep - left.rewards.rep ||
            Number(right.featured) - Number(left.featured) ||
            left.index - right.index
          )
        }

        if (sortBy === 'marks') {
          return (
            right.rewards.marks - left.rewards.marks ||
            Number(right.featured) - Number(left.featured) ||
            left.index - right.index
          )
        }

        if (sortBy === 'title') {
          return left.quest.title.localeCompare(right.quest.title)
        }

        return (
          Number(right.featured) - Number(left.featured) ||
          left.index - right.index
        )
      })
  }, [allQuests, queryTerms, sortBy, source.focusedQuestId, visibility, workspace])

  const selectedQuest =
    modal?.kind === 'quest'
      ? allQuests.find((quest) => quest.id === modal.questId) || null
      : null

  const completedObjectives = allQuests.reduce(
    (total, quest) => total + questProgress(quest).completed,
    0,
  )
  const totalObjectives = allQuests.reduce(
    (total, quest) => total + questProgress(quest).total,
    0,
  )

  const closeGate = () => window.location.assign('/')
  const authCode = new URLSearchParams(window.location.search).get('auth')

  if (session.status === 'loading' && authCode === 'connected') {
    return <Home />
  }

  if (
    session.status === 'loading' ||
    session.status === 'error' ||
    !session.authenticated
  ) {
    return (
      <Home
        overlay={
          <MemberAccessModal returnTo="/quests" onClose={closeGate} />
        }
      />
    )
  }

  return (
    <>
      <PageShell title="Quests" centered className="quests-page">
        <section className="quests-page__command">
          <div>
            <span>Holdfast work board</span>
            <strong>
              {workspace
                ? 'Your authority is built into the board.'
                : 'Pick a quest. Put your name on the work.'}
            </strong>
          </div>

          <div className="quests-page__command-actions">
            {canEditEconomy && workspace ? (
              <button
                type="button"
                onClick={() => {
                  setModalMessage('')
                  setModal({ kind: 'economy' })
                }}
              >
                Economy
              </button>
            ) : null}

            {canCreate && workspace ? (
              <button
                type="button"
                onClick={() => {
                  setModalMessage('')
                  setModal({ kind: 'import' })
                }}
              >
                AI / JSON
              </button>
            ) : null}

            {canCreate && workspace ? (
              <button
                className="quests-page__create"
                type="button"
                onClick={startCreateQuest}
              >
                <span aria-hidden="true">＋</span>
                Create quest
              </button>
            ) : null}
          </div>
        </section>

        <section className="quests-page__tools" aria-label="Quest board tools">
          <div className="quests-page__search">
            <label htmlFor="quest-search">Search</label>
            <div className="quests-page__search-field">
              <input
                id="quest-search"
                type="search"
                value={searchInput}
                autoComplete="off"
                placeholder="Quest, objective, member, reward…"
                onChange={(event) => setSearchInput(event.target.value)}
              />
              {searchInput ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('')
                    setDebouncedSearch('')
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          <label className="quests-page__sort">
            <span>Sort by</span>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
            >
              <option value="featured">Featured first</option>
              <option value="rep">Most Rep</option>
              <option value="marks">Most Marks</option>
              <option value="title">Title</option>
            </select>
          </label>

          {workspace ? (
            <label className="quests-page__sort">
              <span>Show</span>
              <select
                value={visibility}
                onChange={(event) => setVisibility(event.target.value)}
              >
                <option value="active">Active + drafts</option>
                <option value="published">Published</option>
                <option value="drafts">Drafts</option>
                <option value="archived">Archived</option>
                <option value="all">Everything</option>
              </select>
            </label>
          ) : null}

          <p className="quests-page__board-meta">
            <strong>{questResults.length}</strong>{' '}
            {questResults.length === 1 ? 'quest' : 'quests'} ·{' '}
            <strong>{Math.max(0, totalObjectives - completedObjectives)}</strong>{' '}
            open · <strong>{completedObjectives}</strong> complete
          </p>
        </section>

        {status === 'loading' ? (
          <p className="quests-page__state">Opening the quest board…</p>
        ) : status === 'error' ? (
          <p className="quests-page__state quests-page__state--error">
            The quest board could not be loaded.
          </p>
        ) : questResults.length ? (
          <section className="quests-page__grid" aria-label="Guild quests">
            {questResults.map(({ quest, featured }) => (
              <QuestCard
                key={quest.id}
                quest={quest}
                featured={featured}
                creatorName={workspace ? creatorName(quest) : ''}
                onOpen={() => openQuest(quest)}
              />
            ))}
          </section>
        ) : (
          <section className="quests-page__empty-state">
            <h2>{allQuests.length ? 'No quests match.' : 'The board is clear.'}</h2>
            <p>
              {allQuests.length
                ? 'Change the search or filter to find what you need.'
                : canCreate
                  ? 'Create the first quest directly from this page.'
                  : 'There is nothing the guild is asking for right now.'}
            </p>
            {canCreate && !allQuests.length ? (
              <button
                className="quests-page__empty-create"
                type="button"
                onClick={startCreateQuest}
              >
                Create quest
              </button>
            ) : null}
          </section>
        )}
      </PageShell>

      {selectedQuest ? (
        <QuestModal
          quest={selectedQuest}
          session={session}
          rewardLimits={workspace?.rewardLimits}
          creatorName={creatorName(selectedQuest)}
          focused={selectedQuest.id === source.focusedQuestId}
          busy={mutationBusy}
          message={modalMessage}
          onClose={() => {
            setModal(null)
            setModalMessage('')
          }}
          onSave={saveQuest}
          onDelete={deleteQuest}
          onApprove={approveReward}
          onIssue={issueReward}
          onSignup={requestSignup}
          onLeave={requestLeave}
        />
      ) : null}

      {modal?.kind === 'new' && workspace ? (
        <QuestModal
          quest={modal.quest}
          session={session}
          rewardLimits={workspace.rewardLimits}
          isNew
          busy={mutationBusy}
          message={modalMessage}
          onClose={() => {
            setModal(null)
            setModalMessage('')
          }}
          onSave={saveQuest}
        />
      ) : null}

      {modal?.kind === 'economy' && workspace ? (
        <QuestEconomyModal
          workspace={workspace}
          session={session}
          busy={mutationBusy}
          message={modalMessage}
          onClose={() => {
            setModal(null)
            setModalMessage('')
          }}
          onSave={saveEconomy}
        />
      ) : null}

      {modal?.kind === 'import' && workspace ? (
        <QuestJsonImportModal
          workspace={workspace}
          session={session}
          busy={mutationBusy}
          message={modalMessage}
          onClose={() => {
            setModal(null)
            setModalMessage('')
          }}
          onImport={importQuests}
        />
      ) : null}

      {signup.modal}
    </>
  )
}

export default Quests
