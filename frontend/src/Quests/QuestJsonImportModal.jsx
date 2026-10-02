import { useMemo, useState } from 'react'
import Modal from '../Modal/Modal.jsx'
import {
  MAX_QUEST_IMPORT_BYTES,
  QuestImportError,
  buildQuestImportPrompt,
  importQuestJson,
} from './questJsonImport.js'
import './QuestJsonImportModal.css'

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = window.document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  window.document.body.appendChild(textarea)
  textarea.select()
  window.document.execCommand('copy')
  textarea.remove()
}

function QuestJsonImportModal({
  workspace,
  session,
  busy = false,
  message = '',
  onClose,
  onImport,
}) {
  const [jsonText, setJsonText] = useState('')
  const [notice, setNotice] = useState('')
  const [copyLabel, setCopyLabel] = useState('Copy AI seed prompt')

  const canPublish = session.hasPermission('quests.publish')
  const canFeature =
    canPublish && session.authority?.questScopes?.['quests.publish'] === 'all'

  const seedPrompt = useMemo(
    () =>
      buildQuestImportPrompt(workspace.rewardLimits, {
        canPublish,
        canFeature,
      }),
    [canFeature, canPublish, workspace.rewardLimits],
  )

  async function handleCopyPrompt() {
    try {
      await copyText(seedPrompt)
      setCopyLabel('Copied')
      window.setTimeout(() => setCopyLabel('Copy AI seed prompt'), 1600)
    } catch {
      setNotice('Could not copy the prompt. Open the preview and copy it manually.')
    }
  }

  async function handleFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return

    if (file.size > MAX_QUEST_IMPORT_BYTES) {
      setNotice('That JSON file is larger than 256 KB.')
      return
    }

    try {
      setJsonText(await file.text())
      setNotice('File loaded. Review it, then import when ready.')
    } catch {
      setNotice('That file could not be read.')
    }
  }

  async function handleImport() {
    setNotice('')

    try {
      const result = importQuestJson(jsonText, workspace, {
        memberId: session.user?.id || '',
        canPublish,
        canFeature,
      })
      await onImport?.(result.document, result)
    } catch (error) {
      setNotice(
        error instanceof QuestImportError
          ? error.message
          : error?.message || 'That quest JSON could not be imported.',
      )
    }
  }

  return (
    <Modal
      eyebrow="Quest forge"
      title="AI / JSON import"
      intro="Copy the seed prompt, describe what you want to an AI, then paste the JSON back here. Holdfast validates it before saving."
      size="wide"
      align="left"
      onClose={busy ? undefined : onClose}
    >
      <div className="quest-import">
        {message || notice ? (
          <p className="quest-import__message">{notice || message}</p>
        ) : null}

        <section className="quest-import__step">
          <div className="quest-import__step-number">1</div>
          <div className="quest-import__step-body">
            <div className="quest-import__step-heading">
              <div>
                <span>Seed the AI</span>
                <h2>Copy the Holdfast quest prompt</h2>
              </div>
              <button type="button" disabled={busy} onClick={handleCopyPrompt}>
                {copyLabel}
              </button>
            </div>
            <p>
              The prompt includes the live Rep and Marks limits plus your current
              publish authority. Add your quest description where it tells you to.
            </p>
            <details className="quest-import__prompt-preview">
              <summary>Preview seed prompt</summary>
              <pre>{seedPrompt}</pre>
            </details>
          </div>
        </section>

        <section className="quest-import__step">
          <div className="quest-import__step-number">2</div>
          <div className="quest-import__step-body">
            <div className="quest-import__step-heading">
              <div>
                <span>Bring it home</span>
                <h2>Paste the generated JSON</h2>
              </div>
              <label className="quest-import__file-button">
                Load JSON file
                <input
                  type="file"
                  accept="application/json,.json"
                  disabled={busy}
                  onChange={handleFile}
                />
              </label>
            </div>

            <textarea
              value={jsonText}
              disabled={busy}
              spellCheck="false"
              placeholder='{"quests":[...]}'
              onChange={(event) => {
                setJsonText(event.target.value)
                setNotice('')
              }}
            />

            <div className="quest-import__safety">
              <strong>Human in the loop.</strong>
              <span>
                AI-supplied IDs, assignments, completion state, and approval state
                are discarded. Fresh IDs are generated locally and the normal
                backend permission checks still run on save.
              </span>
            </div>
          </div>
        </section>

        <footer className="quest-import__actions">
          <span>
            {canFeature
              ? 'You may import drafts, published quests, and one featured quest.'
              : canPublish
                ? 'You may import drafts or published quests.'
                : 'Your imported quests must remain drafts.'}
          </span>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="quest-import__save"
            type="button"
            disabled={busy || !jsonText.trim()}
            onClick={handleImport}
          >
            {busy ? 'Importing…' : 'Import & save'}
          </button>
        </footer>
      </div>
    </Modal>
  )
}

export default QuestJsonImportModal
