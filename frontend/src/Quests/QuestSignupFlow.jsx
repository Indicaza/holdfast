import { useEffect, useRef, useState } from 'react'
import { apiJson } from '../Api/apiClient.js'
import { useSession } from '../Auth/SessionProvider.jsx'
import Modal from '../Modal/Modal.jsx'
import './QuestSignupFlow.css'

const QUESTS_CHANGED_KEY = 'holdfast:quests-changed'

function cleanSignupQuery() {
  const url = new URL(window.location.href)
  url.searchParams.delete('signupQuest')
  url.searchParams.delete('signupObjective')
  url.searchParams.delete('auth')
  window.history.replaceState(
    null,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
}

function pendingSignupReturnTo(questId, objectiveId) {
  const url = new URL(window.location.href)
  url.searchParams.delete('auth')
  url.searchParams.set('signupQuest', questId)
  url.searchParams.set('signupObjective', objectiveId)
  return `${url.pathname}${url.search}${url.hash}`
}

function announceQuestsChanged() {
  try {
    localStorage.setItem(QUESTS_CHANGED_KEY, String(Date.now()))
  } catch {
    // Cross-tab refresh is best-effort.
  }

  window.dispatchEvent(new Event(QUESTS_CHANGED_KEY))
}

export function questSelfAssignment(quest) {
  for (const objective of quest?.objectives ?? []) {
    const assignment = (objective.assignments ?? []).find(
      (item) => item.isSelf,
    )

    if (assignment) {
      return { objective, assignment }
    }
  }

  return null
}

function dialogForExisting(quest, existing) {
  return {
    kind: 'duplicate',
    quest,
    objective: existing.objective,
  }
}

export function useQuestSignup({ catalog, setCatalog }) {
  const session = useSession()
  const [dialog, setDialog] = useState(null)
  const pendingHandledRef = useRef('')

  useEffect(() => {
    if (session.status !== 'ready' || !session.authenticated) {
      return
    }

    const params = new URLSearchParams(window.location.search)
    const questId = params.get('signupQuest')
    const objectiveId = params.get('signupObjective')

    if (!questId || !objectiveId) {
      return
    }

    const key = `${questId}:${objectiveId}`

    if (pendingHandledRef.current === key) {
      return
    }

    const quest = catalog.quests.find((item) => item.id === questId)
    const objective = quest?.objectives.find((item) => item.id === objectiveId)

    if (!quest || !objective) {
      if (catalog.quests.length) {
        pendingHandledRef.current = key
        setDialog({
          kind: 'error',
          title: 'That objective moved.',
          message:
            'The quest changed while you were signing in. Open the quest board and choose an objective again.',
        })
      }
      return
    }

    pendingHandledRef.current = key
    const existing = questSelfAssignment(quest)

    if (existing) {
      setDialog(dialogForExisting(quest, existing))
      return
    }

    if (objective.completed) {
      setDialog({
        kind: 'error',
        title: 'That objective is complete.',
        message: 'Pick another objective that still needs a hand.',
      })
      return
    }

    setDialog({ kind: 'confirm', quest, objective })
  }, [catalog.quests, session.authenticated, session.status])

  function requestSignup(quest, objective) {
    if (objective.completed) {
      setDialog({
        kind: 'error',
        title: 'That objective is complete.',
        message: 'Pick another objective that still needs a hand.',
      })
      return
    }

    const existing = questSelfAssignment(quest)

    if (existing) {
      setDialog(dialogForExisting(quest, existing))
      return
    }

    if (!session.authenticated) {
      session.signIn(
        pendingSignupReturnTo(quest.id, objective.id),
        'member',
      )
      return
    }

    setDialog({ kind: 'confirm', quest, objective })
  }

  async function confirmSignup() {
    if (!dialog?.quest || !dialog?.objective) {
      return
    }

    const { quest, objective } = dialog
    setDialog({ kind: 'saving', quest, objective })

    try {
      const result = await apiJson('/api/quests/member/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questId: quest.id,
          objectiveId: objective.id,
        }),
      })

      if (result?.catalog?.quests) {
        setCatalog(result.catalog)
      }

      announceQuestsChanged()
      setDialog({ kind: 'success', quest, objective })
    } catch (error) {
      if (error?.code === 'already_assigned_to_quest') {
        setDialog({
          kind: 'duplicate',
          quest,
          objective: {
            id: error.objectiveId || '',
            title: error.objectiveTitle || 'another objective',
          },
        })
        return
      }

      setDialog({
        kind: 'error',
        title: 'Signup did not stick.',
        message:
          error?.message ||
          'Holdfast could not save that assignment. Give it another try.',
      })
    }
  }

  function closeDialog() {
    cleanSignupQuery()
    setDialog(null)
  }

  let modal = null

  if (dialog?.kind === 'confirm' || dialog?.kind === 'saving') {
    const saving = dialog.kind === 'saving'

    modal = (
      <Modal
        eyebrow="Quest signup"
        title={dialog.objective.title}
        intro={`Take this objective in “${dialog.quest.title}”?`}
        align="left"
        onClose={saving ? undefined : closeDialog}
      >
        <div className="quest-signup__note">
          <strong>One objective per quest.</strong>
          <span>
            Signing up puts your name on this objective so everyone knows
            what you are taking responsibility for.
          </span>
        </div>

        <div className="quest-signup__actions">
          <button
            className="quest-signup__primary"
            type="button"
            disabled={saving}
            onClick={confirmSignup}
          >
            {saving ? 'Signing you up…' : 'Sign me up'}
          </button>
          <button
            className="quest-signup__secondary"
            type="button"
            disabled={saving}
            onClick={closeDialog}
          >
            Not yet
          </button>
        </div>
      </Modal>
    )
  }

  if (dialog?.kind === 'duplicate') {
    modal = (
      <Modal
        eyebrow="Already assigned"
        title="You are already on this quest."
        intro={`You signed up for “${dialog.objective.title}”.`}
        align="left"
        onClose={closeDialog}
      >
        <div className="quest-signup__note">
          <strong>One objective at a time keeps ownership clear.</strong>
          <span>
            You can still help wherever you want in game; GuildOS just keeps
            one official objective per member on each quest.
          </span>
        </div>

        <button
          className="quest-signup__primary"
          type="button"
          onClick={closeDialog}
        >
          Got it
        </button>
      </Modal>
    )
  }

  if (dialog?.kind === 'success') {
    modal = (
      <Modal
        eyebrow="Assignment confirmed"
        title="You are on it."
        intro={`“${dialog.objective.title}” is now yours on “${dialog.quest.title}”.`}
        align="left"
        onClose={closeDialog}
      >
        <button
          className="quest-signup__primary"
          type="button"
          onClick={closeDialog}
        >
          Back to the quest
        </button>
      </Modal>
    )
  }

  if (dialog?.kind === 'error') {
    modal = (
      <Modal
        eyebrow="Quest signup"
        title={dialog.title}
        intro={dialog.message}
        align="left"
        onClose={closeDialog}
      >
        <button
          className="quest-signup__primary"
          type="button"
          onClick={closeDialog}
        >
          Back
        </button>
      </Modal>
    )
  }

  return {
    requestSignup,
    modal,
  }
}
