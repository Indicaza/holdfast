import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { EmptyState, ErrorState, Icon, SkeletonRows } from '../ui.jsx'
import {
  ATLAS_SECTIONS,
  FIT_COPY,
  atlasSection,
  bossKey,
  defaultRole,
  dungeonItems,
  dungeonKind,
  entryKey,
  fitDetail,
  fitText,
  gearTargets,
  levelFit,
  levelText,
  loadFailureDetail,
  lootBySource,
  normalizeAtlas,
  readinessModel,
  trapFocusIndex,
  wishlistTargets,
  wishlistToggleRequest,
  worldMapHref,
} from './atlasModel.js'
import { Runs } from './AtlasPrepare.jsx'
import { DungeonOverview, ForCharacter, LootSection, QuestsSection } from './JournalContent.jsx'
import JournalWorkspace from './JournalWorkspace.jsx'
import PlanMyGear from './PlanMyGear.jsx'
import { useDungeonDetail, useDungeonPlan, useDungeonReadiness, useWishlist, useWishlistMutation } from './useAtlasData.js'
import './DungeonAtlas.css'
import './DungeonJournal.css'
import './JournalWorkspace.css'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

// Escape closes, Tab stays inside, and focus goes back where it was.
function useDialogFocus(panelRef, onClose, enabled = true) {
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })
  useEffect(() => {
    if (!enabled) return undefined
    const previous = document.activeElement
    const panel = panelRef.current
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel?.querySelector('[data-autofocus]')?.focus()
    function onKey(event) {
      if (event.key === 'Escape') {
        // A nested popup (a select, a tooltip) gets Escape first.
        if (event.defaultPrevented) return
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter((element) => element.offsetParent !== null || element === document.activeElement)
      const index = trapFocusIndex(items.length, items.indexOf(document.activeElement), event.shiftKey)
      if (index === null) return
      event.preventDefault()
      if (index < 0) panel.focus()
      else items[index].focus()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [panelRef, enabled])
}

function heroStyle(atlas) {
  const url = atlas.editorial?.art?.card?.url || atlas.artworkUrl
  if (!url) return undefined
  const focus = atlas.editorial?.art?.card || (atlas.artFocus ? { focusX: atlas.artFocus.x, focusY: atlas.artFocus.y } : null)
  return { '--art': `url("${url}")`, ...(focus ? { '--art-position': `${(focus.focusX ?? 0.5) * 100}% ${(focus.focusY ?? 0.5) * 100}%` } : {}) }
}

// One dungeon as a small application: Journal (map, encounters, mechanics and
// loot), Quests (the checklist beside the map) and the character's runs. The
// section, boss and All loot live in the URL (?open=&section=&boss=&loot=),
// so the view can be linked and Back returns to where it was opened.
//
// layout: 'page' (the Dungeons page's own view of a dungeon), 'dialog' (over
// another page, such as the world map) or 'embedded' (the Dungeon Content
// Studio's preview, drawn in place from previewDetail without fetching).
export default function DungeonDetailModal({
  instanceId, entry = null, dungeons = [], character = null, characters = [], onCharacter = null,
  server = '', section: sectionProp = 'journal', boss = '', allLoot: allLootProp = false, onNavigate, onClose, showMapLink = true,
  previewDetail = null, embedded = false, layout: layoutProp = 'dialog', backHref = '', backLabel = 'All dungeons',
}) {
  const layout = embedded ? 'embedded' : layoutProp
  const section = atlasSection(sectionProp)
  // An old caller's section="loot" is the Journal with All loot on.
  const allLoot = allLootProp || sectionProp === 'loot'
  const panelRef = useRef(null)
  const headingRef = useRef(null)
  const titleId = useId()
  useDialogFocus(panelRef, onClose, layout === 'dialog')
  useEffect(() => {
    if (layout === 'page') headingRef.current?.focus({ preventScroll: true })
  }, [layout])
  const fetched = useDungeonDetail(previewDetail ? '' : instanceId)
  const detail = useMemo(() => (previewDetail ? { status: 'ready', data: previewDetail, error: null, reload: () => {} } : fetched), [previewDetail, fetched])
  const wishlist = useWishlist(character?.id || '')
  const mutate = useWishlistMutation()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [planning, setPlanning] = useState(false)
  const [focusSource, setFocusSource] = useState('')
  // The quick guide's role follows the character until the player picks one.
  const [roleChoice, setRoleChoice] = useState({ characterId: character?.id || '', role: null })
  const role = roleChoice.characterId === (character?.id || '') && roleChoice.role !== null ? roleChoice.role : defaultRole(character)
  const setRole = (next) => setRoleChoice({ characterId: character?.id || '', role: next })

  // instanceId is what ?open= holds: the game's instance ID (the whole
  // dungeon) or a wing's key.
  const listEntry = entry || dungeons.find((dungeon) => String(entryKey(dungeon)) === String(instanceId)) || null
  const wing = detail.data?.wing || null
  const merged = useMemo(() => ({ ...(detail.data?.instance || {}), ...(listEntry || {}),
    ...(wing ? { dungeonKey: wing.dungeonKey, wing: wing.wing, name: wing.name, instanceName: detail.data.instance?.name } : {}),
    atlas: detail.data?.atlas || listEntry?.atlas }), [detail.data, listEntry, wing])
  // The game's instance: what the wishlist, gear planning and runs use.
  const gameInstanceId = Number(detail.data?.instance?.instanceId ?? listEntry?.instanceId ?? instanceId) || null
  const gameInstanceName = merged.instanceName || detail.data?.instance?.name || listEntry?.name || ''
  const siblings = useMemo(() => dungeons.filter((dungeon) => Number(dungeon.instanceId) === gameInstanceId), [dungeons, gameInstanceId])
  const atlas = useMemo(() => {
    const full = normalizeAtlas(merged.atlas)
    const fromList = normalizeAtlas(listEntry?.atlas)
    return { ...fromList, ...Object.fromEntries(Object.entries(full).filter(([, value]) => value !== null && value !== '' && !(Array.isArray(value) && !value.length))), known: full.known || fromList.known }
  }, [merged, listEntry])
  const name = merged.name || `Dungeon ${instanceId}`
  const wishes = useMemo(() => new Map((wishlist.data?.items || []).map((item) => [item.itemKey, item])), [wishlist.data])
  const items = useMemo(() => dungeonItems(detail.data || {}, atlas), [detail.data, atlas])
  const groups = useMemo(() => lootBySource(detail.data || {}, atlas), [detail.data, atlas])
  const bySource = useMemo(() => new Map(groups.flatMap((group) => group.sources.map((source) => [source.key, source.rows]))), [groups])
  const gearCount = detail.data && character ? gearTargets(items, character, atlas).length : null
  const wishCount = useMemo(() => {
    const self = listEntry && entryKey(listEntry) === entryKey(merged) ? listEntry
      : { ...merged, instanceId: gameInstanceId, atlas: { ...(listEntry?.atlas || {}), referenceItemIds: atlas.referenceItemIds } }
    const context = [self, ...siblings.filter((dungeon) => entryKey(dungeon) !== entryKey(self))]
    const keys = new Set(wishlistTargets(wishlist.data?.items || [], context).get(entryKey(self)) || [])
    for (const row of items) if (wishes.get(row.item.itemKey) && wishes.get(row.item.itemKey).state !== 'acquired') keys.add(row.item.itemKey)
    return keys.size
  }, [wishlist.data, listEntry, merged, gameInstanceId, siblings, atlas.referenceItemIds, items, wishes])

  async function toggle(item, wanted) {
    if (!character) return
    const request = wishlistToggleRequest(character.id, item, wanted, gameInstanceId ? { instanceId: gameInstanceId, name: gameInstanceName || name } : null)
    setBusy(item.itemKey)
    setError('')
    try {
      const result = await mutate(request.path, request.method, request.body)
      if (result?.items) wishlist.mutate(result)
    } catch (failure) {
      setError(failure?.status === 409 ? 'This wishlist is full.' : failure?.status === 422 ? `Guildweaver does not know ${item.name || 'that item'} yet, so it cannot go on the wishlist.` : 'That change was not saved. Try again.')
    } finally {
      setBusy('')
    }
  }

  const openBoss = (target) => onNavigate({ section: 'journal', boss: bossKey(target), ...(allLoot ? { allLoot: true } : {}) })
  const openOverview = () => onNavigate({ section: 'journal', boss: '' })
  const openQuests = () => onNavigate({ section: 'quests', boss })
  const openLoot = () => onNavigate({ section: 'journal', boss, allLoot: true })
  // From an item to its source: a boss's guide, the quests, or the source's
  // block in the loot list.
  const onSource = (source) => {
    if (!source) return
    if ((source.kind === 'boss' || source.sourceKind === 'boss') && source.bossKey) onNavigate({ section: 'journal', boss: source.bossKey, ...(allLoot ? { allLoot: true } : {}) })
    else if (source.kind === 'quest' || source.sourceKind === 'quest') openQuests()
    else if (source.key) {
      setFocusSource(source.key)
      if (!allLoot || section !== 'journal') openLoot()
    }
  }
  const lootProps = { wishes, character, busyKey: busy, onToggle: toggle, onSource }
  // The character's quest readiness (instanceId is a dungeon or a wing key).
  const readiness = useDungeonReadiness(character ? instanceId : '', character?.id || '')
  // The preparation plan, only while Quests is open; it follows new uploads live.
  const plan = useDungeonPlan(character && section === 'quests' ? instanceId : '', character?.id || '')
  const readinessSummary = useMemo(() => readinessModel(readiness.data), [readiness.data])
  const fit = character ? levelFit(atlas, character) : null
  const ready = Boolean(detail.data || (listEntry && (section === 'journal' || detail.status !== 'loading')))

  const showAllLoot = (next) => onNavigate({ section: 'journal', boss, allLoot: next })
  const heroArt = heroStyle(atlas)
  const content = (
    <>
      <header className={`gw-jw-head${heroArt ? ' gw-jw-head--art' : ''}`} style={heroArt}>
        {layout === 'page' && backHref ? <a className="gw-atlas-back" href={backHref} aria-label={backLabel} title={backLabel}><Icon name="back" size={14} /><span>{backLabel}</span></a> : null}
        <div className="gw-jw-head__title gw-atlas-hero__title">
          <h2 id={titleId} ref={headingRef} tabIndex={-1}>{name}</h2>
          <p className="gw-jw-head__meta">
            {atlas.subtitle ? <span>{atlas.subtitle}</span> : null}
            <span>{[dungeonKind(merged) === 'raid' ? 'Raid' : 'Dungeon', atlas.zoneName, levelText(atlas)].filter(Boolean).join(' · ')}</span>
            {fit ? <span className={`gw-atlas-hero__fit gw-atlas-hero__fit--${FIT_COPY[fit].tone}`} title={fitDetail(atlas, character)}>{fitText(fit, character)}</span> : null}
          </p>
        </div>
        <nav className="gw-seg gw-atlas-tabs gw-jw-tabs" aria-label={`${name} sections`}>
          {ATLAS_SECTIONS.map(([id, label]) => (
            <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => onNavigate({ section: id, boss, allLoot: id === 'journal' && allLoot })}>{label}</button>
          ))}
        </nav>
        <div className="gw-jw-head__actions">
          {characters.length > 1 && onCharacter ? (
            <label className="gw-filter gw-atlas-modal__character">
              <span className="gw-sr-only">Character</span>
              <select value={character?.id || ''} onChange={(event) => onCharacter(event.target.value)} aria-label="Character">
                {characters.map((option) => <option key={option.id} value={option.id}>{option.name}{option.level ? ` · ${option.level}` : ''}</option>)}
              </select>
            </label>
          ) : character ? <span className="gw-atlas-modal__who">For {character.name}{character.level ? ` · ${character.level}` : ''}</span> : null}
          {showMapLink && atlas.entrance ? <a className="gw-atlas-maplink" href={worldMapHref({ ...merged, instanceId: gameInstanceId, atlas })}><Icon name="map" size={14} /> World map</a> : null}
          {layout === 'dialog' ? <button type="button" className="gw-icon-btn gw-icon-btn--quiet" aria-label="Close" data-autofocus onClick={onClose}><Icon name="close" /></button> : null}
        </div>
      </header>

      {error ? <p className="gw-objectives__error gw-jw-error" role="alert">{error}</p> : null}
      {detail.status === 'loading' && !detail.data ? <div className="gw-jw-status"><SkeletonRows rows={5} label={`Loading ${name}`} /></div> : null}
      {(detail.status === 'error' || detail.status === 'missing') && !detail.data ? <div className="gw-jw-status"><ErrorState onRetry={detail.reload}>This dungeon could not be loaded{loadFailureDetail(detail.error)}.</ErrorState></div> : null}
      {/* While the detail loads, only the Journal can draw from the list entry: other sections would show empty states. */}
      {ready ? (
        <JournalWorkspace key={section === 'runs' ? 'runs' : 'map'} startOnFirstBoss={layout !== 'embedded'} name={name} section={section} atlas={atlas} boss={boss} allLoot={allLoot} onBoss={openBoss} onOverview={openOverview} onAllLoot={showAllLoot}
          sourceRows={(target) => bySource.get(`boss:${bossKey(target)}`) || []} role={role} onRole={setRole} character={character} lootProps={lootProps}
          overview={<DungeonOverview entry={merged} atlas={atlas}
            forCharacter={<ForCharacter character={character} gearCount={gearCount} wishCount={wishCount} readiness={readinessSummary} onLoot={openLoot} onQuests={openQuests} />} />}
          loot={(
            <LootSection groups={groups} items={items} character={character} atlas={atlas} lootProps={lootProps} selectedBossKey={boss} focus={focusSource} onFocused={() => setFocusSource('')}
              wishCount={wishCount} planning={planning} onPlan={character ? () => setPlanning((open) => !open) : null}
              planner={planning && character ? (
                <PlanMyGear character={character} characters={characters} onCharacter={onCharacter} dungeon={{ instanceId: gameInstanceId, name }} dungeons={dungeons}
                  onClose={() => setPlanning(false)} onImported={(next) => { if (next) wishlist.mutate(next) }} />
              ) : null} />
          )}
          quests={<QuestsSection atlas={atlas} character={character} readiness={readiness} plan={plan} lootProps={lootProps} />}
          runs={<Runs entry={merged} character={character} server={server} />} />
      ) : detail.status === 'ready' ? <div className="gw-jw-status"><EmptyState title="Nothing known about this dungeon yet." icon="dungeon" /></div> : null}
    </>
  )

  if (layout === 'dialog') {
    return (
      <div className="gw-atlas-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <section ref={panelRef} className="gw-atlas-modal__panel gw-jw-shell" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>{content}</section>
      </div>
    )
  }
  return (
    <section ref={panelRef} className={`gw-atlas-page gw-jw-shell${layout === 'embedded' ? ' gw-atlas-page--embedded' : ' gw-jw-shell--fill'}`} role="region" aria-labelledby={titleId}>{content}</section>
  )
}
