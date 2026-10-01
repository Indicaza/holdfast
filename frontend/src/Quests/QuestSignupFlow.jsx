import { useEffect, useRef, useState } from 'react'
import { apiJson } from '../Api/apiClient.js'
import { runAuthenticatedMutation } from '../Auth/authenticatedMutation.js'
import { useSession } from '../Auth/sessionContext.js'
import Modal from '../Modal/Modal.jsx'
import './QuestSignupFlow.css'

const QUESTS_CHANGED_KEY = 'holdfast:quests-changed'

function cleanSignupQuery() {
  const url = new URL(window.location.href)
  url.searchParams.delete('signupQuest')
  url.searchParams.delete('signupObjective')
  url.searchParams.delete('questAction')
  url.searchParams.delete('auth')
  window.history.replaceState(
    null,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
}

function pendingQuestActionReturnTo(questId, objectiveId, action = 'signup') {
  const url = new URL(window.location.href)
  url.searchParams.delete('auth')
  url.searchParams.set('signupQuest', questId)
  url.searchParams.set('signupObjective', objectiveId)
  url.searchParams.set('questAction', action)
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

export function objectiveSelfAssignment(objective) {
  return (objective?.assignments ?? []).find((item) => item.isSelf) ?? null
}

function duplicateDialog(quest, objective) {
  return {
    kind: 'duplicate',
    quest,
    objective,
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
    const action = params.get('questAction') || 'signup'

    if (!questId || !objectiveId) {
      return
    }

    const key = `${action}:${questId}:${objectiveId}`

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

    if (action === 'leave') {
      if (objectiveSelfAssignment(objective)) {
        setDialog({ kind: 'leave-confirm', quest, objective })
      } else {
        setDialog({
          kind: 'error',
          title: 'You are no longer assigned here.',
          message:
            'Your assignment changed while you were signing in. There is nothing to remove.',
        })
      }
      return
    }

    if (objectiveSelfAssignment(objective)) {
      setDialog(duplicateDialog(quest, objective))
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

    if (objectiveSelfAssignment(objective)) {
      setDialog(duplicateDialog(quest, objective))
      return
    }

    if (!session.authenticated) {
      session.signIn(
        pendingQuestActionReturnTo(quest.id, objective.id, 'signup'),
        'member',
      )
      return
    }

    setDialog({ kind: 'confirm', quest, objective })
  }

  function requestLeave(quest, objective) {
    if (!objectiveSelfAssignment(objective)) {
      return
    }

    setDialog({ kind: 'leave-confirm', quest, objective })
  }

  async function runMemberMutation(url, body, action) {
    return runAuthenticatedMutation({
      request: () =>
        apiJson(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      refresh: session.refresh,
      reauthenticate: () =>
        session.signIn(
          pendingQuestActionReturnTo(
            body.questId,
            body.objectiveId,
            action,
          ),
          'member',
        ),
    })
  }

  async function confirmSignup() {
    if (!dialog?.quest || !dialog?.objective) {
      return
    }

    const { quest, objective } = dialog
    setDialog({ kind: 'saving', quest, objective })

    try {
      const result = await runMemberMutation(
        '/api/quests/member/signup',
        {
          questId: quest.id,
          objectiveId: objective.id,
        },
        'signup',
      )

      if (!result) {
        return
      }

      if (result?.catalog?.quests) {
        setCatalog(result.catalog)
      }

      announceQuestsChanged()
      setDialog({ kind: 'success', quest, objective })
    } catch (error) {
      if (error?.code === 'already_assigned_to_objective') {
        setDialog(duplicateDialog(quest, objective))
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

  async function confirmLeave() {
    if (!dialog?.quest || !dialog?.objective) {
      return
    }

    const { quest, objective } = dialog
    setDialog({ kind: 'leaving', quest, objective })

    try {
      const result = await runMemberMutation(
        '/api/quests/member/unassign',
        {
          questId: quest.id,
          objectiveId: objective.id,
        },
        'leave',
      )

      if (!result) {
        return
      }

      if (result?.catalog?.quests) {
        setCatalog(result.catalog)
      }

      announceQuestsChanged()
      cleanSignupQuery()
      setDialog(null)
    } catch (error) {
      setDialog({
        kind: 'error',
        title: 'Could not leave the objective.',
        message:
          error?.message ||
          'Holdfast could not remove that assignment. Give it another try.',
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
        onClose={saving ? undefined : closeDialog}
      >
        <div className="quest-signup__note">
          <strong>Put your name on it.</strong>
          <span>
            You can take more than one objective in a quest. You just cannot
            sign up for this same objective twice.
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
        title="You are already on this objective."
        intro={`You already signed up for “${dialog.objective.title}”.`}
        onClose={closeDialog}
      >
        <div className="quest-signup__note">
          <strong>No duplicate signups needed.</strong>
          <span>
            Your name is already on this objective. Click your portrait on the
            quest board if you want to leave it.
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

  if (dialog?.kind === 'leave-confirm' || dialog?.kind === 'leaving') {
    const leaving = dialog.kind === 'leaving'

    modal = (
      <Modal
        eyebrow="Leave objective"
        title={dialog.objective.title}
        intro={`Remove yourself from this objective in “${dialog.quest.title}”?`}
        onClose={leaving ? undefined : closeDialog}
      >
        <div className="quest-signup__note">
          <strong>Your slot will open back up.</strong>
          <span>
            This only removes your assignment. It does not change the quest or
            anyone else signed up for it.
          </span>
        </div>

        <div className="quest-signup__actions">
          <button
            className="quest-signup__danger"
            type="button"
            disabled={leaving}
            onClick={confirmLeave}
          >
            {leaving ? 'Leaving…' : 'Leave objective'}
          </button>
          <button
            className="quest-signup__secondary"
            type="button"
            disabled={leaving}
            onClick={closeDialog}
          >
            Stay on it
          </button>
        </div>
      </Modal>
    )
  }

  if (dialog?.kind === 'success') {
    modal = (
      <Modal
        eyebrow="Assignment confirmed"
        title="You are on it."
        intro={`“${dialog.objective.title}” is now yours on “${dialog.quest.title}”.`}
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
    requestLeave,
    modal,
  }
}
