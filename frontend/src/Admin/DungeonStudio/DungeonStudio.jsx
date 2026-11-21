import { useCallback, useEffect, useMemo, useState } from 'react'

import { apiJson } from '../../Api/apiClient.js'
import { runAuthenticatedMutation } from '../../Auth/authenticatedMutation.js'
import { useSession } from '../../Auth/sessionContext.js'
import { Badge, Button, Panel, TextInput } from '../../DesignSystem/index.js'
import PageShell from '../../PageShell/PageShell.jsx'
import QuestPlanEditor from './QuestPlanEditor.jsx'
import { FieldRow } from './StudioFields.jsx'
import { clearOverride, displayValue, isDirty, overrideOf, problemsAt, scopeOf, setOverride, setOverrideMeta } from './studioModel.js'
import '../Admin.css'
import './DungeonStudio.css'

const API = '/api/admin/atlas-studio'
const TABS = [['dungeon', 'Dungeon'], ['bosses', 'Bosses'], ['quests', 'Quests'], ['history', 'History']]

function AdminNav() {
  return (
    <nav className="admin-nav" aria-label="Admin sections">
      <a href="/admin">Audit</a>
      <a href="/admin/guildweaver">Guildweaver</a>
      <a href="/admin/dungeons" aria-current="page">Dungeon content</a>
    </nav>
  )
}

function Gate({ session }) {
  const shell = (title, intro, children = null) => (
    <PageShell eyebrow="Dungeon Content Studio" title={title} intro={intro} centered className="admin-page admin-page--gate">{children}</PageShell>
  )
  if (session.status === 'loading') return shell('Checking credentials', 'Verifying administrative access.')
  if (session.status === 'error') return shell('Backend unavailable', 'Holdfast could not verify your session.', <div className="admin-auth"><button className="admin-auth__primary" type="button" onClick={() => session.refresh()}>Retry connection</button></div>)
  if (!session.authenticated) return shell('Sign in with Discord', 'Website administration access is required.', <div className="admin-auth"><button className="admin-auth__primary" type="button" onClick={() => session.signIn()}>Continue with Discord</button></div>)
  return shell('No admin access', 'This account does not have website administration access.')
}

function useMutate() {
  const session = useSession()
  return useCallback((url, method, body) => runAuthenticatedMutation({
    request: () => apiJson(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    refresh: session.refresh,
    reauthenticate: () => session.signIn(window.location.pathname + window.location.search),
  }), [session])
}

function StudioList() {
  const [state, setState] = useState({ status: 'loading', dungeons: [] })
  const [find, setFind] = useState('')
  useEffect(() => {
    let active = true
    apiJson(`${API}/dungeons`).then((data) => { if (active) setState({ status: 'ready', dungeons: data.dungeons }) })
      .catch((error) => { if (active) setState({ status: 'error', dungeons: [], error }) })
    return () => { active = false }
  }, [])
  const shown = state.dungeons.filter((dungeon) => !find || dungeon.name.toLowerCase().includes(find.toLowerCase()) || String(dungeon.instanceId) === find.trim())
  return (
    <Panel title="Dungeons" actions={<TextInput label="Find a dungeon" hideLabel placeholder="Find a dungeon" size="sm" value={find} onChange={(event) => setFind(event.target.value)} />}>
      {state.status === 'loading' ? <p className="studio-muted">Loading the atlas…</p> : null}
      {state.status === 'error' ? <p className="studio-inline-error" role="alert">The dungeon list could not be loaded.</p> : null}
      <table className="studio-table">
        <thead><tr><th>Dungeon</th><th>Origin</th><th>Levels</th><th>Bosses</th><th>Editorial</th></tr></thead>
        <tbody>
          {shown.map((dungeon) => (
            <tr key={dungeon.instanceId}>
              <td><a className="studio-link" href={`/admin/dungeons/${dungeon.instanceId}`}>{dungeon.name}</a> <span className="studio-muted">{dungeon.instanceId}</span></td>
              <td>{dungeon.origin === 'forever' ? 'WoW Forever' : 'Classic'}</td>
              <td>{dungeon.levelMin ? `${dungeon.levelMin}–${dungeon.levelMax}` : '—'}</td>
              <td>{dungeon.bossCount}</td>
              <td className="studio-badges">
                {dungeon.published ? <Badge tone="success">Published r{dungeon.published.number}</Badge> : null}
                {dungeon.draft ? <Badge tone="gold">Draft v{dungeon.draft.version}</Badge> : null}
                {!dungeon.published && !dungeon.draft ? <span className="studio-muted">Imported only</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

const resolutionOf = (validation, path, key) => (path[0] === 'dungeon'
  ? validation?.resolution?.dungeon?.[key]
  : validation?.resolution?.bosses?.find((boss) => boss.key === path[1])?.fields?.[key]) || null

// The fields of one scope (the dungeon or a boss).
export function FieldList({ fields, path, document, setDocument, validation, schema, bosses, extras = {} }) {
  const scope = scopeOf(document, path)
  const prefix = path[0] === 'dungeon' ? 'dungeon' : `bosses.${path[1]}`
  return fields.map((field) => (
    <FieldRow key={field.key} field={field} override={overrideOf(scope, field.key)} resolution={resolutionOf(validation, path, field.key)}
      problems={problemsAt(validation, `${prefix}.${field.key}`)} schema={schema} bosses={bosses}
      onOverride={(value) => setDocument((current) => setOverride(current, path, field.key, value))}
      onChange={(value) => setDocument((current) => setOverride(current, path, field.key, value))}
      onMeta={(meta) => setDocument((current) => setOverrideMeta(current, path, field.key, meta))}
      onClear={() => setDocument((current) => clearOverride(current, path, field.key))}
      renderMedia={extras.renderMedia} renderImported={extras.renderImported?.(field)} />
  ))
}

function ImportedAbilities({ boss }) {
  if (!boss?.abilities?.length) return <p className="studio-muted">No imported abilities for this boss.</p>
  return (
    <ul className="studio-abilities">
      {boss.abilities.map((ability) => (
        <li key={ability.spellId || ability.name}>
          <strong>{ability.name}</strong> <span className="studio-muted">{ability.category} · {ability.priority}{ability.verifiedForForever ? '' : ' · Classic reference, not verified for Forever'}</span>
        </li>
      ))}
    </ul>
  )
}

function History({ data, onRollback, busy }) {
  return (
    <div className="studio-history">
      <Panel title="Revisions" titleAs="h3">
        {data.revisions.length ? (
          <ol className="studio-revisions">
            {data.revisions.map((revision) => (
              <li key={revision.id}>
                <span><strong>r{revision.number}</strong> {revision.kind === 'rollback' ? 'rollback' : 'published'} by {revision.createdBy || 'unknown'} · {new Date(revision.createdAt).toLocaleString()}</span>
                {revision.note ? <span className="studio-muted"> — {revision.note}</span> : null}
                {data.active?.revision.id === revision.id ? <Badge tone="success">Active</Badge>
                  : <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRollback(revision)}>Roll back to this</Button>}
              </li>
            ))}
          </ol>
        ) : <p className="studio-muted">Nothing published yet.</p>}
      </Panel>
      <Panel title="Audit" titleAs="h3">
        <ol className="studio-revisions">
          {data.audit.map((entry) => (
            <li key={entry.id}><strong>{entry.action}</strong> <span className="studio-muted">{entry.actorName || entry.actorId} · {new Date(entry.at).toLocaleString()}</span></li>
          ))}
        </ol>
      </Panel>
    </div>
  )
}

// Hooks for later milestones: the media picker and the previews plug in here.
export function StudioEditor({ instanceId, extensions = {} }) {
  const mutate = useMutate()
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [document, setDocument] = useState(null)
  const [saved, setSaved] = useState(null)
  const [validation, setValidation] = useState(null)
  const [tab, setTab] = useState('dungeon')
  const [bossKey, setBossKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [note, setNote] = useState('')
  const [schema, setSchema] = useState(null)

  const load = useCallback(async () => {
    try {
      const [detail, nextSchema] = await Promise.all([apiJson(`${API}/dungeons/${instanceId}`), apiJson(`${API}/schema`)])
      setSchema(nextSchema)
      setData(detail)
      setDocument(detail.working)
      setSaved(detail.working)
      setValidation(detail.validation && { ...detail.validation, resolution: detail.resolution, addon: detail.addon })
    } catch (error) {
      setLoadError(error)
    }
  }, [instanceId])
  useEffect(() => { load() }, [load])

  // Live validation while editing (also the previews' data).
  useEffect(() => {
    if (!document || !data) return undefined
    const timer = setTimeout(() => {
      apiJson(`${API}/dungeons/${instanceId}/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document }) })
        .then(setValidation).catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [document, data, instanceId])

  const dirty = document && saved && isDirty(document, saved)
  const draftVersion = data?.draft?.version || 0

  async function run(action, success) {
    setBusy(true)
    setMessage(null)
    try {
      const result = await action()
      if (result) setMessage({ tone: 'success', text: success })
      await load()
    } catch (error) {
      const body = error?.body || {}
      const detail = body.problems?.[0]?.message || body.errors?.[0]?.message
      setMessage({ tone: 'error', text: error?.status === 409 ? 'Someone saved this draft after you opened it. Reload to see their changes.' : detail ? `Not saved: ${detail}` : 'That did not work. Try again.' })
    } finally {
      setBusy(false)
    }
  }
  const saveDraft = () => run(() => mutate(`${API}/dungeons/${instanceId}/draft`, 'PUT', { document, expectedVersion: draftVersion }), 'Draft saved.')
  const discard = () => run(() => mutate(`${API}/dungeons/${instanceId}/draft`, 'DELETE'), 'Draft discarded.')
  const publish = () => run(async () => {
    if (dirty) await mutate(`${API}/dungeons/${instanceId}/draft`, 'PUT', { document, expectedVersion: draftVersion })
    const fresh = await apiJson(`${API}/dungeons/${instanceId}`)
    const result = await mutate(`${API}/dungeons/${instanceId}/publish`, 'POST', { expectedVersion: fresh.draft?.version, note })
    setNote('')
    return result
  }, 'Published. The website serves this revision now; the add-on gets it with the next add-on export.')
  const rollback = (revision) => run(() => mutate(`${API}/dungeons/${instanceId}/rollback`, 'POST', { revisionId: revision.id }), `Rolled back to r${revision.number}.`)
  const unpublish = () => run(() => mutate(`${API}/dungeons/${instanceId}/unpublish`, 'POST', {}), 'Unpublished. The website shows imported data only.')

  const bosses = useMemo(() => {
    const imported = data?.imported?.bosses || []
    const order = validation?.resolution?.bosses?.map((boss) => boss.key) || imported.map((boss) => boss.key)
    const byKey = new Map(imported.map((boss) => [boss.key, boss]))
    return order.map((key) => byKey.get(key)).filter(Boolean)
  }, [data, validation])
  const selectedBoss = bosses.find((boss) => boss.key === bossKey) || bosses[0] || null

  if (loadError) return <Panel><p className="studio-inline-error" role="alert">{loadError.status === 404 ? 'The atlas has no such dungeon.' : 'This dungeon could not be loaded.'}</p></Panel>
  if (!data || !document || !schema) return <Panel><p className="studio-muted">Loading the editor…</p></Panel>

  const errors = validation?.errors?.length || 0
  const warnings = validation?.warnings?.length || 0
  const tabs = [...TABS.slice(0, 3), ...(extensions.tabs || []), TABS[3]]
  const shared = { document, setDocument, validation, schema, bosses, extras: extensions }

  return (
    <div className="studio">
      <header className="studio-head">
        <div>
          <p className="studio-eyebrow"><a className="studio-link" href="/admin/dungeons">All dungeons</a> · {data.imported.origin === 'forever' ? 'WoW Forever dungeon' : 'Classic dungeon'} · instance {instanceId}</p>
          <h2>{data.imported.name}</h2>
          <p className="studio-badges">
            {data.active ? <Badge tone="success">Published r{data.active.revision.number}</Badge> : <Badge>Not published</Badge>}
            {data.draft ? <Badge tone="gold">Draft v{data.draft.version}{data.draft.updatedBy ? ` · ${data.draft.updatedBy}` : ''}</Badge> : null}
            {dirty ? <Badge tone="arcane">Unsaved changes</Badge> : null}
            <Badge tone={errors ? 'danger' : 'success'}>{errors ? `${errors} error${errors === 1 ? '' : 's'}` : 'Valid'}</Badge>
            {warnings ? <Badge tone="gold">{warnings} warning{warnings === 1 ? '' : 's'}</Badge> : null}
            {validation ? <Badge>Add-on {validation.luaBytes} / {schema.addonLimits.dungeonBytes} bytes</Badge> : null}
          </p>
        </div>
        <div className="studio-actions">
          <Button variant="secondary" size="sm" disabled={busy || !dirty} onClick={saveDraft}>Save draft</Button>
          {data.draft ? <Button variant="ghost" size="sm" disabled={busy} onClick={discard}>Discard draft</Button> : null}
          <TextInput label="Publish note" hideLabel size="sm" placeholder="Publish note (optional)" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
          <Button variant="primary" size="sm" disabled={busy || errors > 0 || (!data.draft && !dirty)} onClick={publish}>Publish</Button>
          {data.active ? <Button variant="ghost" size="sm" disabled={busy} onClick={unpublish}>Unpublish</Button> : null}
        </div>
      </header>
      {message ? <p className={message.tone === 'error' ? 'studio-inline-error' : 'studio-inline-ok'} role="status">{message.text}</p> : null}
      {validation?.errors?.filter((entry) => !entry.path || entry.path === 'media').map((entry, index) => <p key={index} className="studio-inline-error">{entry.message}</p>)}

      <nav className="gw-seg studio-tabs" aria-label="Editor sections">
        {tabs.map(([id, label]) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}
      </nav>

      <div className={extensions.aside ? 'studio-body studio-body--aside' : 'studio-body'}>
        <div className="studio-main">
          {tab === 'dungeon' ? (
            <Panel title="Dungeon" titleAs="h3">
              <FieldList fields={schema.dungeonFields} path={['dungeon']} {...shared} />
            </Panel>
          ) : null}
          {tab === 'bosses' ? (
            <div className="studio-bosses">
              <nav aria-label="Bosses" className="studio-boss-nav">
                <ol>
                  {bosses.map((boss) => (
                    <li key={boss.key}>
                      <button type="button" aria-current={boss === selectedBoss ? 'true' : undefined} onClick={() => setBossKey(boss.key)}>
                        {boss.name}{document.bosses?.[boss.key] ? ' •' : ''}
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
              {selectedBoss ? (
                <Panel title={selectedBoss.name} titleAs="h3" eyebrow={[selectedBoss.npcId ? `NPC ${selectedBoss.npcId}` : null, selectedBoss.encounterId ? `encounter ${selectedBoss.encounterId}` : null, `key ${selectedBoss.key}`].filter(Boolean).join(' · ')}>
                  <h4 className="studio-subhead">Imported abilities (read-only)</h4>
                  <ImportedAbilities boss={selectedBoss} />
                  <FieldList key={selectedBoss.key} fields={schema.bossFields} path={['bosses', selectedBoss.key]} {...shared} />
                </Panel>
              ) : <Panel><p className="studio-muted">The atlas lists no bosses for this dungeon.</p></Panel>}
              {validation?.warnings?.filter((entry) => entry.code === 'orphan').map((entry, index) => <p key={index} className="studio-inline-warning">{entry.message}</p>)}
            </div>
          ) : null}
          {tab === 'quests' ? (
            <Panel title="Quests" titleAs="h3">
              <QuestPlanEditor document={document} onChange={setDocument} imported={data.imported} schema={schema} validation={validation} />
            </Panel>
          ) : null}
          {(extensions.tabs || []).map(([id]) => (tab === id ? <div key={id}>{extensions.renderTab(id, { data, document, validation, instanceId, bossKey: selectedBoss?.key || '' })}</div> : null))}
          {tab === 'history' ? <History data={data} onRollback={rollback} busy={busy} /> : null}
        </div>
        {extensions.aside ? <aside className="studio-aside">{extensions.aside({ data, document, validation, instanceId, bossKey: selectedBoss?.key || '' })}</aside> : null}
      </div>
      <p className="studio-muted studio-foot">Imported data ({displayValue(data.imported.provenance.map((line) => line.source))}) is never changed here: edits are an override layer, kept across atlas imports.</p>
    </div>
  )
}

export default function DungeonStudio({ instanceId = null, extensions = {} }) {
  const session = useSession()
  if (!(session.authenticated && session.hasPermission('site.admin'))) return <Gate session={session} />
  return (
    <PageShell eyebrow="Dungeon Content Studio" title={instanceId ? 'Edit dungeon' : 'Dungeon content'} intro="Editorial content for the Dungeon Atlas and the add-on journal, layered over the imported data." className="admin-page studio-page">
      <AdminNav />
      {instanceId ? <StudioEditor key={instanceId} instanceId={instanceId} extensions={extensions} /> : <StudioList />}
    </PageShell>
  )
}
