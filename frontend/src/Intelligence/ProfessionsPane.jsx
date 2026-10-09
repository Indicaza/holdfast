import { useMemo, useState } from 'react'

import WowIcon from '../WowAssets/WowIcon.jsx'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import './ProfessionsPane.css'

// Modeled on the in-game Professions window: an overview of every profession,
// and a rail of buttons on the right that opens each profession's recipe book.

const OVERVIEW_ICON = 136241 // Trade_BlackSmithing, the Professions book icon
// Secondary professions by skill line (Cooking, Fishing, First Aid,
// Archaeology). Older snapshots label every other profession "secondary", so
// that generic kind is not trusted.
const SECONDARY_SKILL_LINES = new Set([185, 356, 129, 794])
const SECONDARY_KINDS = new Set(['cooking', 'fishing', 'first_aid', 'archaeology'])

const RANKS = [
  [75, 'Apprentice'],
  [150, 'Journeyman'],
  [225, 'Expert'],
  [300, 'Artisan'],
]

const BAR_THEMES = {
  alchemy: 'alchemy',
  blacksmithing: 'blacksmithing',
  cooking: 'cooking',
  enchanting: 'enchanting',
  engineering: 'engineering',
  'first aid': 'first-aid',
  fishing: 'fishing',
  herbalism: 'herbalism',
  leatherworking: 'leatherworking',
  mining: 'mining',
  skinning: 'skinning',
  tailoring: 'tailoring',
}

const DIFFICULTY_LABELS = {
  optimal: 'Optimal',
  medium: 'Medium',
  easy: 'Easy',
  trivial: 'Trivial',
}

function rankTitle(maxSkill) {
  const max = Number(maxSkill) || 0
  if (!max) return ''
  return (RANKS.find(([cap]) => max <= cap) || [0, 'Master'])[1]
}

function isSecondary(profession) {
  return SECONDARY_SKILL_LINES.has(Number(profession?.skillLineId ?? profession?.id))
    || SECONDARY_KINDS.has(String(profession?.kind || '').toLowerCase())
}

function recipesFor(profession, recipes) {
  const name = String(profession?.name || '').toLowerCase()
  return recipes.filter((recipe) =>
    (profession.key && recipe.professionKey === profession.key)
    || (!recipe.professionKey && String(recipe.professionName || '').toLowerCase() === name),
  )
}

function SkillBar({ profession, compact = false }) {
  const current = Number(profession?.current) || 0
  const max = Number(profession?.max) || 0
  const percent = max > 0 ? Math.min(100, (current / max) * 100) : 0
  const theme = BAR_THEMES[String(profession?.name || '').toLowerCase()] || 'default'
  return (
    <div className={`prof-bar prof-bar--${theme}${compact ? ' prof-bar--compact' : ''}`}>
      <span className="prof-bar__fill" style={{ width: `${percent}%` }} />
      <span className="prof-bar__text">
        {profession?.name} {current}/{max || '?'}
        {Number(profession?.modifier) ? <em> (+{profession.modifier})</em> : null}
      </span>
    </div>
  )
}

function ProfessionIdentity({ profession, onOpen }) {
  return (
    <button type="button" className="prof-identity" onClick={() => onOpen?.(profession.key)}>
      <WowIcon iconFileId={profession.iconFileId} label={profession.name} size={36} />
      <span>
        <strong>{profession.name}</strong>
        <small>{rankTitle(profession.max)}</small>
      </span>
    </button>
  )
}

function Overview({ professions, onOpen }) {
  const primary = professions.filter((profession) => !isSecondary(profession))
  const secondary = professions.filter(isSecondary)
  return (
    <div className="prof-overview">
      {primary.map((profession) => (
        <section className="prof-panel prof-panel--primary" key={profession.key}>
          <h3 className="prof-panel__title">{profession.name}</h3>
          <div className="prof-panel__row">
            <ProfessionIdentity profession={profession} onOpen={onOpen} />
            <SkillBar profession={profession} />
          </div>
        </section>
      ))}
      {secondary.length ? (
        <div className="prof-overview__secondary">
          {secondary.map((profession) => (
            <section className="prof-panel prof-panel--secondary" key={profession.key}>
              <h3 className="prof-panel__title">{profession.name}</h3>
              <SkillBar profession={profession} compact />
              <ProfessionIdentity profession={profession} onOpen={onOpen} />
            </section>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function RecipeDetail({ recipe }) {
  // Captured once per mount so render stays pure; cooldowns are minute-rounded.
  const [now] = useState(() => Date.now())
  if (!recipe) {
    return <div className="prof-detail prof-detail--empty">Select a recipe.</div>
  }
  const crafted = recipe.crafted
  const reagents = Array.isArray(recipe.reagents) ? recipe.reagents : []
  const tools = Array.isArray(recipe.tools) ? recipe.tools : []
  return (
    <div className="prof-detail">
      <header className="prof-detail__head">
        <WowIcon iconFileId={recipe.iconFileId ?? crafted?.iconFileDataId} label={recipe.name} size={48} />
        <div>
          <h4 className={`prof-difficulty--${recipe.difficulty || 'none'}`}>{recipe.name}</h4>
          {tools.length ? <p className="prof-detail__requires">Requires: {tools.map((tool) => tool.name).join(', ')}</p> : null}
        </div>
      </header>
      {recipe.description ? <p className="prof-detail__description">{recipe.description}</p> : null}
      {reagents.length ? (
        <section className="prof-detail__section">
          <h5>Reagents:</h5>
          <ul className="prof-reagents">
            {reagents.map((reagent, index) => (
              <li key={`${reagent.itemId || reagent.name}-${index}`}>
                <WowIcon iconFileId={reagent.iconFileId} itemId={reagent.itemId} label={reagent.name} size={36} />
                <span>{reagent.quantity || 1} {reagent.name || `Item ${reagent.itemId}`}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {crafted ? (
        <section className="prof-detail__section">
          <h5>Creates:</h5>
          <div className="prof-crafted">
            <WowIcon iconFileId={crafted.iconFileDataId} itemId={crafted.itemId} label={crafted.name} size={36} />
            <span className={`item-quality-${crafted.qualityId ?? 1}`}>
              {crafted.maxQuantity > 1 ? `${crafted.minQuantity || 1}-${crafted.maxQuantity} ` : ''}{crafted.name || `Item ${crafted.itemId}`}
            </span>
          </div>
        </section>
      ) : null}
      <footer className="prof-detail__foot">
        {recipe.difficulty ? <span className={`prof-difficulty--${recipe.difficulty}`}>{DIFFICULTY_LABELS[recipe.difficulty] || recipe.difficulty}</span> : null}
        {recipe.known === false ? <span>Not learned</span> : null}
        {recipe.cooldown?.readyAt * 1000 > now ? <span>Cooldown until {new Date(recipe.cooldown.readyAt * 1000).toLocaleString()}</span> : null}
      </footer>
    </div>
  )
}

function RecipeBook({ profession, recipes }) {
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState(null)
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return recipes
      .filter((recipe) => !needle || [recipe.name, recipe.crafted?.name, recipe.craftedItemName].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .sort((left, right) => String(left.name).localeCompare(String(right.name)))
  }, [query, recipes])
  const groups = [
    ['Known', visible.filter((recipe) => recipe.known !== false)],
    ['Not learned', visible.filter((recipe) => recipe.known === false)],
  ].filter(([, entries]) => entries.length)
  const selected = visible.find((recipe) => (recipe.key || recipe.id) === selectedKey) || visible[0] || null

  return (
    <div className="prof-book">
      <SkillBar profession={profession} />
      {recipes.length ? (
        <div className="prof-book__body">
          <div className="prof-book__list">
            <input
              className="prof-book__search"
              type="search"
              placeholder="Search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={`Search ${profession.name} recipes`}
            />
            <div className="prof-book__groups">
              {groups.map(([label, entries]) => (
                <section key={label}>
                  <h4 className="prof-book__group">{label}</h4>
                  <ul>
                    {entries.map((recipe) => {
                      const key = recipe.key || recipe.id
                      return (
                        <li key={key}>
                          <button
                            type="button"
                            className={`prof-recipe prof-difficulty--${recipe.difficulty || 'none'}${selected && (selected.key || selected.id) === key ? ' is-selected' : ''}`}
                            onClick={() => setSelectedKey(key)}
                          >
                            {recipe.name}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
              {!visible.length ? <p className="prof-book__none">No recipes match.</p> : null}
            </div>
          </div>
          <RecipeDetail recipe={selected} />
        </div>
      ) : (
        <div className="prof-book__waiting">
          <p>No recipes synced for {profession.name} yet.</p>
          <small>Open {profession.name} in game once and Guildweaver will capture the recipe book.</small>
        </div>
      )}
    </div>
  )
}

export default function ProfessionsPane({ professions = [], recipes = [] }) {
  const [view, setView] = useState('overview')
  const ordered = useMemo(() => {
    const keyed = professions.map((profession) => ({
      ...profession,
      key: profession.key || `name:${String(profession.name || '').toLowerCase()}`,
    }))
    return [...keyed.filter((profession) => !isSecondary(profession)), ...keyed.filter(isSecondary)]
  }, [professions])
  const active = ordered.find((profession) => profession.key === view) || null

  if (!professions.length) {
    return <EmptyTelemetry title="No profession telemetry yet.">Professions will appear after this character's next Guildweaver sync.</EmptyTelemetry>
  }

  return (
    <div className="professions-pane">
      <div className="professions-pane__page">
        <header className="professions-pane__title">{active ? active.name : 'Professions'}</header>
        <div className="professions-pane__content">
          {active
            ? <RecipeBook key={active.key} profession={active} recipes={recipesFor(active, recipes)} />
            : <Overview professions={ordered} onOpen={setView} />}
        </div>
      </div>
      <nav className="professions-pane__rail" aria-label="Profession pages">
        <button
          type="button"
          className={`prof-rail-button${!active ? ' is-active' : ''}`}
          onClick={() => setView('overview')}
          aria-pressed={!active}
          title="Professions overview"
        >
          <WowIcon iconFileId={OVERVIEW_ICON} label="Professions" size={40} />
        </button>
        {ordered.map((profession) => (
          <button
            type="button"
            key={profession.key}
            className={`prof-rail-button${active?.key === profession.key ? ' is-active' : ''}`}
            onClick={() => setView(profession.key)}
            aria-pressed={active?.key === profession.key}
            title={profession.name}
          >
            <WowIcon iconFileId={profession.iconFileId} label={profession.name} size={40} />
          </button>
        ))}
      </nav>
    </div>
  )
}
