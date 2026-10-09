import { useMemo, useState } from 'react'

import WowIcon, { ItemHoverCard } from '../WowAssets/WowIcon.jsx'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import {
  MISSING_PRIMARY_TEXT,
  cooldownRemaining,
  flattenRecipeTree,
  itemTooltipIndex,
  overviewSlots,
  professionKey,
  railProfessions,
  rankText,
  rankTitle,
  recipeCategoryTree,
  recipeKey,
  recipesFor,
  withItemTooltip,
} from './professionsModel.js'
import './ProfessionsPane.css'

// Modeled on WoW Forever's Professions window, using its own art (see
// public/profession-art/README.md): the book page (two primary cards, then
// Cooking, Fishing and First Aid), a rail of side tabs on the right, and each
// profession's crafting page (categorized recipe list and schematic form).

const ART = '/profession-art'
const SIDE_TAB_ICON = `${ART}/tab-professions.webp`

// Professions with their own card, crafting background and skill bar art.
const THEMES = {
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

function themeOf(profession) {
  return THEMES[String(profession?.name || '').toLowerCase()] || null
}

function art(name) {
  return `url("${ART}/${name}.webp")`
}

// Tooltips that are not items (side tabs, profession spells) reuse the item
// tooltip frame with a name and an optional description.
function textTooltip(name, description = '') {
  return { name, qualityId: 1, description }
}

// The recipe's own spell tooltip, as the client renders it.
function recipeTooltip(recipe) {
  if (!recipe) return null
  return {
    name: recipe.name,
    qualityId: 1,
    description: recipe.description,
    tooltip: recipe.tooltip,
    spellId: recipe.spellId ?? recipe.recipeId ?? recipe.id,
    iconFileId: recipe.iconFileId,
  }
}

// Hovering a recipe shows what it makes, as in game; enchants and other
// recipes without an item show the recipe spell instead.
function recipeHoverItem(recipe, tooltips) {
  return recipe?.crafted ? withItemTooltip(recipe.crafted, tooltips) : recipeTooltip(recipe)
}

function skillSummary(profession) {
  const { current, modifier, max } = rankText(profession)
  return `${rankTitle(profession.max) || 'Skill'} ${current}${modifier ? ` + ${modifier}` : ''}/${max}`
}

function tooltipColor(color) {
  if (!color || typeof color !== 'object') return undefined
  const channel = (value) => Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 255)
  return { color: `rgb(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)})` }
}

// Profession skill bar: the game's frame and background with the profession's
// fill art, clipped (not stretched) to the current skill.
function RankBar({ profession, size = 'large' }) {
  const { current, modifier, max } = rankText(profession)
  const percent = max > 0 ? Math.min(100, (current / max) * 100) : 0
  const theme = themeOf(profession)
  return (
    <div
      className={`prof-bar prof-bar--${size}`}
      style={{ '--prof-fill': art(`fill-${theme || 'default'}`), '--prof-percent': `${100 - percent}%` }}
      role="meter"
      aria-label={`${profession?.name} skill`}
      aria-valuemin={0}
      aria-valuemax={max || undefined}
      aria-valuenow={current}
    >
      <span className="prof-bar__fill" />
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
      <span className="prof-spell__icon">
        <WowIcon iconFileId={profession.iconFileId} label={profession.name} size={40} />
      </span>
      <span className="prof-spell__text">
        <strong>{profession.name}</strong>
        <small>{rankTitle(profession.max)}</small>
      </span>
    </>
  )
  return (
    <ItemHoverCard item={textTooltip(profession.name, skillSummary(profession))} side="top" tooltipClassName="prof-tooltip--text">
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
      {slots.primary.map(({ placeholder, profession }) => {
        const theme = profession && themeOf(profession)
        return (
          <section
            className={`prof-card prof-card--primary${profession ? '' : ' prof-card--missing'}`}
            style={{ '--prof-card': art(theme && !['cooking', 'fishing', 'first-aid'].includes(theme) ? `card-${theme}` : 'card-primary-empty') }}
            key={placeholder}
          >
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
        )
      })}
      <div className="prof-overview__secondary">
        {slots.secondary.map(({ name, missing, profession }) => (
          <section
            className={`prof-card prof-card--secondary${profession ? '' : ' prof-card--missing'}`}
            style={{ '--prof-card': art(`card-${THEMES[name.toLowerCase()]}`) }}
            key={name}
          >
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

// The crafted item's client tooltip, shown under the schematic so stats are
// readable without hovering.
function ItemPreview({ item }) {
  const lines = (Array.isArray(item?.tooltip?.lines) ? item.tooltip.lines : [])
    .slice(1)
    .filter((line) => line?.left || line?.right)
  if (!lines.length) return null
  return (
    <section className="prof-preview" aria-label={`${item.name} details`}>
      {lines.map((line, index) => (
        <div className="prof-preview__line" key={`${line.left}:${index}`}>
          <span style={tooltipColor(line.leftColor)}>{line.left}</span>
          {line.right ? <span style={tooltipColor(line.rightColor)}>{line.right}</span> : null}
        </div>
      ))}
    </section>
  )
}

function Schematic({ recipe, tooltips, theme }) {
  // Captured once per mount so render stays pure; cooldowns are minute-rounded.
  const [now] = useState(() => Date.now())
  const style = { '--prof-schematic': art(`schematic-${theme || 'blacksmithing'}`) }
  if (!recipe) {
    return <div className="prof-schematic prof-schematic--empty" style={style}>Select a recipe.</div>
  }
  const crafted = recipe.crafted ? withItemTooltip(recipe.crafted, tooltips) : null
  const reagents = Array.isArray(recipe.reagents) ? recipe.reagents : []
  const tools = Array.isArray(recipe.tools) ? recipe.tools : []
  const cooldown = cooldownRemaining(recipe.cooldown?.readyAt, now)
  const quantity = crafted?.maxQuantity > 1
    ? crafted.minQuantity && crafted.minQuantity !== crafted.maxQuantity ? `${crafted.minQuantity}-${crafted.maxQuantity}` : String(crafted.maxQuantity)
    : ''
  const skillUps = Number(recipe.skillUps) || 0
  return (
    <div className="prof-schematic" style={style}>
      <header className="prof-schematic__head">
        <ItemHoverCard item={crafted || recipeTooltip(recipe)}>
          <span className="prof-schematic__output" tabIndex={0}>
            <WowIcon
              iconFileId={crafted?.iconFileDataId ?? crafted?.iconFileId ?? recipe.iconFileId}
              itemId={crafted?.itemId}
              spellId={crafted ? undefined : recipe.spellId}
              label={recipe.name}
              quality={crafted?.qualityId}
              size={56}
            />
            {quantity ? <span className="prof-schematic__count">{quantity}</span> : null}
          </span>
        </ItemHoverCard>
        <div className="prof-schematic__title">
          <ItemHoverCard item={recipeTooltip(recipe)} side="left">
            <h4 tabIndex={0} className={crafted ? `item-quality-${crafted.qualityId ?? 1}` : 'prof-schematic__spell'}>{recipe.name}</h4>
          </ItemHoverCard>
          {recipe.difficulty ? (
            <p className={`prof-schematic__difficulty prof-difficulty--${recipe.difficulty}`}>
              {DIFFICULTY_LABELS[recipe.difficulty] || recipe.difficulty}
              {recipe.difficulty !== 'trivial' && skillUps ? <span> · {skillUps === 1 ? '1 skill-up' : `${skillUps} skill-ups`}</span> : null}
              {recipe.maxTrivialLevel ? <span> · grey at {recipe.maxTrivialLevel}</span> : null}
            </p>
          ) : null}
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
                        <WowIcon iconFileId={reagent.iconFileId} itemId={reagent.itemId} label={reagent.name} quality={reagent.qualityId} size={36} />
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
      {crafted ? <ItemPreview item={crafted} /> : null}
    </div>
  )
}

function CategoryNode({ node, open, onToggle, selectedKey, onSelect, tooltips, searching }) {
  const expanded = searching || open(node.id)
  return (
    <section className="prof-category" data-depth={node.depth}>
      <button
        type="button"
        className={`prof-category__header${expanded ? ' is-open' : ''}`}
        onClick={() => onToggle(node.id)}
        aria-expanded={expanded}
        disabled={searching}
      >
        <span className="prof-category__toggle" aria-hidden="true" />
        <span className="prof-category__name">{node.name}</span>
        <small>{node.count}</small>
      </button>
      {expanded ? (
        <>
          {node.recipes.length ? (
            <ul>
              {node.recipes.map((recipe) => {
                const key = recipeKey(recipe)
                const isSelected = selectedKey === key
                return (
                  <li key={key}>
                    <ItemHoverCard item={recipeHoverItem(recipe, tooltips)} side="right">
                      <button
                        type="button"
                        className={`prof-recipe prof-difficulty--${recipe.difficulty || 'none'}${isSelected ? ' is-selected' : ''}`}
                        onClick={() => onSelect(key)}
                        aria-pressed={isSelected}
                      >
                        <span>{recipe.name}</span>
                        {Number(recipe.skillUps) > 1 && recipe.difficulty !== 'trivial' ? <small>{recipe.skillUps}</small> : null}
                      </button>
                    </ItemHoverCard>
                  </li>
                )
              })}
            </ul>
          ) : null}
          {node.children.map((child) => (
            <CategoryNode
              key={child.id}
              node={child}
              open={open}
              onToggle={onToggle}
              selectedKey={selectedKey}
              onSelect={onSelect}
              tooltips={tooltips}
              searching={searching}
            />
          ))}
        </>
      ) : null}
    </section>
  )
}

function CraftingPage({ profession, recipes, tooltips }) {
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState(null)
  // Categories start open, as in game.
  const [collapsed, setCollapsed] = useState(() => new Set())
  const tree = useMemo(() => recipeCategoryTree(recipes, profession.categories, query), [recipes, profession.categories, query])
  const visible = useMemo(() => flattenRecipeTree(tree), [tree])
  const selected = visible.find((recipe) => recipeKey(recipe) === selectedKey) || visible[0] || null
  const searching = Boolean(query.trim())
  const theme = themeOf(profession)

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
              {tree.map((node) => (
                <CategoryNode
                  key={node.id}
                  node={node}
                  open={(id) => !collapsed.has(id)}
                  onToggle={toggle}
                  selectedKey={selected ? recipeKey(selected) : null}
                  onSelect={setSelectedKey}
                  tooltips={tooltips}
                  searching={searching}
                />
              ))}
              {!visible.length ? <p className="prof-list__none">No recipes match.</p> : null}
            </div>
          </div>
          <Schematic key={selected ? recipeKey(selected) : 'none'} recipe={selected} tooltips={tooltips} theme={theme} />
        </div>
      ) : (
        <div className="prof-crafting__waiting">
          <p>No known recipes synced for {profession.name} yet.</p>
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
  const activeRecipes = useMemo(() => (active ? recipesFor(active, recipes) : []), [active, recipes])

  if (!professions.length) {
    return <EmptyTelemetry title="No profession telemetry yet.">Professions will appear after this character's next Guildweaver sync.</EmptyTelemetry>
  }

  return (
    <div className={`professions-pane${active ? ' professions-pane--crafting' : ''}`}>
      <div className="professions-pane__page">
        <header className="professions-pane__title">
          <span className="professions-pane__portrait">
            {active
              ? <WowIcon iconFileId={active.iconFileId} label={active.name} size={34} />
              : <WowIcon src={SIDE_TAB_ICON} label="Professions" size={34} />}
          </span>
          <span className="professions-pane__heading">
            <strong>{active ? active.name : 'Professions'}</strong>
            {active ? <small>{skillSummary(active)} · {activeRecipes.length} known recipes</small> : null}
          </span>
        </header>
        <div className="professions-pane__content">
          {active
            ? <CraftingPage key={active.key} profession={active} recipes={activeRecipes} tooltips={tooltips} />
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
            <WowIcon src={SIDE_TAB_ICON} label="Professions" size={40} />
          </button>
        </ItemHoverCard>
        {rail.map((profession) => (
          <ItemHoverCard key={profession.key} item={textTooltip(profession.name, skillSummary(profession))} side="left" tooltipClassName="prof-tooltip--text">
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
