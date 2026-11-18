import { useCallback, useEffect, useMemo, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import { runAuthenticatedMutation } from '../Auth/authenticatedMutation.js'
import { signInReturnTo } from '../Auth/returnTo.js'
import { useSession } from '../Auth/sessionContext.js'
import { useLiveResource } from '../Live/useLiveResource.js'
import { navigate } from '../Navigation/navigation.js'
import {
  MAX_NOTE,
  PRIORITIES,
  QUALITY_NAMES,
  acquisitionCopy,
  changeText,
  confidenceCopy,
  difficultyText,
  evidenceText,
  filterOptions,
  filterSources,
  lootHref,
  resolveCharacter,
  resolveDungeon,
  sourcesText,
  usableBy,
  wishlistGroups,
} from './lootModel.js'
import { onServerKey, relativeTime } from './playerModel.js'
import { EmptyState, ErrorState, Icon, ItemLabel, Panel, SkeletonRows, Tip } from './ui.jsx'
import WishlistImport from './WishlistImport.jsx'
import { withAtlasOpen } from './Dungeons/atlasModel.js'
import './DungeonLoot.css'

const TOPICS = ['player']

function useWishlistMutation() {
  const session = useSession()
  return (path, method, body) => runAuthenticatedMutation({
    request: () => apiJson(path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }),
    refresh: session.refresh,
    reauthenticate: () => session.signIn(signInReturnTo()),
  })
}

function ConfidenceTag({ item }) {
  const copy = confidenceCopy(item.confidence)
  const evidence = item.evidence ? evidenceText(item) : ''
  return (
    <Tip label={`${copy.help}${evidence ? ` ${evidence}.` : ''}`}>
      <span className={`gw-tag gw-loot-conf gw-loot-conf--${copy.tone}`}>{copy.label}</span>
    </Tip>
  )
}

// One catalog item: the game's tooltip on hover, its facts, how sure the
// catalog is, and the wishlist toggle.
function LootRow({ item, wanted, onToggle, busy, character, difficulties, where }) {
  const usable = usableBy(item, character)
  const facts = [item.slot, item.itemSubclass && item.itemSubclass !== item.slot ? item.itemSubclass : null, item.itemLevel ? `ilvl ${item.itemLevel}` : null,
    item.requiredLevel ? `requires ${item.requiredLevel}` : null, difficultyText(item, difficulties)].filter(Boolean)
  return (
    <li className={`gw-loot-row${wanted ? ' is-wanted' : ''}${usable === false ? ' is-unusable' : ''}`}>
      <div className="gw-loot-row__item">
        <ItemLabel item={item} size={26} />
        <span className="gw-loot-row__facts">
          {facts.join(' · ') || 'No details yet'}
          {usable === false ? <em> · not usable by {character.name} yet</em> : null}
          {where ? <> · {where}</> : null}
        </span>
      </div>
      <ConfidenceTag item={item} />
      <button type="button" className={`gw-btn gw-btn--sm gw-loot-row__toggle${wanted ? ' is-on' : ''}`} aria-pressed={wanted} disabled={busy || !character}
        aria-label={`${wanted ? 'Remove' : 'Add'} ${item.name} ${wanted ? 'from' : 'to'} the wishlist`} onClick={() => onToggle(item, wanted)}>
        <Icon name={wanted ? 'check' : 'plus'} size={14} /> {wanted ? 'Wanted' : 'Want'}
      </button>
    </li>
  )
}

function Filters({ filters, options, onChange, character }) {
  const set = (key) => (event) => onChange({ ...filters, [key]: event.target.type === 'checkbox' ? (event.target.checked ? '1' : '') : event.target.value })
  const active = Object.values(filters).some(Boolean)
  // The search box keeps its own text while typing; the URL (and the
  // search it drives) follows a moment after the last keystroke.
  const [text, setText] = useState(filters.q)
  const [syncedQ, setSyncedQ] = useState(filters.q)
  if (filters.q !== syncedQ) {
    setSyncedQ(filters.q)
    if (filters.q !== text.trim()) setText(filters.q)
  }
  useEffect(() => {
    if (text.trim() === filters.q) return undefined
    const timer = setTimeout(() => onChange({ ...filters, q: text.trim() }), 250)
    return () => clearTimeout(timer)
  }, [text, filters, onChange])
  return (
    <div className="gw-filterbar gw-loot__filters" role="group" aria-label="Filter loot">
      <label className={`gw-filter gw-loot__search${filters.q ? ' is-active' : ''}`}>
        <span>Search</span>
        <input type="search" value={text} placeholder="Item or boss, any dungeon" aria-label="Search items and bosses" onChange={(event) => setText(event.target.value)} />
      </label>
      <label className={`gw-filter${filters.slot ? ' is-active' : ''}`}>
        <span>Slot</span>
        <select value={filters.slot} onChange={set('slot')}>
          <option value="">Any</option>
          {options.slots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
        </select>
      </label>
      <label className={`gw-filter${filters.type ? ' is-active' : ''}`}>
        <span>Type</span>
        <select value={filters.type} onChange={set('type')}>
          <option value="">Any</option>
          {options.types.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
      </label>
      <label className={`gw-filter${filters.quality ? ' is-active' : ''}`}>
        <span>Quality</span>
        <select value={filters.quality} onChange={set('quality')}>
          <option value="">Any</option>
          {options.qualities.map((quality) => <option key={quality} value={quality}>{QUALITY_NAMES[quality] || `Quality ${quality}`}</option>)}
        </select>
      </label>
      {character ? (
        <Tip label="Hides items whose required level or class line (from the game's tooltip) rules this character out. Items with nothing known stay.">
          <label className="gw-loot__check"><input type="checkbox" checked={Boolean(filters.usable)} onChange={set('usable')} /> Usable by {character.name}</label>
        </Tip>
      ) : null}
      <label className="gw-loot__check"><input type="checkbox" checked={Boolean(filters.all)} onChange={set('all')} /> Show non-gear</label>
      {active ? <button type="button" className="gw-btn gw-btn--sm" onClick={() => onChange({})}>Clear</button> : null}
    </div>
  )
}

function Changes({ changes }) {
  if (!changes?.length) return null
  return (
    <details className="gw-loot__changes">
      <summary>Recent catalog changes ({changes.length})</summary>
      <ul>
        {changes.map((change) => (
          <li key={change.id}>
            <span>{changeText(change)}</span>
            <small className="gw-muted">{relativeTime(change.at)}{change.gameBuild ? ` · build ${change.gameBuild}` : ''} · revision {change.revision}</small>
          </li>
        ))}
      </ul>
    </details>
  )
}

// The right panel: one character's wishlist. Every change saves at once.
function Wishlist({ character, resource, run, busy, error, guideHref }) {
  const data = resource.data
  const groups = useMemo(() => wishlistGroups(data?.items || []), [data])
  const path = (entry) => `/api/player/wishlists/${encodeURIComponent(character.id)}/items/${entry.itemKey}`
  const [notes, setNotes] = useState({})
  useEffect(() => { setNotes({}) }, [character.id])

  function saveNote(entry) {
    const draft = notes[entry.itemKey]
    if (draft === undefined || draft.trim() === entry.note) return
    run(path(entry), 'PATCH', { note: draft.trim() })
  }

  const row = (entry, index, list) => {
    const status = acquisitionCopy(entry)
    const acquired = entry.state === 'acquired'
    return (
      <li key={entry.itemKey} className={`gw-wish-row${acquired ? ' is-acquired' : ''}`}>
        <div className="gw-wish-row__head">
          <ItemLabel item={{ ...entry.item, itemId: entry.itemId }} size={24} muted={acquired} />
          <span className="gw-wish-row__tools">
            {acquired ? null : (
              <>
                <button type="button" className="gw-icon-btn gw-icon-btn--quiet" aria-label={`Move ${entry.item.name} up`} disabled={busy || index === 0}
                  onClick={() => run(path(entry), 'PATCH', { move: 'up' })}><Icon name="arrowUp" size={14} /></button>
                <button type="button" className="gw-icon-btn gw-icon-btn--quiet" aria-label={`Move ${entry.item.name} down`} disabled={busy || index === list.length - 1}
                  onClick={() => run(path(entry), 'PATCH', { move: 'down' })}><Icon name="arrowDown" size={14} /></button>
              </>
            )}
            <button type="button" className="gw-icon-btn gw-icon-btn--quiet" aria-label={`Remove ${entry.item.name} from the wishlist`} disabled={busy}
              onClick={() => run(path(entry), 'DELETE')}><Icon name="close" size={14} /></button>
          </span>
        </div>
        <p className="gw-wish-row__sources gw-muted">
          {[entry.item.slot, entry.itemKey !== `i:${entry.itemId}` ? `variant ${entry.itemKey}` : null].filter(Boolean).join(' · ')}
          {entry.item.slot ? ' · ' : ''}{sourcesText(entry.sources)}
          {entry.sources?.[0]?.instanceId ? <> · <a className="gw-link" href={guideHref(entry.sources[0].instanceId)}>Guide</a></> : null}
        </p>
        {acquired ? (
          <div className="gw-wish-row__controls">
            <span className="gw-tag gw-tag--ok"><Icon name="check" size={12} /> {status.label}</span>
            <span className="gw-muted">{status.detail}</span>
            <button type="button" className="gw-btn gw-btn--sm" disabled={busy} onClick={() => run(path(entry), 'PATCH', { state: 'wanted' })}>Want another</button>
          </div>
        ) : (
          <div className="gw-wish-row__controls">
            <label className="gw-wish-row__priority">
              <span className="gw-sr-only">Priority of {entry.item.name}</span>
              <select value={entry.priority} disabled={busy} onChange={(event) => run(path(entry), 'PATCH', { priority: event.target.value })}>
                {PRIORITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <input className="gw-wish-row__note" value={notes[entry.itemKey] ?? entry.note} maxLength={MAX_NOTE} placeholder="Note (shown in game)" aria-label={`Note for ${entry.item.name}`}
              onChange={(event) => setNotes({ ...notes, [entry.itemKey]: event.target.value })} onBlur={() => saveNote(entry)}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
            {status.detail ? <span className="gw-wish-row__status gw-muted">{status.detail}</span> : null}
            <Tip label="For loot Guildweaver was not running for. Items you loot with it running are marked by themselves.">
              <button type="button" className="gw-btn gw-btn--sm gw-btn--ghost" disabled={busy} onClick={() => run(path(entry), 'PATCH', { state: 'acquired' })}>Got it</button>
            </Tip>
          </div>
        )}
      </li>
    )
  }

  return (
    <Panel id="player-wishlist" className="gw-wish" flush title={`${character.name}'s wishlist`}
      description={data ? `${groups.wanted.length} wanted${groups.acquired.length ? `, ${groups.acquired.length} acquired` : ''}${data.limit ? ` · up to ${data.limit}` : ''}` : null}>
      {resource.status === 'loading' ? <SkeletonRows rows={3} label="Loading the wishlist" /> : null}
      {resource.status === 'error' || resource.status === 'missing' ? <p className="gw-muted gw-run-empty">This wishlist could not be loaded.</p> : null}
      {data ? (
        <>
          {groups.wanted.length ? <ol className="gw-wish__list">{groups.wanted.map(row)}</ol>
            : <p className="gw-muted gw-run-empty">Nothing wanted yet. Pick items on the left: <strong>Want</strong> adds them here.</p>}
          {groups.acquired.length ? (
            <>
              <h3 className="gw-wish__sub">Acquired</h3>
              <ol className="gw-wish__list">{groups.acquired.map(row)}</ol>
            </>
          ) : null}
          {error ? <p className="gw-objectives__error" role="alert">{error}</p> : null}
          <p className="gw-muted gw-wish__note">
            Saved as you go. Guildweaver on your computer carries the wanted items into the game; they glow purple in Need/Greed rolls after your next login or <kbd>/reload</kbd>.
            {data.ownershipKnown ? '' : ' Bags and gear have not synced for this character yet, so nothing can be marked acquired by itself.'}
          </p>
        </>
      ) : null}
    </Panel>
  )
}

// Dungeon loot on the left, one character's wishlist on the right.
export default function DungeonLoot({ server, query, characters = [] }) {
  const mine = useMemo(() => characters.filter((entry) => onServerKey(entry, server)), [characters, server])
  const character = resolveCharacter(mine, query.character)
  const dungeons = useLiveResource('/api/player/loot/dungeons', { topics: TOPICS })
  const dungeon = resolveDungeon(dungeons.data?.dungeons || [], query.dungeon)
  const searching = query.filters.q.trim().length >= 2
  const detail = useLiveResource(dungeon ? `/api/player/loot/dungeons/${dungeon.instanceId}` : '', { topics: TOPICS, enabled: Boolean(dungeon) })
  const search = useLiveResource(searching ? `/api/player/loot/items?q=${encodeURIComponent(query.filters.q.trim())}` : '', { topics: TOPICS, enabled: searching })
  const wishlist = useLiveResource(character ? `/api/player/wishlists/${encodeURIComponent(character.id)}` : '', { topics: TOPICS, enabled: Boolean(character) })
  const mutate = useWishlistMutation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)

  const characterId = character?.id || ''
  const dungeonId = dungeon?.instanceId || null
  const go = useCallback((next, options = {}) => navigate(lootHref({ server, character: characterId, dungeon: dungeonId, filters: query.filters, ...next }),
    { preserveScroll: true, ...options }), [server, characterId, dungeonId, query.filters])
  // Filters refine one view: they replace the history entry, not add one.
  const setFilters = useCallback((filters) => go({ filters }, { replace: true }), [go])
  const wantedKeys = useMemo(() => new Set((wishlist.data?.items || []).map((entry) => entry.itemKey)), [wishlist.data])

  async function run(path, method, body) {
    setBusy(true)
    setError('')
    try {
      const result = await mutate(path, method, body)
      if (result?.items) wishlist.mutate(result)
      return true
    } catch (failure) {
      setError(failure?.status === 409 ? 'This wishlist is full.' : failure?.status === 422 ? 'Guildweaver does not know that item yet.' : 'That change was not saved. Try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  function toggle(item, wanted, from) {
    if (!character) return
    const path = `/api/player/wishlists/${encodeURIComponent(character.id)}/items/${item.itemKey}`
    if (wanted) run(path, 'DELETE')
    else run(path, 'PUT', from ? { sourceDungeon: from.name, sourceInstanceId: from.instanceId } : {})
  }

  const options = useMemo(() => filterOptions(detail.data?.sources || [], { all: Boolean(query.filters.all) }), [detail.data, query.filters.all])
  // A search runs across every dungeon; the other filters still apply.
  const found = useMemo(() => (search.data?.items || []).filter((item) => filterSources([{ items: [item] }], { ...query.filters, q: '' }, character).length), [search.data, query.filters, character])
  const sources = useMemo(() => filterSources(detail.data?.sources || [], query.filters, character), [detail.data, query.filters, character])

  if (dungeons.status === 'loading') return <SkeletonRows rows={8} label="Loading dungeon loot" />
  if (dungeons.status === 'error' || dungeons.status === 'missing') return <ErrorState>Dungeon loot could not be loaded.</ErrorState>

  return (
    <div className="gw-stack gw-loot">
      <div className="gw-loot__bar">
        <label className="gw-select">
          <span>Wishlist for</span>
          <select value={character?.id || ''} aria-label="Character" disabled={!mine.length} onChange={(event) => go({ character: event.target.value })}>
            {mine.length ? null : <option value="">No character synced yet</option>}
            {mine.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.level ? ` · ${entry.level}` : ''}{entry.className ? ` ${entry.className}` : ''}</option>)}
          </select>
        </label>
        <label className="gw-select">
          <span>Dungeon</span>
          <select value={dungeon?.instanceId || ''} aria-label="Dungeon" disabled={!dungeons.data.dungeons.length} onChange={(event) => go({ dungeon: Number(event.target.value) })}>
            {dungeons.data.dungeons.length ? null : <option value="">No dungeons yet</option>}
            {dungeons.data.dungeons.map((entry) => <option key={entry.instanceId} value={entry.instanceId}>{entry.name} ({entry.itemCount})</option>)}
          </select>
        </label>
        {dungeon ? (
          <a className="gw-btn gw-btn--sm" href={withAtlasOpen(lootHref({ server, character: characterId, dungeon: dungeonId, filters: query.filters }), { open: dungeon.instanceId })}>
            <Icon name="info" size={14} /> Dungeon guide
          </a>
        ) : null}
        <span className="gw-loot__bar-space" />
        <button type="button" className={`gw-btn gw-btn--sm${importing ? '' : ' gw-btn--primary'}`} disabled={!character} aria-expanded={importing} onClick={() => setImporting((open) => !open)}>
          <Icon name="sparkle" size={14} /> AI wishlist builder
        </button>
      </div>

      {importing && character ? (
        <WishlistImport character={character} dungeon={dungeon} onClose={() => setImporting(false)} onImported={(next) => { if (next) wishlist.mutate(next) }} />
      ) : null}

      <div className="gw-loot__panes">
        <section className="gw-loot__browse" aria-label="Dungeon loot">
          <Filters filters={query.filters} options={options} character={character} onChange={setFilters} />
          {!dungeons.data.dungeons.length ? (
            <EmptyState title="No dungeon loot recorded yet." icon="dungeon">
              The catalog grows from what players' games see: run a dungeon with Guildweaver, loot the bosses, then <kbd>/reload</kbd> or log out.
            </EmptyState>
          ) : searching ? (
            <Panel title={`Items matching “${query.filters.q.trim()}”`} description={search.data?.truncated ? 'Showing the first matches; narrow the search for more.' : 'Across every dungeon.'} flush>
              {search.status === 'loading' ? <SkeletonRows rows={4} label="Searching" /> : null}
              {search.data && !found.length ? <p className="gw-muted gw-run-empty">No catalog item matches. The catalog only holds loot players have seen or the game lists.</p> : null}
              <ul className="gw-loot-list">
                {found.map((item) => (
                  <LootRow key={item.itemKey} item={item} wanted={wantedKeys.has(item.itemKey)} busy={busy} character={character} difficulties={{}}
                    where={sourcesText(item.sources)} onToggle={(entry, wanted) => toggle(entry, wanted, item.sources[0] ? { name: item.sources[0].dungeon, instanceId: item.sources[0].instanceId } : null)} />
                ))}
              </ul>
            </Panel>
          ) : (
            <>
              {detail.status === 'loading' ? <SkeletonRows rows={6} label="Loading the dungeon's loot" /> : null}
              {detail.status === 'error' || detail.status === 'missing' ? <ErrorState>This dungeon's loot could not be loaded.</ErrorState> : null}
              {detail.data && !sources.length ? (
                <EmptyState title={detail.data.sources.length ? 'No loot matches these filters.' : 'No loot recorded here yet.'} icon="loot">
                  {detail.data.sources.length ? 'Clear a filter, or tick “Show non-gear”.' : 'Loot shows up once a player loots this dungeon with Guildweaver running.'}
                </EmptyState>
              ) : null}
              {sources.map((source) => (
                <Panel key={source.key} flush className="gw-loot-source"
                  title={<>{source.name || 'Source not identified'}{source.boss ? <span className="gw-tag gw-loot-boss">Boss</span> : null}</>}
                  description={source.kind === 'unknown' ? 'Seen in group rolls here. Which creature dropped them is not known.' : `${source.items.length} item${source.items.length === 1 ? '' : 's'}`}>
                  <ul className="gw-loot-list">
                    {source.items.map((item) => (
                      <LootRow key={item.itemKey} item={item} wanted={wantedKeys.has(item.itemKey)} busy={busy} character={character}
                        difficulties={detail.data.difficulties} onToggle={(entry, wanted) => toggle(entry, wanted, detail.data.instance)} />
                    ))}
                  </ul>
                </Panel>
              ))}
              {detail.data ? <p className="gw-muted gw-loot__evidence">{detail.data.evidence.note} Catalog revision {detail.data.revision}.</p> : null}
              <Changes changes={detail.data?.changes} />
            </>
          )}
        </section>

        <aside className="gw-loot__side" aria-label="Wishlist">
          {character ? <Wishlist character={character} resource={wishlist} run={run} busy={busy} error={error}
            guideHref={(instanceId) => withAtlasOpen(lootHref({ server, character: characterId, dungeon: dungeonId, filters: query.filters }), { open: instanceId, section: 'loot' })} /> : (
            <EmptyState title="No character to plan for yet." icon="characters">
              Log in to a character with Guildweaver running, then <kbd>/reload</kbd>. Its wishlist appears here.
            </EmptyState>
          )}
        </aside>
      </div>
    </div>
  )
}
