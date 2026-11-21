import { Badge, Button, Select, TextArea, TextInput } from '../../DesignSystem/index.js'
import {
  displayValue, fieldStatus, initialValue, linesToList, listToLines, locationFrom, mechanicId, moveItem, newMechanic, removeItem, replaceItem,
} from './studioModel.js'

const TIER_LABEL = {
  'forever-client': 'Forever client data',
  'forever-external': 'Forever reference, unverified',
  'classic-fallback': 'Classic fallback',
}

function LocationEditor({ value, onChange, label }) {
  const current = value || { mapId: '', x: '', y: '' }
  const update = (patch) => {
    const next = { ...current, ...patch }
    onChange(locationFrom(next) || next)
  }
  const valid = Boolean(locationFrom(current))
  return (
    <div className="studio-location">
      <TextInput label="UiMap id" inputMode="numeric" value={current.mapId ?? ''} onChange={(event) => update({ mapId: event.target.value === '' ? '' : Number(event.target.value) })} />
      <TextInput label="x (0–1)" inputMode="decimal" value={current.x ?? ''} onChange={(event) => update({ x: event.target.value === '' ? '' : Number(event.target.value) })} />
      <TextInput label="y (0–1)" inputMode="decimal" value={current.y ?? ''} onChange={(event) => update({ y: event.target.value === '' ? '' : Number(event.target.value) })} />
      <TextInput label="Zone" value={current.zoneName || ''} onChange={(event) => update({ zoneName: event.target.value })} />
      {!valid ? <p className="studio-inline-error" role="alert">{label}: mapId must be a positive integer, x and y between 0 and 1.</p> : null}
    </div>
  )
}

function BossOrderEditor({ value, bosses, onChange }) {
  const names = new Map(bosses.map((boss) => [boss.key, boss.name]))
  const order = [...value.filter((key) => names.has(key)), ...bosses.map((boss) => boss.key).filter((key) => !value.includes(key))]
  return (
    <ol className="studio-order">
      {order.map((key, index) => (
        <li key={key}>
          <span>{names.get(key) || key}</span>
          <Button size="sm" variant="ghost" aria-label={`Move ${names.get(key)} up`} disabled={index === 0} onClick={() => onChange(moveItem(order, index, -1))}>↑</Button>
          <Button size="sm" variant="ghost" aria-label={`Move ${names.get(key)} down`} disabled={index === order.length - 1} onClick={() => onChange(moveItem(order, index, 1))}>↓</Button>
        </li>
      ))}
    </ol>
  )
}

export function MechanicsEditor({ value, schema, onChange }) {
  const list = Array.isArray(value) ? value : []
  const update = (index, patch) => {
    const entry = { ...list[index], ...patch }
    if (patch.ability !== undefined && (!list[index].id || list[index].id.startsWith('mechanic-'))) {
      entry.id = mechanicId(patch.ability, list.filter((_, position) => position !== index).map((other) => other.id))
    }
    onChange(replaceItem(list, index, entry))
  }
  return (
    <div className="studio-mechanics">
      {list.map((mechanic, index) => (
        <fieldset key={index} className="studio-mechanic" aria-label={`Mechanic ${index + 1}${mechanic.ability ? `: ${mechanic.ability}` : ''}`}>
          <div className="studio-mechanic__head">
            <strong>{index + 1}. {mechanic.ability || 'New mechanic'}</strong>
            <span className="studio-muted">id {mechanic.id}</span>
            <Button size="sm" variant="ghost" aria-label="Move mechanic up" disabled={index === 0} onClick={() => onChange(moveItem(list, index, -1))}>↑</Button>
            <Button size="sm" variant="ghost" aria-label="Move mechanic down" disabled={index === list.length - 1} onClick={() => onChange(moveItem(list, index, 1))}>↓</Button>
            <Button size="sm" variant="danger" onClick={() => onChange(removeItem(list, index))}>Remove</Button>
          </div>
          <div className="studio-grid studio-grid--3">
            <TextInput label="Ability" value={mechanic.ability} maxLength={80} onChange={(event) => update(index, { ability: event.target.value })} />
            <Select label="Type" value={mechanic.type} options={schema.mechanicTypes.map((type) => [type, type])} onChange={(event) => update(index, { type: event.target.value })} />
            <Select label="Priority" value={mechanic.priority} options={schema.mechanicPriorities.map((priority) => [priority, priority])} onChange={(event) => update(index, { priority: event.target.value })} />
          </div>
          <TextArea label="Instruction" rows={2} maxLength={300} value={mechanic.instruction} onChange={(event) => update(index, { instruction: event.target.value })} />
          <div className="studio-roles" role="group" aria-label="Roles">
            {schema.roles.map((role) => (
              <label key={role} className="studio-check">
                <input type="checkbox" checked={mechanic.roles.includes(role)}
                  onChange={(event) => update(index, { roles: event.target.checked ? [...mechanic.roles, role] : mechanic.roles.filter((entry) => entry !== role) })} />
                {role}
              </label>
            ))}
            <label className="studio-check"><input type="checkbox" checked={mechanic.verified} onChange={(event) => update(index, { verified: event.target.checked })} /> Verified on Forever</label>
          </div>
          <TextInput label="Source" value={mechanic.source} maxLength={300} onChange={(event) => update(index, { source: event.target.value })} />
        </fieldset>
      ))}
      <Button size="sm" onClick={() => onChange([...list, newMechanic(list)])}>Add mechanic</Button>
    </div>
  )
}

function LootNotesEditor({ value, onChange }) {
  const list = Array.isArray(value) ? value : []
  return (
    <div className="studio-mechanics">
      {list.map((note, index) => (
        <div key={index} className="studio-grid studio-grid--loot">
          <TextInput label="Item id" inputMode="numeric" value={note.itemId || ''} onChange={(event) => onChange(replaceItem(list, index, { ...note, itemId: Number(event.target.value) || 0 }))} />
          <TextInput label="Note" maxLength={300} value={note.note} onChange={(event) => onChange(replaceItem(list, index, { ...note, note: event.target.value }))} />
          <Button size="sm" variant="danger" onClick={() => onChange(removeItem(list, index))}>Remove</Button>
        </div>
      ))}
      <Button size="sm" onClick={() => onChange([...list, { itemId: 0, note: '', verified: false, source: '' }])}>Add loot annotation</Button>
    </div>
  )
}

function ValueEditor({ field, value, onChange, schema, bosses, renderMedia }) {
  switch (field.kind) {
    case 'text':
      return <TextInput label={field.label} hideLabel maxLength={field.max} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
    case 'longtext':
      return <TextArea label={field.label} hideLabel rows={field.max > 1500 ? 6 : 3} maxLength={field.max} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
    case 'list':
      return <TextArea label={field.label} hideLabel rows={4} hint="One per line." value={listToLines(value)} onChange={(event) => onChange(linesToList(event.target.value))} />
    case 'int':
      return <TextInput label={field.label} hideLabel type="number" min={field.min} max={field.maxValue} value={value ?? ''} onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))} />
    case 'location':
      return <LocationEditor label={field.label} value={value} onChange={onChange} />
    case 'media':
      return renderMedia ? renderMedia({ field, value, onChange }) : <TextInput label={field.label} hideLabel placeholder="m_… media id" value={value ?? ''} onChange={(event) => onChange(event.target.value || null)} />
    case 'bossOrder':
      return <BossOrderEditor value={Array.isArray(value) ? value : []} bosses={bosses} onChange={onChange} />
    case 'mechanics':
      return <MechanicsEditor value={value} schema={schema} onChange={onChange} />
    case 'lootNotes':
      return <LootNotesEditor value={value} onChange={onChange} />
    default:
      return null
  }
}

// One editable field: the imported value on the left, the editorial value on
// the right, with inherit / override / clear override, verified and sources.
export function FieldRow({ field, override, resolution, problems, schema, bosses = [], onOverride, onChange, onMeta, onClear, renderMedia, renderImported }) {
  const status = fieldStatus(resolution)
  const imported = resolution?.imported ?? null
  return (
    <div className={`studio-field${override ? ' studio-field--override' : ''}`} data-field={field.key}>
      <div className="studio-field__label">
        <h4>{field.label}</h4>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <div className="studio-field__imported">
        <p className="studio-eyebrow">Imported{resolution?.importedTier ? ` · ${TIER_LABEL[resolution.importedTier] || resolution.importedTier}` : ''}</p>
        {renderImported ? renderImported(imported) : <p className="studio-imported-value">{displayValue(imported)}</p>}
      </div>
      <div className="studio-field__edit">
        <p className="studio-eyebrow">Editorial</p>
        {override ? (
          <>
            <ValueEditor field={field} value={override.value} onChange={onChange} schema={schema} bosses={bosses} renderMedia={renderMedia} />
            <div className="studio-field__meta">
              <label className="studio-check"><input type="checkbox" checked={override.verified} onChange={(event) => onMeta({ verified: event.target.checked })} /> Verified</label>
              <TextInput label="Source notes" size="sm" maxLength={300} value={override.source} onChange={(event) => onMeta({ source: event.target.value })} />
              <Button size="sm" variant="ghost" onClick={onClear}>Clear override</Button>
            </div>
          </>
        ) : (
          <div className="studio-field__inherit">
            <span className="studio-muted">Inherits the imported value.</span>
            <Button size="sm" onClick={() => onOverride(initialValue(field, imported))}>Override</Button>
          </div>
        )}
        {resolution?.conflict ? <p className="studio-inline-error">{resolution.reason}</p> : null}
        {problems.map((problem, index) => (
          <p key={index} className={problem.level === 'error' ? 'studio-inline-error' : 'studio-inline-warning'} role={problem.level === 'error' ? 'alert' : undefined}>{problem.message}</p>
        ))}
      </div>
    </div>
  )
}

