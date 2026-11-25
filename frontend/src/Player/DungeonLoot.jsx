import { useEffect, useMemo, useRef, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import { runAuthenticatedMutation } from '../Auth/authenticatedMutation.js'
import { signInReturnTo } from '../Auth/returnTo.js'
import { useSession } from '../Auth/sessionContext.js'
import { useLiveResource } from '../Live/useLiveResource.js'
import { navigate } from '../Navigation/navigation.js'
import { MAX_NOTE, PRIORITIES, acquisitionCopy, lootHref, resolveCharacter, wishlistGroups } from './lootModel.js'
import { onServerKey } from './playerModel.js'
import { EmptyState, Icon, ItemLabel, Panel, SkeletonRows, Tip } from './ui.jsx'
import WishlistImport from './WishlistImport.jsx'
import { exploreHref, withAtlasOpen } from './Dungeons/atlasModel.js'
import './DungeonLoot.css'

const TOPICS = ['player']

function sourceLabel(source) {
  const creature = source.source || source.bossName || source.sourceName || ''
  const dungeon = source.dungeon || (source.instanceId ? `Dungeon ${source.instanceId}` : '')
  return [creature, dungeon].filter(Boolean).join(' · ') || 'Drop source not identified'
}

function useWishlistMutation() {
  const session = useSession()
  return (path, method, body) => runAuthenticatedMutation({
    request: () => apiJson(path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }),
    refresh: session.refresh,
    reauthenticate: () => session.signIn(signInReturnTo()),
  })
}

function Wishlist({ character, resource, run, busy, error, guideHref, exploreUrl }) {
  const data = resource.data
  const groups = useMemo(() => wishlistGroups(data?.items || []), [data])
  const [expandedKey, setExpandedKey] = useState(null)
  const [notes, setNotes] = useState({})
  const [noteStatus, setNoteStatus] = useState({})
  const draftsRef = useRef({})
  const savingRef = useRef(new Set())
  const activeCharacterRef = useRef(character.id)
  activeCharacterRef.current = character.id

  useEffect(() => {
    setNotes({})
    draftsRef.current = {}
    savingRef.current.clear()
    setNoteStatus({})
    setExpandedKey(null)
  }, [character.id])

  const path = (entry) => '/api/player/wishlists/' + encodeURIComponent(character.id) + '/items/' + encodeURIComponent(entry.itemKey)

  function editNote(key, value) {
    draftsRef.current[key] = value
    setNotes((current) => ({ ...current, [key]: value }))
    setNoteStatus((current) => ({ ...current, [key]: 'unsaved' }))
  }

  async function saveNote(entry) {
    const key = entry.itemKey
    const draft = draftsRef.current[key]
    if (draft === undefined || savingRef.current.has(key)) return
    const submitted = draft.trim()
    if (submitted === (entry.note || '')) {
      setNoteStatus((current) => ({ ...current, [key]: 'saved' }))
      return
    }
    savingRef.current.add(key)
    const characterId = character.id
    setNoteStatus((current) => ({ ...current, [key]: 'saving' }))
    const saved = await run(path(entry), 'PATCH', { note: submitted }, { inline: true })
    savingRef.current.delete(key)
    if (activeCharacterRef.current !== characterId) return
    if (saved && draftsRef.current[key] === draft) {
      delete draftsRef.current[key]
      setNotes((current) => {
        if (current[key] !== draft) return current
        const next = { ...current }
        delete next[key]
        return next
      })
    }
    setNoteStatus((current) => ({
      ...current,
      [key]: saved ? (draftsRef.current[key] === undefined ? 'saved' : 'unsaved') : 'error',
    }))
  }

  function row(entry, index, list) {
    const acquired = entry.state === 'acquired'
    const open = expandedKey === entry.itemKey
    const status = acquisitionCopy(entry)
    const sources = entry.sources || []
    const noteSave = noteStatus[entry.itemKey]
    return (
      <li key={entry.itemKey} className={'gw-wish-row' + (acquired ? ' is-acquired' : '')}>
        <div className="gw-wish-row__head">
          <div className="gw-wish-row__identity">
            <ItemLabel item={{ ...entry.item, itemId: entry.itemId }} size={40} muted={acquired} />
            <p className="gw-wish-row__sources gw-muted">
              {[entry.item.slot, entry.itemKey !== 'i:' + entry.itemId ? 'Variant' : null].filter(Boolean).join(' · ')}
              {sources.length ? <> · {sources[0].instanceId
                ? <a className="gw-link" href={guideHref(sources[0].instanceId)}>{sourceLabel(sources[0])}</a>
                : sourceLabel(sources[0])}{sources.length > 1 ? ` · +${sources.length - 1} more` : null}</> : ' · No dungeon source known yet'}
            </p>
            {sources.length > 1 ? (
              <details className="gw-wish-row__source-list">
                <summary>All {sources.length} drop sources</summary>
                <ul>{sources.map((source, sourceIndex) => (
                  <li key={`${source.instanceId || 'unknown'}:${source.source || source.sourceName || sourceIndex}:${sourceIndex}`}>
                    {source.instanceId ? <a className="gw-link" href={guideHref(source.instanceId)}>{sourceLabel(source)}</a> : <span>{sourceLabel(source)}</span>}
                  </li>
                ))}</ul>
              </details>
            ) : null}
            {!open && (notes[entry.itemKey] ?? entry.note) ? <p className="gw-wish-row__note-preview gw-muted">{notes[entry.itemKey] ?? entry.note}</p> : null}
            {noteSave ? (
              <div className={`gw-wish-row__save-state is-${noteSave}`} role={noteSave === 'error' ? 'alert' : 'status'}>
                {noteSave === 'saving' ? 'Saving note…' : noteSave === 'saved' ? 'Note saved' : noteSave === 'error' ? 'Note not saved.' : 'Unsaved note'}
                {(noteSave === 'error' || noteSave === 'unsaved') && !savingRef.current.has(entry.itemKey) ? (
                  <button type="button" className="gw-link" onClick={() => saveNote(entry)}>Retry save</button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="gw-wish-row__actions">
            {acquired
              ? <span className="gw-tag gw-tag--ok"><Icon name="check" size={12} /> Acquired</span>
              : <span className={'gw-wish-row__priority-tag gw-wish-row__priority-tag--' + entry.priority}>{PRIORITIES.find(([value]) => value === entry.priority)?.[1] || 'Normal'}</span>}
            <button type="button" className="gw-btn gw-btn--sm gw-btn--ghost" aria-expanded={open}
              aria-label={(open ? 'Close' : 'Edit') + ' ' + entry.item.name + ' details'}
              onClick={() => setExpandedKey(open ? null : entry.itemKey)}>
              <Icon name="edit" size={13} /> {open ? 'Less' : 'Edit'}
            </button>
          </div>
        </div>
        {open ? (
          <div className="gw-wish-row__editor">
            {acquired ? (
              <>
                <span className="gw-muted">{status.detail}</span>
                <button type="button" className="gw-btn gw-btn--sm" disabled={busy} onClick={() => run(path(entry), 'PATCH', { state: 'wanted' })}>Want another</button>
              </>
            ) : (
              <>
                <label className="gw-wish-row__priority">
                  <span>Priority</span>
                  <select value={entry.priority} disabled={busy} onChange={(event) => run(path(entry), 'PATCH', { priority: event.target.value })}>
                    {PRIORITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="gw-wish-row__note-field">
                  <span>Note for in-game alerts</span>
                  <input className="gw-wish-row__note" value={notes[entry.itemKey] ?? entry.note ?? ''} maxLength={MAX_NOTE}
                    aria-label={'Note for ' + entry.item.name} placeholder="Optional note" onChange={(event) => editNote(entry.itemKey, event.target.value)}
                    onBlur={() => saveNote(entry)}
                    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
                </label>
                {status.detail ? <span className="gw-wish-row__status gw-muted">{status.detail}</span> : null}
                <button type="button" className="gw-btn gw-btn--sm gw-btn--ghost" disabled={busy || index === 0}
                  aria-label={'Move ' + entry.item.name + ' up'} onClick={() => run(path(entry), 'PATCH', { move: 'up' })}><Icon name="arrowUp" size={14} /> Up</button>
                <button type="button" className="gw-btn gw-btn--sm gw-btn--ghost" disabled={busy || index === list.length - 1}
                  aria-label={'Move ' + entry.item.name + ' down'} onClick={() => run(path(entry), 'PATCH', { move: 'down' })}><Icon name="arrowDown" size={14} /> Down</button>
                <Tip label="Use this for items you obtained before Guildweaver could record them.">
                  <button type="button" className="gw-btn gw-btn--sm" disabled={busy} onClick={() => run(path(entry), 'PATCH', { state: 'acquired' })}>Got it</button>
                </Tip>
              </>
            )}
            <button type="button" className="gw-btn gw-btn--sm gw-btn--ghost gw-wish-row__remove" disabled={busy}
              aria-label={'Remove ' + entry.item.name + ' from the wishlist'}
              onClick={() => run(path(entry), 'DELETE')}><Icon name="close" size={14} /> Remove</button>
          </div>
        ) : null}
      </li>
    )
  }

  return (
    <Panel id="player-wishlist" className="gw-wish" flush title="Wishlist"
      description={data ? groups.wanted.length + ' wanted' + (groups.acquired.length ? ' · ' + groups.acquired.length + ' acquired' : '') : null}>
      {resource.status === 'loading' ? <SkeletonRows rows={3} label="Loading the wishlist" /> : null}
      {resource.status === 'error' || resource.status === 'missing' ? <p className="gw-muted gw-run-empty" role="alert">This wishlist could not be loaded.</p> : null}
      {data ? (
        <>
          {groups.wanted.length ? <ol className="gw-wish__list" aria-label="Wanted items">{groups.wanted.map(row)}</ol>
            : <div className="gw-wish__empty">
                <p>{groups.acquired.length ? 'All caught up — every wishlisted item is acquired.' : 'No items on your wishlist yet.'}</p>
                <a className="gw-btn gw-btn--sm gw-btn--primary" href={exploreUrl}><Icon name="dungeon" size={14} /> Browse dungeons</a>
                <p className="gw-muted">{groups.acquired.length ? 'Your collected gear is in Acquired below. Browse dungeons to find your next upgrade.' : 'Open a dungeon and wishlist items from its loot.'}</p>
              </div>
          {groups.acquired.length ? (
            <details className="gw-wish__acquired">
              <summary>Acquired ({groups.acquired.length})</summary>
              <ol className="gw-wish__list" aria-label="Acquired items">{groups.acquired.map(row)}</ol>
            </details>
          ) : null}
          {error ? <p className="gw-objectives__error" role="alert">{error}</p> : null}
          <p className="gw-muted gw-wish__note">
            Saved wishlist changes sync through your bridge to WoW. Use <kbd>/reload</kbd> after the bridge updates for new in-game drop alerts.
            {data.ownershipKnown ? '' : ' Bags and equipment have not synced for this character yet.'}
          </p>
        </>
      ) : null}
    </Panel>
  )
}

export default function DungeonLoot({ server, query, characters = [] }) {
  const mine = useMemo(() => characters.filter((entry) => onServerKey(entry, server)), [characters, server])
  const character = resolveCharacter(mine, query.character)
  const wishlist = useLiveResource(character ? '/api/player/wishlists/' + encodeURIComponent(character.id) : '', { topics: TOPICS, enabled: Boolean(character) })
  const mutate = useWishlistMutation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)

  const characterId = character?.id || ''
  const exploreUrl = exploreHref({ server, character: characterId })
  const changeCharacter = (id) => {
    setImporting(false)
    setError('')
    navigate(lootHref({ server, character: id }), { preserveScroll: true })
  }

  async function run(path, method, body, { inline = false } = {}) {
    setBusy(true)
    if (!inline) setError('')
    try {
      const result = await mutate(path, method, body)
      if (result?.items) wishlist.mutate(result)
      return true
    } catch (failure) {
      if (!inline) setError(failure?.status === 409 ? 'This wishlist is full.' : failure?.status === 422 ? 'Guildweaver does not know that item yet.' : 'That change was not saved. Try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gw-stack gw-loot">
      <div className="gw-loot__bar">
        <label className="gw-select">
          <span>Wishlist for</span>
          <select value={characterId} aria-label="Character" disabled={!mine.length} onChange={(event) => changeCharacter(event.target.value)}>
            {mine.length ? null : <option value="">No character synced yet</option>}
            {mine.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.level ? ' · ' + entry.level : ''}{entry.className ? ' ' + entry.className : ''}</option>)}
          </select>
        </label>
        <span className="gw-loot__bar-space" />
        <a className="gw-btn gw-btn--sm" href={exploreUrl}><Icon name="dungeon" size={14} /> Browse dungeons</a>
        <button type="button" className="gw-btn gw-btn--sm gw-btn--ghost" disabled={!character} aria-expanded={importing}
          onClick={() => setImporting((open) => !open)}><Icon name="sparkle" size={14} /> {importing ? 'Close import' : 'Import list'}</button>
      </div>

      {importing && character ? (
        <WishlistImport character={character} dungeon={null} title="Import wishlist" onClose={() => setImporting(false)}
          onImported={(next) => { if (next) wishlist.mutate(next) }} />
      ) : null}

      {character ? (
        <Wishlist character={character} resource={wishlist} run={run} busy={busy} error={error}
          exploreUrl={exploreUrl} guideHref={(instanceId) => withAtlasOpen(lootHref({ server, character: characterId }), { open: instanceId, section: 'loot' })} />
      ) : (
        <EmptyState title="No character to plan for yet." icon="characters">
          Sync a character with Guildweaver to manage its wishlist.
        </EmptyState>
      )}
    </div>
  )
}
