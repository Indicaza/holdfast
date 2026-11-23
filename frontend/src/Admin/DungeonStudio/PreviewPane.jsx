import { useEffect, useState } from 'react'

import { apiJson } from '../../Api/apiClient.js'
import DungeonDetailModal from '../../Player/Dungeons/DungeonDetailModal.jsx'
import { ItemLabel } from '../../Player/ui.jsx'
import '../../Player/Player.css'
import '../../Player/PlayerApp.css'

const API = '/api/admin/atlas-studio'
const TYPE_LABEL = { interrupt: 'Interrupt', dispel: 'Dispel', positioning: 'Positioning', 'tank-danger': 'Tank danger', 'healer-danger': 'Healer danger', 'crowd-control': 'Crowd control', 'special-mechanic': 'Mechanic' }

// The website's real dungeon view, drawn in place from the draft's detail.
function WebsitePreview({ instanceId, detail, bossKey }) {
  const [view, setView] = useState({ section: 'journal', boss: '', allLoot: false })
  const [followed, setFollowed] = useState(bossKey)
  // Follow the boss being edited.
  if (bossKey !== followed) {
    setFollowed(bossKey)
    if (bossKey) setView({ section: 'journal', boss: bossKey, allLoot: false })
  }
  return (
    <div className="gw-embed studio-preview-site">
      <DungeonDetailModal instanceId={String(instanceId)} previewDetail={detail} embedded section={view.section} boss={view.boss} allLoot={view.allLoot}
        onNavigate={({ section = '', boss = '', allLoot = false }) => setView({ section: section || 'journal', boss, allLoot })} onClose={() => {}} showMapLink={false} />
    </div>
  )
}

function Lines({ title, lines }) {
  if (!lines?.length) return null
  return <div className="sim-block"><h5>{title}</h5><ul>{lines.map((line) => <li key={line}>{line}</li>)}</ul></div>
}

// A browser simulation of the add-on's Dungeon Journal, from the same data
// the add-on export writes. Not the game: layout and fonts are approximate.
function AddonPreview({ model, bossKey }) {
  const [tab, setTab] = useState('overview')
  const [picked, setPicked] = useState('')
  const boss = model.bosses.find((entry) => entry.key === (picked || bossKey)) || model.bosses[0] || null
  return (
    <div className="sim gw-embed" aria-label="Add-on journal simulation">
      <p className="sim-label">Simulation of the add-on journal. Built with the add-on export's rules; the game's rendering may differ.</p>
      <div className="sim-frame">
        <div className="sim-card" style={model.card.packaged ? { backgroundImage: `url("${model.card.url}")`, backgroundPosition: `${model.card.focusX * 100}% ${model.card.focusY * 100}%` } : undefined}>
          <div className="sim-card__text">
            <strong>{model.name}</strong>
            {model.subtitle ? <span>{model.subtitle}</span> : null}
            <span className="sim-dim">{[model.zone, model.levelMin ? `Level ${model.levelMin}${model.levelMax && model.levelMax !== model.levelMin ? `-${model.levelMax}` : ''}` : null].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
        <p className="sim-note">{model.card.note || (model.card.reason === 'none' ? 'No card art: the journal shows its default card.' : '')}</p>
        <div className="sim-tabs">
          {[['overview', 'Overview'], ['bosses', 'Bosses'], ['quests', 'Quests'], ['map', 'Map']].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        {tab === 'overview' ? (
          <div className="sim-body">
            {model.description ? <p>{model.description}</p> : <p className="sim-dim">No description.</p>}
            <Lines title="Warnings" lines={model.warnings} />
            <Lines title="Preparation" lines={model.preparation} />
            <Lines title="Tips" lines={model.tips} />
            {model.groupComposition ? <div className="sim-block"><h5>Group</h5><p>{model.groupComposition}</p></div> : null}
            {model.routeNotes ? <div className="sim-block"><h5>Route</h5><p>{model.routeNotes}</p></div> : null}
            {model.entrance ? <p className="sim-dim">Entrance: map {model.entrance.m} at {(model.entrance.x / 10).toFixed(1)}, {(model.entrance.y / 10).toFixed(1)}</p> : null}
            {model.attribution ? <p className="sim-dim">{model.attribution}</p> : null}
          </div>
        ) : null}
        {tab === 'bosses' ? (
          <div className="sim-bosses">
            <ol className="sim-sidebar">
              {model.bosses.map((entry) => (
                <li key={entry.key}>
                  <button type="button" aria-pressed={entry === boss} onClick={() => setPicked(entry.key)}>
                    {entry.portrait.packaged ? <img src={entry.portrait.url} alt="" style={{ objectPosition: `${entry.portrait.focusX * 100}% ${entry.portrait.focusY * 100}%` }} /> : <span className="sim-portrait">{entry.name.slice(0, 1)}</span>}
                    {entry.name}
                  </button>
                </li>
              ))}
            </ol>
            {boss ? (
              <div className="sim-body">
                <h4>{boss.name}</h4>
                <p className="sim-note">{boss.portrait.note}</p>
                {boss.text.description ? <p>{boss.text.description}</p> : null}
                {boss.mechanics.length ? (
                  <div className="sim-block">
                    <h5>Mechanics</h5>
                    {boss.mechanics.map((mechanic, index) => (
                      <div key={index} className={`sim-callout sim-callout--${mechanic.p}`}>
                        <strong>{mechanic.a}</strong> <span className="sim-dim">{TYPE_LABEL[mechanic.t] || mechanic.t}{mechanic.r ? ` · ${mechanic.r}` : ''}{mechanic.v ? ' · verified' : ''}</span>
                        {mechanic.i ? <p>{mechanic.i}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {[['strategy', 'Strategy'], ['tank', 'Tank'], ['healer', 'Healer'], ['dps', 'Damage'], ['positioning', 'Positioning'], ['interrupts', 'Interrupts'], ['dispels', 'Dispels']].filter(([key]) => boss.text[key]).map(([key, label]) => (
                  <div key={key} className="sim-block"><h5>{label}</h5><p>{boss.text[key]}</p></div>
                ))}
                {boss.abilities.length ? (
                  <div className="sim-block">
                    <h5>Abilities</h5>
                    <ul>{boss.abilities.map((ability) => <li key={ability.spellId}>{ability.name} <span className="sim-dim">{ability.category}{ability.summary ? ` · ${ability.summary}` : ''}{ability.verified ? '' : ' · Classic reference'}</span></li>)}</ul>
                  </div>
                ) : null}
                <div className="sim-block">
                  <h5>Loot</h5>
                  {boss.loot.length ? <ul className="sim-loot">{boss.loot.map((item) => <li key={item.itemId}><ItemLabel item={item} /></li>)}</ul> : <p className="sim-dim">No loot listed.</p>}
                </div>
              </div>
            ) : <p className="sim-dim">No bosses.</p>}
          </div>
        ) : null}
        {tab === 'quests' ? (
          <div className="sim-body">
            {model.quests.length ? <ul>{model.quests.map((quest) => <li key={quest.id}>{quest.name} <span className="sim-dim">{quest.minLevel || quest.level ? `level ${quest.minLevel || quest.level}` : ''}</span></li>)}</ul> : <p className="sim-dim">No quest list for this dungeon.</p>}
            {model.questsTotal > model.quests.length ? <p className="sim-dim">The add-on keeps the first {model.quests.length} of {model.questsTotal}.</p> : null}
            {model.questNotes ? <div className="sim-block"><h5>Notes</h5><p>{model.questNotes}</p></div> : null}
          </div>
        ) : null}
        {tab === 'map' ? (
          <div className="sim-body"><p className="sim-dim">{model.map.kind === 'spawn-layout' ? `The journal draws the spawn layout (${model.map.points} positions) when the client has no map for this dungeon.` : model.map.note}</p></div>
        ) : null}
      </div>
    </div>
  )
}

// Both previews, refreshed from the draft as it is edited (nothing stored).
export default function PreviewPane({ instanceId, document, bossKey }) {
  const [mode, setMode] = useState('website')
  const [state, setState] = useState({ status: 'loading', data: null })
  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      apiJson(`${API}/dungeons/${instanceId}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document }) })
        .then((data) => { if (active) setState({ status: 'ready', data }) })
        .catch(() => { if (active) setState((current) => ({ ...current, status: 'error' })) })
    }, 350)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [instanceId, document])
  return (
    <section className="studio-preview" aria-label="Preview">
      <div className="studio-preview__bar">
        <div className="studio-tabs" role="group" aria-label="Preview">
          <button type="button" aria-current={mode === 'website' ? 'page' : undefined} onClick={() => setMode('website')}>Website preview</button>
          <button type="button" aria-current={mode === 'addon' ? 'page' : undefined} onClick={() => setMode('addon')}>Add-on preview (simulation)</button>
        </div>
        {state.status === 'error' ? <span className="studio-inline-error">Preview failed</span> : null}
      </div>
      {!state.data ? <p className="studio-muted">Building the preview…</p> : mode === 'website'
        ? <WebsitePreview instanceId={instanceId} detail={state.data.website} bossKey={bossKey} />
        : <AddonPreview model={state.data.addon} bossKey={bossKey} />}
    </section>
  )
}
