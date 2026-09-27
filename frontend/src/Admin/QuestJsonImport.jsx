import { useMemo, useState } from 'react'
import {
  QuestImportError,
  buildQuestImportPrompt,
  importQuestJson,
} from './questJsonImport.js'

const MAX_FILE_BYTES = 256 * 1024

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

function QuestJsonImport({ questDocument, onImport }) {
  const [jsonText, setJsonText] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState('normal')
  const [copyLabel, setCopyLabel] = useState('Copy AI seed prompt')

  const seedPrompt = useMemo(
    () => buildQuestImportPrompt(questDocument.rewardLimits),
    [questDocument.rewardLimits],
  )

  function applyJson(raw) {
    try {
      const result = importQuestJson(raw, questDocument)
      onImport(result.document, result)
      setJsonText('')
      setNoticeTone('success')
      setNotice(
        `Imported ${result.importedCount} quest${result.importedCount === 1 ? '' : 's'} into the unsaved draft.${
          result.featuredTitle
            ? ` “${result.featuredTitle}” will be featured after you save.`
            : ''
        } Assignments were left empty.`,
      )
    } catch (error) {
      setNoticeTone('error')
      setNotice(
        error instanceof QuestImportError
          ? error.message
          : 'That quest JSON could not be imported.',
      )
    }
  }

  async function handleCopyPrompt() {
    try {
      await copyText(seedPrompt)
      setCopyLabel('Seed prompt copied')
      window.setTimeout(() => setCopyLabel('Copy AI seed prompt'), 1800)
    } catch {
      setNoticeTone('error')
      setNotice('Could not copy the seed prompt. Try selecting and copying it manually.')
    }
  }

  async function handleFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return

    if (file.size > MAX_FILE_BYTES) {
      setNoticeTone('error')
      setNotice('That JSON file is larger than 256 KB.')
      return
    }

    try {
      const raw = await file.text()
      setJsonText(raw)
      applyJson(raw)
    } catch {
      setNoticeTone('error')
      setNotice('That file could not be read.')
    }
  }

  return (
    <section className="quest-editor__panel quest-editor__import-panel">
      <details>
        <summary className="quest-editor__import-summary">
          <div>
            <span className="quest-editor__kicker">Power tools</span>
            <strong>AI / JSON import</strong>
          </div>
          <span>Paste or upload</span>
        </summary>

        <div className="quest-editor__import-body">
          <div className="quest-editor__import-copy">
            <div>
              <strong>Skip the click-through.</strong>
              <p>
                Copy the seed prompt, tell an AI what quests you want, then paste
                its JSON here or upload the file.
              </p>
            </div>
            <button
              className="quest-editor__secondary"
              type="button"
              onClick={handleCopyPrompt}
            >
              {copyLabel}
            </button>
          </div>

          <div className="quest-editor__import-actions">
            <label className="quest-editor__secondary quest-editor__file-button">
              Upload JSON
              <input
                type="file"
                accept="application/json,.json"
                onChange={handleFile}
              />
            </label>
            <span>
              <code>featured: true</code> publishes that quest and selects it for
              the home page. Assignments are always ignored.
            </span>
          </div>

          <label className="quest-editor__import-json">
            <span>Quest JSON</span>
            <textarea
              rows="12"
              spellCheck="false"
              value={jsonText}
              placeholder={'{\n  "quests": [\n    { "title": "..." }\n  ]\n}'}
              onChange={(event) => {
                setJsonText(event.target.value)
                setNotice('')
                setNoticeTone('normal')
              }}
            />
          </label>

          <div className="quest-editor__import-footer">
            <p
              className={`quest-editor__import-notice quest-editor__import-notice--${noticeTone}`}
              aria-live="polite"
            >
              {notice || 'Import adds quests to the current unsaved draft. Nothing goes live until you save.'}
            </p>
            <button
              className="quest-editor__primary"
              type="button"
              disabled={!jsonText.trim()}
              onClick={() => applyJson(jsonText)}
            >
              Import into draft
            </button>
          </div>

          <details className="quest-editor__prompt-preview">
            <summary>Preview seed prompt</summary>
            <pre>{seedPrompt}</pre>
          </details>
        </div>
      </details>
    </section>
  )
}

export default QuestJsonImport
