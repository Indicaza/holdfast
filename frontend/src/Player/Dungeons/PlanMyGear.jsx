import { useMemo, useState } from 'react'

import WishlistImport from '../WishlistImport.jsx'
import { FIT_COPY, MAX_PLAN_DUNGEONS, levelFit, levelText, planScope } from './atlasModel.js'

const MODES = [
  ['dungeon', 'Only this dungeon'],
  ['appropriate', 'Dungeons for my level'],
  ['pick', 'Choose dungeons'],
  ['all', 'Every dungeon'],
]

// Plan My Gear: the existing AI wishlist builder (copy prompt → paste
// JSON → check and preview → confirm), for a chosen character, with the
// planning prompt narrowed to one dungeon, every dungeon the character's
// level suits, dungeons the player picks, or everything.
export default function PlanMyGear({ character, characters = [], onCharacter = null, dungeon = null, dungeons = [], onImported, onClose }) {
  const fitting = useMemo(() => planScope('appropriate', { dungeons, character }), [dungeons, character])
  const modes = MODES.filter(([id]) => (id === 'dungeon' ? Boolean(dungeon) : id === 'appropriate' ? fitting.length > 0 : id === 'pick' ? dungeons.length > 1 : true))
  const [mode, setMode] = useState(modes[0][0])
  const [picked, setPicked] = useState(() => (dungeon ? [dungeon.instanceId] : fitting.slice(0, MAX_PLAN_DUNGEONS)))
  const [find, setFind] = useState('')

  const instanceIds = mode === 'dungeon' ? planScope('dungeon', { dungeon }) : mode === 'appropriate' ? fitting : mode === 'pick' ? picked : []
  const sorted = useMemo(() => dungeons.slice().sort((a, b) => (a.atlas?.levelMin ?? 999) - (b.atlas?.levelMin ?? 999) || String(a.name).localeCompare(String(b.name))), [dungeons])
  const query = find.trim().toLowerCase()
  const shown = query ? sorted.filter((entry) => String(entry.name || '').toLowerCase().includes(query)) : sorted
  const toggle = (id) => setPicked((current) => (current.includes(id) ? current.filter((value) => value !== id) : current.length >= MAX_PLAN_DUNGEONS ? current : [...current, id]))

  const header = characters.length > 1 && onCharacter ? (
    <label className="gw-filter gw-plan__character">
      <span>Plan for</span>
      <select value={character.id} onChange={(event) => onCharacter(event.target.value)} aria-label="Plan for character">
        {characters.map((option) => <option key={option.id} value={option.id}>{option.name}{option.level ? ` · ${option.level}` : ''}{option.className ? ` ${option.className}` : ''}</option>)}
      </select>
    </label>
  ) : null

  const scopeControl = (
    <fieldset className="gw-plan__scope">
      <legend>Dungeons in the prompt</legend>
      <div className="gw-seg gw-plan__modes" role="radiogroup" aria-label="Planning scope">
        {modes.map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)}>
            {id === 'dungeon' && dungeon ? `Only ${dungeon.name}` : id === 'appropriate' ? `${label} (${fitting.length})` : label}
          </button>
        ))}
      </div>
      {mode === 'pick' ? (
        <div className="gw-plan__picker">
          <input type="search" value={find} placeholder="Find a dungeon" aria-label="Find a dungeon to plan" onChange={(event) => setFind(event.target.value)} />
          <ul aria-label="Dungeons to plan">
            {shown.map((entry) => {
              const fit = levelFit(entry.atlas, character)
              return (
                <li key={entry.instanceId}>
                  <label>
                    <input type="checkbox" checked={picked.includes(entry.instanceId)} onChange={() => toggle(entry.instanceId)}
                      disabled={!picked.includes(entry.instanceId) && picked.length >= MAX_PLAN_DUNGEONS} />
                    {entry.name}
                    <span className="gw-muted">{levelText(entry.atlas)}</span>
                    {fit === 'fit' ? <span className={`gw-tag gw-tag--${FIT_COPY.fit.tone}`}>Your level</span> : null}
                  </label>
                </li>
              )
            })}
          </ul>
          <p className="gw-muted" role="status">{picked.length ? `${picked.length} chosen${picked.length >= MAX_PLAN_DUNGEONS ? ` (the most a prompt holds)` : ''}` : 'Choose at least one dungeon.'}</p>
        </div>
      ) : null}
    </fieldset>
  )

  return (
    <WishlistImport key={character.id} character={character} dungeon={dungeon} title="Plan my gear" header={header}
      instanceIds={instanceIds} scopeControl={scopeControl} copyDisabled={mode === 'pick' && !picked.length} onClose={onClose} onImported={onImported} />
  )
}
