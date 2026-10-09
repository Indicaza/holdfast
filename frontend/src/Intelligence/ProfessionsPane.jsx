import { useMemo, useState } from 'react'

import WowIcon, { ItemHoverCard } from '../WowAssets/WowIcon.jsx'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import {
  MISSING_PRIMARY_TEXT,
  cooldownRemaining,
  itemTooltipIndex,
  overviewSlots,
  professionKey,
  railProfessions,
  rankText,
  rankTitle,
  recipeGroups,
  recipeKey,
  recipesFor,
  withItemTooltip,
} from './professionsModel.js'
import './ProfessionsPane.css'

// Modeled on WoW Forever's Professions window: the book page (two primary
// cards, then Cooking, Fishing and First Aid), a rail of side tabs on the right,
// and each profession's crafting page (recipe list and schematic form).

// INV_Misc_Book_11. The game's own side tab art (INV_SideTab_Professions_c60)
// is not on the public icon CDN.
const OVERVIEW_ICON = 133743

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

// Tooltips that are not items (side tabs, profession spells, enchants) reuse
// the item tooltip frame with just a name and an optional description.
function textTooltip(name, description = '') {
  return { name, qualityId: 1, description }
}

function themeOf(profession) {
  return BAR_THEMES[String(profession?.name || '').toLowerCase()] || 'default'
}

function RankBar({ profession, size = 'large' }) {
  const { current, modifier, max } = rankText(profession)
  const percent = max > 0 ? Math.min(100, (current / max) * 100) : 0
  return (
    <div
      className={`prof-bar prof-bar--${themeOf(profession)} prof-bar--${size}`}
      role="meter"
      aria-label={`${profession?.name} skill`}
      aria-valuemin={0}
      aria-valuemax={max || undefined}
      aria-valuenow={current}
    >
      <span className="prof-bar__fill" style={{ width: `${percent}%` }} />
      <span className="prof-bar__text">
        {current}{modifier ? <em> + {modifier}</em> : null}/{max || '?'}
      </span>
    </div>
  )
}

// ProfessionButtonTemplate: the profession spell, which opens its crafting page.
function SpellButton({ profession, onOpen }) {
  const content = (
    <>
      <WowIcon iconFileId={profession.iconFileId} label={profession.name} size={36} />
      <span>
        <strong>{profession.name}</strong>
        <small>{rankTitle(profession.max)}</small>
      </span>
    </>
  )
  const { current, modifier, max } = rankText(profession)
  const tooltip = textTooltip(profession.name, `${rankTitle(profession.max) || 'Skill'} ${current}${modifier ? ` + ${modifier}` : ''}/${max}`)
  return (
    <ItemHoverCard item={tooltip} side="top" tooltipClassName="prof-tooltip--text">
      {onOpen ? (
        <button type="button" className="prof-spell" onClick={() => onOpen(profession.key)} aria-label={`Open ${profession.name}`}>
          {content}
        </button>
      ) : (
        <div className="prof-spell prof-spell--static" tabIndex={0}>{content}</div>
      )}
    </ItemHoverCard>
  )
}

function Overview({ professions, openable, onOpen }) {
  const slots = overviewSlots(professions)
  const opener = (profession) => (openable.has(professionKey(profession)) ? onOpen : null)
  return (
    <div className="prof-overview">
      {slots.primary.map(({ placeholder, profession }) => (
        <section className={`prof-card prof-card--primary prof-card--${profession ? themeOf(profession) : 'missing'}`} key={placeholder}>
          {profession ? (
            <>
              <h3 className="prof-card__name">{profession.name}</h3>
              <RankBar profession={profession} />
              <SpellButton profession={{ ...profession, key: professionKey(profession) }} onOpen={opener(profession)} />
            </>
          ) : (
            <>
              <h3 className="prof-card__name">{placeholder}</h3>
              <p className="prof-card__missing">{MISSING_PRIMARY_TEXT}</p>
            </>
          )}
        </section>
      ))}
      <div className="prof-overview__secondary">
        {slots.secondary.map(({ name, missing, profession }) => (
          <section className={`prof-card prof-card--secondary prof-card--${profession ? themeOf(profession) : 'missing'}`} key={name}>
            <h3 className="prof-card__name">{name}</h3>
            {profession ? (
              <>
                <RankBar profession={profession} size="small" />
                <SpellButton profession={{ ...profession, key: professionKey(profession) }} onOpen={opener(profession)} />
              </>
            ) : (
              <p className="prof-card__missing">{missing}</p>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

function Schematic({ recipe, tooltips }) {
  // Captured once per mount so render stays pure; cooldowns are minute-rounded.
  const [now] = useState(() => Date.now())
  if (!recipe) {
    return <div className="prof-schematic prof-schematic--empty">Select a recipe.</div>
  }
  const crafted = recipe.crafted
  const reagents = Array.isArray(recipe.reagents) ? recipe.reagents : []
  const tools = Array.isArray(recipe.tools) ? recipe.tools : []
  const cooldown = cooldownRemaining(recipe.cooldown?.readyAt, now)
  const quantity = crafted?.maxQuantity > 1
    ? crafted.minQuantity && crafted.minQuantity !== crafted.maxQuantity ? `${crafted.minQuantity}-${crafted.maxQuantity}` : String(crafted.maxQuantity)
    : ''
  return (
    <div className="prof-schematic">
      <header className="prof-schematic__head">
        <ItemHoverCard item={crafted ? withItemTooltip(crafted, tooltips) : textTooltip(recipe.name, recipe.description)} tooltipClassName={crafted ? '' : 'prof-tooltip--text'}>
          <span className="prof-schematic__output" tabIndex={0}>
            <WowIcon
              iconFileId={crafted?.iconFileDataId ?? recipe.iconFileId}
              itemId={crafted?.itemId}
              label={recipe.name}
              quality={crafted?.qualityId}
              size={53}
            />
            {quantity ? <span className="prof-schematic__count">{quantity}</span> : null}
          </span>
        </ItemHoverCard>
        <div>
          <h4 className={crafted ? `item-quality-${crafted.qualityId ?? 1}` : 'prof-schematic__spell'}>{recipe.name}</h4>
          {recipe.known === false ? <p className="prof-schematic__unlearned">Unlearned</p> : null}
        </div>
      </header>
      {tools.length ? (
        <p className="prof-schematic__requires">
          <span>Requires:</span>{' '}
          {tools.map((tool, index) => (
            <span key={tool.name} className={tool.available === false ? 'is-unmet' : undefined}>
              {tool.name}{index < tools.length - 1 ? ', ' : ''}
            </span>
          ))}
        </p>
      ) : null}
      {cooldown ? <p className="prof-schematic__cooldown">Cooldown remaining: {cooldown}</p> : null}
      {recipe.description ? <p className="prof-schematic__description">{recipe.description}</p> : null}
      {reagents.length ? (
        <section className="prof-schematic__reagents">
          <h5>Reagents:</h5>
          <ul>
            {reagents.map((raw, index) => {
              const reagent = withItemTooltip(raw, tooltips)
              return (
                <li key={`${reagent.itemId || reagent.name}-${index}`}>
                  <ItemHoverCard item={reagent}>
                    <span className="prof-reagent" tabIndex={0}>
                      <span className="prof-reagent__icon">
                        <WowIcon iconFileId={reagent.iconFileId} itemId={reagent.itemId} label={reagent.name} quality={reagent.qualityId} size={37} />
                        <span className="prof-reagent__count">{reagent.quantity || 1}</span>
                      </span>
                      <span className={`prof-reagent__name item-quality-${reagent.qualityId ?? 1}`}>{reagent.name || `Item ${reagent.itemId}`}</span>
                    </span>
                  </ItemHoverCard>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function CraftingPage({ profession, recipes, tooltips }) {
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState(null)
  // The game hides unlearned recipes by default.
  const [collapsed, setCollapsed] = useState(() => new Set(['unlearned']))
  const groups = useMemo(() => recipeGroups(recipes, query), [recipes, query])
  const visible = groups.flatMap((group) => group.recipes)
  const selected = visible.find((recipe) => recipeKey(recipe) === selectedKey) || visible[0] || null
  const searching = Boolean(query.trim())

  const toggle = (id) => setCollapsed((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="prof-crafting">
      <RankBar profession={profession} />
      {recipes.length ? (
        <div className="prof-crafting__body">
          <div className="prof-list">
            <input
              className="prof-list__search"
              type="search"
              placeholder="Search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={`Search ${profession.name} recipes`}
            />
            <div className="prof-list__scroll">
              {groups.map((group) => {
                const open = searching || !collapsed.has(group.id)
                return (
                  <section key={group.id}>
                    <button
                      type="button"
                      className={`prof-list__header${open ? ' is-open' : ''}`}
                      onClick={() => toggle(group.id)}
                      aria-expanded={open}
                      disabled={searching}
                    >
                      <span>{group.label}</span>
                      <small>{group.recipes.length}</small>
                    </button>
                    {open ? (
                      <ul>
                        {group.recipes.map((recipe) => {
                          const key = recipeKey(recipe)
                          const isSelected = selected && recipeKey(selected) === key
                          return (
                            <li key={key}>
                              <button
                                type="button"
                                className={`prof-recipe prof-difficulty--${recipe.difficulty || 'none'}${isSelected ? ' is-selected' : ''}`}
                                onClick={() => setSelectedKey(key)}
                                aria-pressed={Boolean(isSelected)}
                                title={recipe.name}
                              >
                                <span>{recipe.name}</span>
                                {Number(recipe.skillUps) > 1 && recipe.difficulty !== 'trivial' ? <small>{recipe.skillUps}</small> : null}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    ) : null}
                  </section>
                )
              })}
              {!visible.length ? <p className="prof-list__none">No recipes match.</p> : null}
            </div>
          </div>
          <Schematic key={selected ? recipeKey(selected) : 'none'} recipe={selected} tooltips={tooltips} />
        </div>
      ) : (
        <div className="prof-crafting__waiting">
          <p>No recipes synced for {profession.name} yet.</p>
          <small>Open {profession.name} in game once and Guildweaver will capture the recipe book.</small>
        </div>
      )}
    </div>
  )
}

export default function ProfessionsPane({ professions = [], recipes = [] }) {
  const [view, setView] = useState('overview')
  const rail = useMemo(() => railProfessions(professions, recipes), [professions, recipes])
  const openable = useMemo(() => new Set(rail.map((profession) => profession.key)), [rail])
  const active = rail.find((profession) => profession.key === view) || null
  const tooltips = useMemo(() => itemTooltipIndex(recipes), [recipes])

  if (!professions.length) {
    return <EmptyTelemetry title="No profession telemetry yet.">Professions will appear after this character's next Guildweaver sync.</EmptyTelemetry>
  }

  return (
    <div className="professions-pane">
      <div className="professions-pane__page">
        <header className="professions-pane__title">
          <WowIcon iconFileId={active ? active.iconFileId : OVERVIEW_ICON} label={active ? active.name : 'Professions'} size={28} />
          <span>{active ? active.name : 'Professions'}</span>
        </header>
        <div className="professions-pane__content">
          {active
            ? <CraftingPage key={active.key} profession={active} recipes={recipesFor(active, recipes)} tooltips={tooltips} />
            : <Overview professions={professions} openable={openable} onOpen={setView} />}
        </div>
      </div>
      <nav className="professions-pane__rail" aria-label="Profession pages">
        <ItemHoverCard item={textTooltip('Professions')} side="left" tooltipClassName="prof-tooltip--text">
          <button
            type="button"
            className={`prof-rail-button${!active ? ' is-active' : ''}`}
            onClick={() => setView('overview')}
            aria-pressed={!active}
            aria-label="Professions"
          >
            <WowIcon iconFileId={OVERVIEW_ICON} label="Professions" size={40} />
          </button>
        </ItemHoverCard>
        {rail.map((profession) => (
          <ItemHoverCard key={profession.key} item={textTooltip(profession.name)} side="left" tooltipClassName="prof-tooltip--text">
            <button
              type="button"
              className={`prof-rail-button${active?.key === profession.key ? ' is-active' : ''}`}
              onClick={() => setView(profession.key)}
              aria-pressed={active?.key === profession.key}
              aria-label={profession.name}
              data-profession={profession.name}
            >
              <WowIcon iconFileId={profession.iconFileId} label={profession.name} size={40} />
            </button>
          </ItemHoverCard>
        ))}
      </nav>
    </div>
  )
}
