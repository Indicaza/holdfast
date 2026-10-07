import { useMemo, useState } from 'react'

import WowIcon from '../WowAssets/WowIcon.jsx'
import EmptyTelemetry from './EmptyTelemetry.jsx'

export default function RecipeBrowser({ recipes = [] }) {
  const [query, setQuery] = useState('')
  const [profession, setProfession] = useState('all')
  const professions = useMemo(() => [...new Set(recipes.map((recipe) => recipe.professionName).filter(Boolean))].sort(), [recipes])
  const visible = useMemo(() => recipes.filter((recipe) => {
    if (profession !== 'all' && recipe.professionName !== profession) return false
    if (!query.trim()) return true
    const haystack = [recipe.name, recipe.professionName, recipe.craftedItemName, recipe.id, recipe.craftedItemId]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(query.trim().toLowerCase())
  }), [profession, query, recipes])

  if (!recipes.length) {
    return <EmptyTelemetry title="No known recipes yet.">Known recipes will become searchable here as profession telemetry arrives.</EmptyTelemetry>
  }

  return (
    <div className="recipe-browser">
      <div className="recipe-browser__tools">
        <label>
          <span>Find a recipe or item</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Thorium, potion, recipe ID…" />
        </label>
        <label>
          <span>Profession</span>
          <select value={profession} onChange={(event) => setProfession(event.target.value)}>
            <option value="all">All professions</option>
            {professions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>
      <p className="recipe-browser__count">{visible.length} {visible.length === 1 ? 'recipe' : 'recipes'}</p>
      <div className="recipe-list">
        {visible.map((recipe) => (
          <article className="recipe-row" key={recipe.key || recipe.id || `${recipe.professionName}-${recipe.name}`}>
            <WowIcon
              src={recipe.mediaUrl || recipe.catalog?.metadata?.mediaUrl}
              iconFileId={recipe.iconFileId}
              recipeId={recipe.id}
              label={recipe.name}
              size={46}
            />
            <div className="recipe-row__identity">
              <strong>{recipe.name || 'Unknown recipe'}</strong>
              <span>{recipe.professionName || 'Profession unknown'}{recipe.requiredSkill ? ` · Requires ${recipe.requiredSkill}` : ''}</span>
            </div>
            <div className="recipe-row__crafted">
              <small>Creates</small>
              <span>{recipe.craftedItemName || (recipe.craftedItemId ? `Item ${recipe.craftedItemId}` : 'Item data unavailable')}</span>
            </div>
            <span className={`recipe-row__known${recipe.known ? ' recipe-row__known--yes' : ''}`}>{recipe.known ? 'Known' : 'Unknown'}</span>
            {Array.isArray(recipe.reagents) && recipe.reagents.length ? (
              <div className="recipe-row__reagents">
                {recipe.reagents.slice(0, 6).map((reagent, index) => (
                  <span key={`${reagent.itemId || reagent.name}-${index}`}>{reagent.quantity ? `${reagent.quantity}× ` : ''}{reagent.name || `Item ${reagent.itemId || '?'}`}</span>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {!visible.length ? <EmptyTelemetry title="No recipes match.">Try another item name, profession, or ID.</EmptyTelemetry> : null}
    </div>
  )
}
