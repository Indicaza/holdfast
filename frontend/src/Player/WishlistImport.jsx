import { useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import { appliedText, groupImportErrors, importSummaryText } from './lootModel.js'
import { Icon, ItemLabel, Panel } from './ui.jsx'

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// A button that copies text it may have to fetch first. When the browser
// refuses the clipboard, the text is shown to copy by hand.
function CopyButton({ label, load, onManual, primary = false, disabled = false }) {
  const [state, setState] = useState('idle')
  async function run() {
    setState('busy')
    try {
      const text = await load()
      if (await copyText(text)) {
        setState('copied')
        setTimeout(() => setState('idle'), 2500)
      } else {
        onManual(text)
        setState('idle')
      }
    } catch {
      setState('failed')
    }
  }
  return (
    <button type="button" className={`gw-btn gw-btn--sm${primary ? ' gw-btn--primary' : ''}`} onClick={run} disabled={disabled || state === 'busy'}>
      <Icon name={state === 'copied' ? 'check' : 'copy'} size={14} />
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy: try again' : label}
    </button>
  )
}

function ErrorList({ title, note, errors }) {
  if (!errors.length) return null
  return (
    <div className="gw-import__errors">
      <h4>{title} <span className="gw-muted">({errors.length})</span></h4>
      {note ? <p className="gw-muted">{note}</p> : null}
      <ul>
        {errors.map((error, index) => (
          <li key={`${error.path}-${error.code}-${index}`}>
            <code>{error.path}</code> <span className="gw-tag gw-tag--quiet">{error.code}</span>
            <p>{error.message}</p>
            {error.suggestion ? <p className="gw-muted">Fix: {error.suggestion}</p> : null}
            {error.candidates?.length ? (
              <p className="gw-muted">Known items with that name: {error.candidates.map((candidate) => `${candidate.name} (${candidate.itemId})`).join(', ')}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

const ACTION_LABELS = { add: 'Add', update: 'Update', unchanged: 'Already listed' }

function Preview({ result }) {
  return (
    <div className="gw-import__preview">
      <ul>
        {result.entries.map((entry) => (
          <li key={entry.itemKey}>
            <span className={`gw-tag${entry.action === 'unchanged' ? ' gw-tag--quiet' : entry.action === 'add' ? ' gw-tag--ok' : ''}`}>{ACTION_LABELS[entry.action]}</span>
            <ItemLabel item={{ itemId: entry.itemId, name: entry.name, qualityId: entry.qualityId, iconFileDataId: entry.iconFileDataId }} size={18} tooltip={false} />
            <span className="gw-muted">
              {entry.priority}{entry.note ? ` · ${entry.note}` : ''}
              {entry.action === 'update' ? ` · changes ${Object.keys(entry.changes).join(', ')}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {result.warnings.length ? (
        <ul className="gw-import__warnings">
          {result.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}</li>)}
        </ul>
      ) : null}
    </div>
  )
}

// Copy a planning prompt for any AI, then paste its JSON answer back. The
// answer is checked and previewed before anything is saved; a list with
// errors saves nothing and comes with a repair prompt for the AI.
export default function WishlistImport({ character, dungeon, onImported, onClose }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)
  const [done, setDone] = useState(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [updateExisting, setUpdateExisting] = useState(true)
  const [onlyDungeon, setOnlyDungeon] = useState(false)
  const [manual, setManual] = useState(null)
  const base = `/api/player/wishlists/${encodeURIComponent(character.id)}`

  async function send(body) {
    setBusy(true)
    setFailure('')
    try {
      return await apiJson(`${base}/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, ...body }) })
    } catch (error) {
      // A rejected import answers 422 with the same report as a preview.
      if (error?.status === 422 && error.body?.errors) return error.body
      setFailure(error?.status === 404 ? 'That character is not one of yours.' : 'The import could not be checked. Try again.')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function check() {
    setDone(null)
    const report = await send({})
    if (report) setResult(report)
  }

  async function commit(skipInvalid) {
    const report = await send({ commit: true, updateExisting, skipInvalid })
    if (!report) return
    if (report.status === 'imported') {
      setDone(report.applied)
      setResult(null)
      setText('')
      onImported(report.wishlist)
    } else {
      setResult(report)
    }
  }

  const errors = result ? groupImportErrors(result.errors) : null
  const changes = result ? result.summary.add + result.summary.update : 0
  return (
    <Panel id="player-wishlist-import" title="AI wishlist builder" className="gw-import"
      description={`Plan ${character.name}'s upgrades with ChatGPT, Claude or any AI. Nothing here calls an AI or costs anything.`}
      actions={<button type="button" className="gw-icon-btn gw-icon-btn--quiet" aria-label="Close the AI wishlist builder" onClick={onClose}><Icon name="close" size={16} /></button>}>
      <ol className="gw-import__steps">
        <li>
          <strong>Copy the planning prompt</strong> and paste it into your AI. It holds {character.name}'s level, class and gear, the wishlist so far, and the dungeon loot with item ids.
          <div className="gw-import__row">
            <CopyButton label="Copy AI planning prompt" primary onManual={(value) => setManual({ title: 'Planning prompt', value })}
              load={async () => (await apiJson(`${base}/ai-prompt${onlyDungeon && dungeon ? `?dungeons=${dungeon.instanceId}` : ''}`)).prompt} />
            {dungeon ? (
              <label className="gw-import__check"><input type="checkbox" checked={onlyDungeon} onChange={(event) => setOnlyDungeon(event.target.checked)} /> Only {dungeon.name}</label>
            ) : null}
          </div>
        </li>
        <li>
          <strong>Paste the AI's JSON answer</strong> and check it. Nothing is saved until you confirm.
          <textarea className="gw-import__text" value={text} spellCheck={false} rows={7} aria-label="AI wishlist JSON"
            placeholder={'{ "schemaVersion": 1, "character": "…", "items": [ … ] }'}
            onChange={(event) => { setText(event.target.value); setResult(null); setDone(null) }} />
          <div className="gw-import__row">
            <button type="button" className="gw-btn gw-btn--sm" onClick={check} disabled={busy || !text.trim()}>Check the JSON</button>
            {failure ? <span className="gw-import__failure" role="alert">{failure}</span> : null}
          </div>
        </li>
      </ol>

      {manual ? (
        <div className="gw-import__manual">
          <p className="gw-muted">Your browser did not allow copying. Select all of this and copy it:</p>
          <textarea className="gw-import__text" readOnly rows={6} value={manual.value} aria-label={manual.title} onFocus={(event) => event.target.select()} />
        </div>
      ) : null}

      {done ? <p className="gw-import__done" role="status"><Icon name="check" size={15} /> Imported: {appliedText(done)}.</p> : null}

      {result ? (
        <div className="gw-import__result" aria-live="polite">
          {result.ok ? (
            <>
              <h3>Ready to import: {importSummaryText(result.summary)}</h3>
              <Preview result={result} />
              {result.summary.update ? (
                <label className="gw-import__check">
                  <input type="checkbox" checked={updateExisting} onChange={(event) => setUpdateExisting(event.target.checked)} />
                  Also update the {result.summary.update} {result.summary.update === 1 ? 'entry' : 'entries'} already on the wishlist
                </label>
              ) : null}
              <div className="gw-import__row">
                <button type="button" className="gw-btn gw-btn--sm gw-btn--primary" onClick={() => commit(false)} disabled={busy || !changes}>
                  {changes ? `Import ${result.summary.add + (updateExisting ? result.summary.update : 0)} item${result.summary.add + (updateExisting ? result.summary.update : 0) === 1 ? '' : 's'}` : 'Nothing new to import'}
                </button>
                <span className="gw-muted">Existing wishlist items it does not mention are kept.</span>
              </div>
            </>
          ) : (
            <>
              <h3>Not imported: {result.errors.length} problem{result.errors.length === 1 ? '' : 's'} found</h3>
              <p className="gw-muted">Nothing was changed. Copy the repair prompt, paste it into the same AI conversation, then paste its corrected JSON here.</p>
              <div className="gw-import__row">
                <CopyButton label="Copy repair prompt" primary load={async () => result.repairPrompt} onManual={(value) => setManual({ title: 'Repair prompt', value })} />
                {result.partialPossible ? (
                  <button type="button" className="gw-btn gw-btn--sm" onClick={() => commit(true)} disabled={busy}>
                    Import the {result.entries.length} valid item{result.entries.length === 1 ? '' : 's'}, skip {result.summary.invalid}
                  </button>
                ) : null}
              </div>
              <ErrorList title="Format problems" errors={errors.format} />
              <ErrorList title="Items Guildweaver does not know" errors={errors.catalog}
                note="The JSON may be fine: these ids are not in Guildweaver's catalog, or do not match the name given. An AI should replace or drop them, never invent an id." />
              {result.entries.length ? <><h4>Valid items</h4><Preview result={result} /></> : null}
            </>
          )}
        </div>
      ) : null}
    </Panel>
  )
}
