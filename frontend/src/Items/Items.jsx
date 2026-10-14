import { useEffect, useState } from 'react'
import PageShell from '../PageShell/PageShell.jsx'
import { ItemIcon } from '../WowAssets/WowIcon.jsx'
import { navigate } from '../Navigation/navigation.js'
import { catalogLink } from './catalogLinks.js'
import './Items.css'

function CatalogIcon({ item, size }) {
  return <ItemIcon item={{ ...item, mediaUrl: item.iconFileDataId ? `/api/game-data/v1/icons/${item.iconFileDataId}` : '/wow-art/question-mark.webp' }} size={size} />
}

function RecipeList({ title, recipes, references, scope, truncated }) {
  const names = new Map(references.map((item) => [item.itemId, item.name]))
  const link = (id) => <a href={catalogLink(id, scope)}>{names.get(id) || `Item ${id}`}</a>
  return <section className="catalog-panel">
    <h2>{title}</h2>
    {recipes.length ? <ul className="catalog-recipes">{recipes.map((recipe) => <li key={recipe.recipeId}>
      <strong>{recipe.name}</strong><span>{recipe.professionName || 'Crafting'} · Recipe {recipe.recipeId}</span>
      <p>Makes {link(recipe.craftedItemId)}{recipe.minQuantity ? ` × ${recipe.minQuantity}${recipe.maxQuantity > recipe.minQuantity ? `–${recipe.maxQuantity}` : ''}` : ''}</p>
      <p>Ingredients: {recipe.reagents.length ? recipe.reagents.map((entry, index) => <span key={`${entry.itemId}:${index}`}>
        {index ? ', ' : ''}{link(entry.itemId)} × {entry.quantity}{entry.optional ? ' (optional)' : ''}
      </span>) : 'Not yet observed'}</p>
    </li>)}</ul> : <p>No recipes observed yet.</p>}
    {truncated ? <p>Showing the first 50 recipes.</p> : null}
  </section>
}

function ItemFacts({ data, scope }) {
  const { item, sources, locations, evidence } = data
  return <>
    <section className="catalog-panel catalog-item">
      <CatalogIcon item={item} size={64} />
      <div><h2 className={`item-quality-${item.qualityId || 0}`}>{item.name}</h2><p>Item {item.itemId} · Build {item.gameBuild} · {item.locale}</p>
        {[item.itemClass?.name, item.itemSubclass?.name].filter(Boolean).join(' · ')}
        {item.requiredLevel > 0 ? <p>Requires level {item.requiredLevel}</p> : null}
      </div>
      <div className="catalog-description">{item.tooltipLines?.length ? <>
        <p className="catalog-caption">Base item description</p>
        {item.tooltipLines.map((line, index) => <p key={index}><span>{line.left}</span><span>{line.right}</span></p>)}
      </> : <p>A full base item description has not been observed yet.</p>}</div>
    </section>
    <section className="catalog-panel">
      <h2>Where it was observed</h2>
      <p className="catalog-caption">{evidence.note}</p>
      {sources.length ? <div className="catalog-table-wrap"><table><thead><tr><th>Source</th><th>Location</th><th>Evidence</th></tr></thead><tbody>
        {sources.map((source, index) => <tr key={index}>
          <td><strong>{source.name || (source.sourceId ? `${source.kind === 'creature' ? 'NPC' : 'Object'} ${source.sourceId}` : 'Unknown source')}</strong>
            <span>{source.activity === 'corpse_loot' ? 'Corpse loot' : source.discipline}{source.sourceId ? ` · ID ${source.sourceId}` : ''}</span></td>
          <td>{[source.instanceName || source.zone, source.mapId ? `Map ${source.mapId}` : '', source.difficultyId > 0 ? `Difficulty ${source.difficultyId}` : ''].filter(Boolean).join(' · ') || 'Not recorded'}</td>
          <td>{source.observations.toLocaleString()} sightings<span>{source.observedQuantity.toLocaleString()} units offered{source.questLootObserved ? ' · Includes quest loot' : ''}</span></td>
        </tr>)}
      </tbody></table></div> : <p>No sources observed yet. Seeing an item in a bag does not tell us where it came from.</p>}
      {data.truncated.sources ? <p>Showing the first 50 sources.</p> : null}
      {locations.length ? <details className="catalog-locations"><summary>Approximate map locations ({locations.length})</summary><ul>{locations.map((point, index) =>
        <li key={index}>Map {point.mapId}: {(point.x * 100).toFixed(0)}, {(point.y * 100).toFixed(0)} · Player position at {point.positionKind === 'player_at_loot' ? 'looting' : 'gathering'}</li>)}</ul>
        <p>Each point covers 2% of the map and requires at least three contributors. It is an approximate player location.</p>
      </details> : null}
    </section>
    <div className="catalog-recipe-columns">
      <RecipeList title="Created by" recipes={data.createdBy} references={data.references} scope={scope} truncated={data.truncated.createdBy} />
      <RecipeList title="Used in" recipes={data.usedBy} references={data.references} scope={scope} truncated={data.truncated.usedBy} />
    </div>
  </>
}

export default function Items({ itemId = null, queryString = '' }) {
  const [scopes, setScopes] = useState(null)
  const [result, setResult] = useState({ loading: true })
  const [scopeError, setScopeError] = useState('')
  const [retry, setRetry] = useState(0)
  const query = new URLSearchParams(queryString)
  const requestedBuild = query.get('build')
  const requestedLocale = query.get('locale')
  const q = query.get('q') || ''
  const after = query.get('after') || ''
  const scope = requestedBuild ? { gameBuild: requestedBuild, locale: requestedLocale || 'und' } : scopes?.[0]
  const gameBuild = scope?.gameBuild
  const locale = scope?.locale

  useEffect(() => {
    const controller = new AbortController()
    setScopeError('')
    fetch('/api/game-data/v1/scopes', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Could not load game versions.')
      setScopes((await response.json()).scopes)
    }).catch((error) => { if (error.name !== 'AbortError') setScopeError(error.message) })
    return () => controller.abort()
  }, [retry])

  useEffect(() => {
    if (!gameBuild || !locale) return undefined
    const controller = new AbortController()
    setResult({ loading: true })
    const search = new URLSearchParams({ build: gameBuild, locale })
    if (!itemId && q) search.set('q', q)
    if (!itemId && after) search.set('after', after)
    fetch(`/api/game-data/v1/items${itemId ? `/${itemId}` : ''}?${search}`, { signal: controller.signal }).then(async (response) => {
      if (response.status === 404) { setResult({ missing: true }); return }
      if (!response.ok) throw new Error('Could not load the catalog. Please retry or choose another game version.')
      setResult({ data: await response.json() })
    }).catch((error) => { if (error.name !== 'AbortError') setResult({ error: error.message }) })
    return () => controller.abort()
  }, [gameBuild, locale, q, after, itemId, retry])

  const empty = scopes?.length === 0 && !requestedBuild
  const error = scopeError || result.error
  return <PageShell className="catalog-page" eyebrow="Community game knowledge" title={result.data?.item?.name || 'Item catalog'}
    intro="Find items, observed loot sources, and crafting uses. This catalog grows as Guildweaver discovers game facts.">
    <div className="catalog-toolbar">
      <form onSubmit={(event) => { event.preventDefault(); if (scope) navigate(catalogLink(null, scope, { q: new FormData(event.currentTarget).get('q').trim() })) }}>
        <label htmlFor="catalog-search">Search items</label>
        <div><input id="catalog-search" name="q" type="search" placeholder="Item name or ID" maxLength={100} defaultValue={q} key={q} />
          <button type="submit" disabled={!scope}>Search</button></div>
      </form>
      {scope ? <label>Game version<select aria-label="Game version" value={`${gameBuild}/${locale}`} onChange={(event) => {
        const [build, lang] = event.target.value.split('/')
        navigate(catalogLink(itemId, { gameBuild: build, locale: lang }, { q }))
      }}>
        {scopes?.some((entry) => entry.gameBuild === gameBuild && entry.locale === locale) ? null : <option value={`${gameBuild}/${locale}`}>Build {gameBuild} · {locale}</option>}
        {scopes?.map((entry) => <option key={`${entry.gameBuild}/${entry.locale}`} value={`${entry.gameBuild}/${entry.locale}`}>Build {entry.gameBuild} · {entry.locale === 'und' ? 'Language unknown' : entry.locale}</option>)}
      </select></label> : null}
    </div>
    {itemId && scope ? <a href={catalogLink(null, scope)}>← Browse items</a> : null}
    {error ? <p role="alert">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></p>
      : empty ? <p className="catalog-panel">No game facts have synced yet. Loot items or open a profession window with Guildweaver, then sync the bridge.</p>
      : result.loading ? <p role="status">Loading game facts…</p>
      : result.missing ? <p className="catalog-panel">This item has not been observed in the selected game version.</p>
      : result.data?.item ? <ItemFacts data={result.data} scope={scope} />
      : result.data ? <>
        <div className="catalog-grid">{result.data.items.map((item) => <a className="catalog-result" href={catalogLink(item.itemId, scope)} key={item.itemId}>
          <CatalogIcon item={item} size={40} /><span><strong className={`item-quality-${item.qualityId || 0}`}>{item.name}</strong><small>Item {item.itemId}</small></span>
        </a>)}</div>
        {!result.data.items.length ? <p>No items match your search.</p> : null}
        {result.data.nextAfter ? <a className="catalog-next" href={catalogLink(null, scope, { q, after: result.data.nextAfter })}>Next items →</a> : null}
      </> : null}
    {scope ? <p className="catalog-api"><a href={`/api/game-data/v1/items${itemId ? `/${itemId}` : ''}?${new URLSearchParams({ build: gameBuild, locale, ...(!itemId && q ? { q } : {}) })}`}>Public game-data JSON</a> · Client-reported game facts · No player profiles</p> : null}
  </PageShell>
}
