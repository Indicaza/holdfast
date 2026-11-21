import { useState } from 'react'

import { Button, Select, TextArea, TextInput } from '../../DesignSystem/index.js'
import { linesToList, locationFrom, moveItem, newPlanQuest, parseIds, problemsAt, removeItem, replaceItem, setQuestPlan } from './studioModel.js'

function NpcEditor({ label, value, onChange }) {
  const current = value || {}
  const location = current.location || {}
  const [draft, setDraft] = useState({ mapId: location.mapId ?? '', x: location.x ?? '', y: location.y ?? '', zoneName: location.zoneName || '' })
  const commit = (patch) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    const where = locationFrom(next)
    const npc = { ...(current.name ? { name: current.name } : {}), ...(where ? { location: where } : {}) }
    onChange(Object.keys(npc).length ? npc : undefined)
  }
  const partial = (draft.mapId !== '' || draft.x !== '' || draft.y !== '') && !locationFrom(draft)
  return (
    <fieldset className="studio-npc">
      <legend>{label}</legend>
      <TextInput label="NPC name" maxLength={80} value={current.name || ''} onChange={(event) => {
        const name = event.target.value
        const npc = { ...(name ? { name } : {}), ...(current.location ? { location: current.location } : {}) }
        onChange(Object.keys(npc).length ? npc : undefined)
      }} />
      <div className="studio-grid studio-grid--4">
        <TextInput label="UiMap id" inputMode="numeric" value={draft.mapId} onChange={(event) => commit({ mapId: event.target.value })} />
        <TextInput label="x" inputMode="decimal" value={draft.x} onChange={(event) => commit({ x: event.target.value })} />
        <TextInput label="y" inputMode="decimal" value={draft.y} onChange={(event) => commit({ y: event.target.value })} />
        <TextInput label="Zone" value={draft.zoneName} onChange={(event) => commit({ zoneName: event.target.value })} />
      </div>
      {partial ? <p className="studio-inline-warning">Not a valid location yet: it is left out until mapId is a positive integer and x, y are 0–1.</p> : null}
    </fieldset>
  )
}

// The quest plan in the planner contract's shape (schema 1): entrance,
// instructions and per-quest metadata. Planning itself is the planner's.
export default function QuestPlanEditor({ document, onChange, imported, schema, validation }) {
  const plan = document.questPlan || {}
  const quests = plan.quests || []
  const instructions = plan.instructions || []
  const [adding, setAdding] = useState('')
  const catalog = imported.quests || []
  const names = new Map(catalog.map((quest) => [quest.questId, quest.name]))
  const update = (fn) => onChange(setQuestPlan(document, fn))
  const updateQuest = (index, patch) => update((next) => ({ ...next, quests: replaceItem(quests, index, Object.fromEntries(Object.entries({ ...quests[index], ...patch }).filter(([, value]) => value !== undefined && value !== ''))) }))
  const unused = catalog.filter((quest) => !quests.some((entry) => entry.questId === quest.questId))
  const entrance = plan.entrance || null

  return (
    <div className="studio-quests">
      <p className="studio-muted">Published as the planner's editorial quest document (schema 1). Empty fields inherit the quest catalog. Quest state and readiness are never edited here.</p>
      <section>
        <h3>Entrance for the planner</h3>
        {entrance ? (
          <>
            <NpcEditor label="Entrance" value={{ location: entrance }} onChange={(npc) => update((next) => ({ ...next, entrance: npc?.location ? { ...npc.location, verified: entrance.verified, source: entrance.source } : entrance }))} />
            <div className="studio-field__meta">
              <label className="studio-check"><input type="checkbox" checked={entrance.verified} onChange={(event) => update((next) => ({ ...next, entrance: { ...entrance, verified: event.target.checked } }))} /> Verified</label>
              <TextInput label="Source" size="sm" value={entrance.source || ''} onChange={(event) => update((next) => ({ ...next, entrance: { ...entrance, source: event.target.value } }))} />
              <Button size="sm" variant="ghost" onClick={() => update((next) => ({ ...next, entrance: undefined }))}>Clear override</Button>
            </div>
          </>
        ) : (
          <Button size="sm" onClick={() => update((next) => ({ ...next, entrance: { ...(imported.entrance || { mapId: imported.zoneMapId || 1, x: 0.5, y: 0.5 }), zoneName: imported.zoneName || undefined, verified: false, source: '' } }))}>
            Override the atlas entrance
          </Button>
        )}
      </section>
      <section>
        <h3>Instructions</h3>
        {instructions.map((entry, index) => (
          <div key={index} className="studio-grid studio-grid--instruction">
            <Select label="Section" value={entry.section} options={schema.questSections.map((section) => [section, section])}
              onChange={(event) => update((next) => ({ ...next, instructions: replaceItem(instructions, index, { ...entry, section: event.target.value }) }))} />
            <TextInput label="Text" maxLength={200} value={entry.text} onChange={(event) => update((next) => ({ ...next, instructions: replaceItem(instructions, index, { ...entry, text: event.target.value }) }))} />
            <label className="studio-check"><input type="checkbox" checked={entry.verified} onChange={(event) => update((next) => ({ ...next, instructions: replaceItem(instructions, index, { ...entry, verified: event.target.checked }) }))} /> Verified</label>
            <Button size="sm" variant="danger" onClick={() => update((next) => ({ ...next, instructions: removeItem(instructions, index) }))}>Remove</Button>
          </div>
        ))}
        <Button size="sm" onClick={() => update((next) => ({ ...next, instructions: [...instructions, { section: 'collect', text: '', verified: false, source: '' }] }))}>Add instruction</Button>
      </section>
      <section>
        <h3>Quests</h3>
        {quests.map((quest, index) => (
          <fieldset key={`${quest.questId}-${index}`} className="studio-mechanic" aria-label={`Quest ${quest.questId}`}>
            <div className="studio-mechanic__head">
              <strong>{names.get(quest.questId) || `Quest ${quest.questId}`}</strong>
              <span className="studio-muted">id {quest.questId}</span>
              <Button size="sm" variant="ghost" aria-label="Move quest up" disabled={index === 0} onClick={() => update((next) => ({ ...next, quests: moveItem(quests, index, -1) }))}>↑</Button>
              <Button size="sm" variant="ghost" aria-label="Move quest down" disabled={index === quests.length - 1} onClick={() => update((next) => ({ ...next, quests: moveItem(quests, index, 1) }))}>↓</Button>
              <Button size="sm" variant="danger" onClick={() => update((next) => ({ ...next, quests: removeItem(quests, index) }))}>Remove</Button>
            </div>
            <div className="studio-grid studio-grid--3">
              <Select label="Relevance" value={quest.relevance || ''} placeholder="Inherit" options={schema.questRelevance.map((value) => [value, value])} onChange={(event) => updateQuest(index, { relevance: event.target.value || undefined })} />
              <Select label="Shareable" value={quest.shareable || ''} placeholder="Inherit" options={schema.questShareable.map((value) => [value, value])} onChange={(event) => updateQuest(index, { shareable: event.target.value || undefined })} />
              <TextInput label="Prerequisites (ids)" hint="Replaces the catalog chain. Negative: in the log at the same time." value={(quest.prerequisites || []).join(', ')}
                onChange={(event) => updateQuest(index, { prerequisites: event.target.value.trim() ? parseIds(event.target.value) : undefined })} />
            </div>
            <NpcEditor label="Giver" value={quest.giver} onChange={(giver) => updateQuest(index, { giver })} />
            <NpcEditor label="Turn-in" value={quest.turnIn} onChange={(turnIn) => updateQuest(index, { turnIn })} />
            <TextArea label="Steps" hint="One per line, at most 200 characters each." rows={3} value={(quest.steps || []).map((step) => step.text).join('\n')}
              onChange={(event) => updateQuest(index, { steps: linesToList(event.target.value).map((text) => ({ text })) })} />
            <TextArea label="Notes" rows={2} maxLength={500} value={quest.notes || ''} onChange={(event) => updateQuest(index, { notes: event.target.value || undefined })} />
            <div className="studio-field__meta">
              <label className="studio-check"><input type="checkbox" checked={quest.verified} onChange={(event) => updateQuest(index, { verified: event.target.checked })} /> Verified</label>
              <TextInput label="Source" size="sm" value={quest.source || ''} onChange={(event) => updateQuest(index, { source: event.target.value })} />
            </div>
            {problemsAt(validation, `questPlan.quests[${index}]`).map((problem, position) => (
              <p key={position} className={problem.level === 'error' ? 'studio-inline-error' : 'studio-inline-warning'}>{problem.message}</p>
            ))}
          </fieldset>
        ))}
        <div className="studio-add-quest">
          <Select label="Add a catalog quest" value={adding} placeholder="Choose a quest" options={unused.map((quest) => [String(quest.questId), `${quest.name} (${quest.questId}${quest.relevance ? `, ${quest.relevance}` : ''})`])}
            onChange={(event) => setAdding(event.target.value)} />
          <Button size="sm" disabled={!adding} onClick={() => {
            update((next) => ({ ...next, quests: [...quests, newPlanQuest(Number(adding))] }))
            setAdding('')
          }}>Add quest</Button>
        </div>
        {problemsAt(validation, 'questPlan.quests').filter((problem) => problem.path === 'questPlan.quests').map((problem, index) => (
          <p key={index} className="studio-inline-error">{problem.message}</p>
        ))}
      </section>
    </div>
  )
}
