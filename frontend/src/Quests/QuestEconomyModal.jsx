import { useMemo, useState } from 'react'
import Modal from '../Modal/Modal.jsx'
import './QuestEconomyModal.css'

function QuestEconomyModal({
  workspace,
  session,
  busy = false,
  message = '',
  onClose,
  onSave,
}) {
  const [policy, setPolicy] = useState(workspace.rewardPolicy || '')
  const [limits, setLimits] = useState(() => structuredClone(workspace.rewardLimits))
  const canEditPolicy = session.hasPermission('rewards.policy.edit')
  const canEditLimits = Boolean(session.authority?.isOwner)
  const canSave = canEditPolicy || canEditLimits

  const dirty = useMemo(
    () =>
      policy !== (workspace.rewardPolicy || '') ||
      JSON.stringify(limits) !== JSON.stringify(workspace.rewardLimits),
    [limits, policy, workspace.rewardLimits, workspace.rewardPolicy],
  )

  function updateRange(currency, key, value) {
    setLimits((current) => ({
      ...current,
      [currency]: {
        ...current[currency],
        [key]: Math.max(0, Number(value) || 0),
      },
    }))
  }

  return (
    <Modal
      eyebrow="Guild economy"
      title="Reward policy"
      intro="Guidance can be delegated. Hard Rep and Marks ceilings remain Commander-owned."
      size="wide"
      align="left"
      onClose={busy ? undefined : onClose}
    >
      <div className="quest-economy">
        {message ? <p className="quest-economy__message">{message}</p> : null}

        <label className="quest-economy__policy">
          <span>Reward guidance</span>
          <textarea
            rows="5"
            value={policy}
            disabled={!canEditPolicy || busy}
            placeholder="How Holdfast should think about fair rewards…"
            onChange={(event) => setPolicy(event.target.value)}
          />
          <small>
            Officers use this as guidance when proposing and approving rewards.
          </small>
        </label>

        <section className="quest-economy__caps">
          <header>
            <div>
              <span>Hard guardrails</span>
              <h2>Absolute ceilings</h2>
            </div>
            {!canEditLimits ? <strong>Commander only</strong> : null}
          </header>

          <p>
            Rank and billet reward brackets can only sit underneath these values.
            They can never grant more authority than the guild economy allows.
          </p>

          <div className="quest-economy__grid">
            <div className="quest-economy__range">
              <strong>Rep / objective</strong>
              <label>
                <span>Minimum non-zero</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={limits.rep.min}
                  disabled={!canEditLimits || busy}
                  onChange={(event) =>
                    updateRange('rep', 'min', event.target.value)
                  }
                />
              </label>
              <label>
                <span>Absolute maximum</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={limits.rep.max}
                  disabled={!canEditLimits || busy}
                  onChange={(event) =>
                    updateRange('rep', 'max', event.target.value)
                  }
                />
              </label>
            </div>

            <div className="quest-economy__range">
              <strong>Marks / objective</strong>
              <label>
                <span>Minimum non-zero</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={limits.marks.min}
                  disabled={!canEditLimits || busy}
                  onChange={(event) =>
                    updateRange('marks', 'min', event.target.value)
                  }
                />
              </label>
              <label>
                <span>Absolute maximum</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={limits.marks.max}
                  disabled={!canEditLimits || busy}
                  onChange={(event) =>
                    updateRange('marks', 'max', event.target.value)
                  }
                />
              </label>
            </div>

            <label className="quest-economy__quest-cap">
              <span>Marks / quest</span>
              <input
                type="number"
                min="0"
                step="1"
                value={limits.marksPerQuestMax}
                disabled={!canEditLimits || busy}
                onChange={(event) =>
                  setLimits((current) => ({
                    ...current,
                    marksPerQuestMax: Math.max(0, Number(event.target.value) || 0),
                  }))
                }
              />
              <small>Total proposed Marks across every objective in one quest.</small>
            </label>
          </div>
        </section>

        <footer className="quest-economy__actions">
          <span>{dirty ? 'Unsaved changes' : 'Up to date'}</span>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="quest-economy__save"
            type="button"
            disabled={busy || !dirty || !canSave}
            onClick={() => onSave?.({ rewardPolicy: policy, rewardLimits: limits })}
          >
            {busy ? 'Saving…' : 'Save policy'}
          </button>
        </footer>
      </div>
    </Modal>
  )
}

export default QuestEconomyModal
