import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { relativeTime } from '../playerModel.js'
import { EmptyState, ErrorState, Icon, SkeletonRows } from '../ui.jsx'
import {
  ATLAS_SECTIONS,
  FIT_COPY,
  bossKey,
  bossLoot,
  defaultRole,
  dungeonItems,
  dungeonKind,
  entryKey,
  gearTargets,
  groupAbilities,
  levelFit,
  levelText,
  loadFailureDetail,
  markerPosition,
  needsUnverifiedBadge,
  normalizeAtlas,
  provenanceCopy,
  quickGuide,
  trapFocusIndex,
  wishlistTargets,
  wishlistToggleRequest,
  withAtlasOpen,
  worldMapHref,
} from './atlasModel.js'
import { LootList, UnverifiedBadge } from './AtlasLoot.jsx'
import { PrepareView, QuestList, QuickGuide, RoleSelect, Runs } from './AtlasPrepare.jsx'
import PlanMyGear from './PlanMyGear.jsx'
import { useDungeonDetail, useWishlist, useWishlistMutation } from './useAtlasData.js'
import './DungeonAtlas.css'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

// Escape closes, Tab stays inside, and focus goes back where it was.
function useDialogFocus(panelRef, onClose) {
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })
  useEffect(() => {
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
  }, [panelRef])
}

// A floor map with boss (and rare) markers where their positions are known.
// Without map art it is the spawn layout: every creature position in the
// dungeon, drawn by the site. Multi-level dungeons overlap on it.
function FloorMap({ map, bosses, rares = [], onBoss, highlight = '' }) {
  const onFloor = (entry) => (entry.floorId ?? map.floorId) === map.floorId && markerPosition(entry.mapPosition)
  const placed = bosses.filter(onFloor)
  const placedRares = rares.filter(onFloor)
  const layout = !map.imageUrl
  const caption = layout ? 'Spawn layout: every creature position, north up. Not an in-game map; levels overlap.' : map.name
  return (
    <figure className="gw-atlas-floor">
      <div className={`gw-atlas-floor__frame${layout ? ' gw-atlas-floor__frame--layout' : ''}`} style={map.width && map.height ? { aspectRatio: `${map.width} / ${map.height}` } : undefined}>
        {layout ? (
          <svg className="gw-atlas-floor__plot" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Creature positions in this dungeon">
            {map.points.map(([x, y]) => <rect key={`${x}:${y}`} x={x * 100 - 0.5} y={y * 100 - 0.5} width="1" height="1" />)}
          </svg>
        ) : <img src={map.imageUrl} alt={`Map of ${map.name || 'this floor'}`} loading="lazy" />}
        {placedRares.map((rare) => (
          <span key={`rare-${rare.npcId || rare.name}`} className="gw-atlas-floor__marker gw-atlas-floor__marker--rare" style={markerPosition(rare.mapPosition)}
            title={`${rare.name} (rare)`} aria-label={`${rare.name}, rare, on the map`} role="img">★</span>
        ))}
        {placed.map((boss) => (
          <button key={bossKey(boss)} type="button" className={`gw-atlas-floor__marker${highlight === bossKey(boss) ? ' is-active' : ''}`}
            style={markerPosition(boss.mapPosition)} aria-label={`${boss.name} on the map`} title={boss.name} onClick={() => onBoss?.(boss)}>
            {bosses.indexOf(boss) + 1}
          </button>
        ))}
      </div>
      {caption ? <figcaption className="gw-muted">{caption}{placed.length < bosses.length ? ' Some boss positions are not known.' : ''}</figcaption> : null}
    </figure>
  )
}

function levelRange(entry) {
  if (!entry.levelMin) return ''
  return entry.levelMax && entry.levelMax !== entry.levelMin ? `level ${entry.levelMin}–${entry.levelMax}` : `level ${entry.levelMin}`
}

// Elite trash whose casts can wipe a pull: concise, expandable.
function DangerousTrash({ creatures }) {
  if (!creatures.length) return null
  return (
    <section className="gw-atlas-trash" aria-label="Dangerous trash">
      <h3>Dangerous trash</h3>
      <ul>
        {creatures.map((creature) => (
          <li key={creature.npcId || creature.name}>
            <details>
              <summary>
                <strong>{creature.name}</strong>
                <span className="gw-muted">{[creature.count > 1 ? `×${creature.count}` : null, levelRange(creature)].filter(Boolean).join(' · ')}</span>
                {(creature.abilities || []).filter((ability) => ability.priority === 'high').slice(0, 3).map((ability) => (
                  <span key={ability.spellId || ability.name} className="gw-tag gw-tag--warn">{ability.name}</span>
                ))}
              </summary>
              <Abilities abilities={creature.abilities || []} />
            </details>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Portrait({ boss, size = 44 }) {
  return boss.portraitUrl
    ? <img className="gw-atlas-portrait" src={boss.portraitUrl} alt="" width={size} height={size} />
    : <span className="gw-atlas-portrait gw-atlas-portrait--blank" style={{ width: size, height: size }} aria-hidden="true">{String(boss.name || '?').slice(0, 1)}</span>
}

function AbilityCard({ ability }) {
  return (
    <li className={`gw-atlas-ability gw-atlas-ability--${ability.priority || 'low'}`}>
      <details>
        <summary>
          <strong>{ability.name}</strong>
          {ability.priority === 'high' ? <span className="gw-tag gw-tag--warn">High priority</span> : null}
          {ability.interruptible === true ? <span className="gw-tag gw-tag--ok">Interruptible</span> : ability.interruptible === false ? <span className="gw-tag gw-tag--quiet">Not interruptible</span> : null}
          {needsUnverifiedBadge(ability) ? <UnverifiedBadge /> : null}
          <span className="gw-atlas-ability__summary">{ability.summary}</span>
        </summary>
        <p>{ability.details || 'No further details yet.'}</p>
        {ability.spellId ? <p className="gw-muted">Spell {ability.spellId}{ability.source ? ` · ${provenanceCopy({ source: ability.source }).label}` : ''}</p> : null}
      </details>
    </li>
  )
}

function Abilities({ abilities }) {
  const groups = groupAbilities(abilities)
  if (!groups.length) return <p className="gw-muted">No abilities recorded for this boss yet.</p>
  return groups.map((group) => (
    <section key={group.category} className="gw-atlas-abilities">
      <h4>{group.label}</h4>
      <ul>{group.abilities.map((ability) => <AbilityCard key={ability.spellId || ability.name} ability={ability} />)}</ul>
    </section>
  ))
}

function Strategy({ strategy }) {
  const lines = [['summary', 'Summary'], ['tank', 'Tank'], ['healer', 'Healer'], ['dps', 'Damage']].filter(([key]) => strategy?.[key])
  if (!lines.length) return null
  return <dl className="gw-atlas-strategy">{lines.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{strategy[key]}</dd></div>)}</dl>
}

function Facts({ entry, atlas, character }) {
  const fit = levelFit(atlas, character)
  const kind = dungeonKind(entry)
  const facts = [
    ['Levels', levelText(atlas).replace(/^Levels? /, '') || null],
    ['Recommended', atlas.recommendedLevel],
    ['Zone', atlas.zoneName || null],
    ['Type', kind ? (kind === 'raid' ? 'Raid' : 'Dungeon') : null],
    ['Bosses', atlas.bossCount ?? (atlas.bosses.length || null)],
    ['Rares', atlas.rareCount ?? (atlas.rares.length || null)],
    ['Quests', atlas.questCount ?? (atlas.quests.length || null)],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '')
  return (
    <>
      {fit && character ? <p className={`gw-tag gw-tag--${FIT_COPY[fit].tone} gw-atlas-fit`}>{FIT_COPY[fit].label} {character.name} (level {character.level})</p> : null}
      {facts.length ? <dl className="gw-atlas-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
    </>
  )
}

// The selected character's short answer: what is in it for them here.
function ForCharacter({ character, gearCount, wishCount, onPrepare }) {
  if (!character) return null
  const parts = [
    gearCount !== null ? `${gearCount} item${gearCount === 1 ? '' : 's'} ${character.name} can use` : null,
    wishCount ? `${wishCount} on the wishlist` : null,
  ].filter(Boolean)
  return (
    <div className="gw-atlas-forme">
      <span>{parts.length ? parts.join(' · ') : `Nothing known here for ${character.name} yet.`}</span>
      <button type="button" className="gw-btn gw-btn--sm" onClick={onPrepare}>Prepare for this run</button>
    </div>
  )
}

// The wings of a dungeon played as separate dungeons, each its own page.
function Wings({ atlas }) {
  if (!atlas.wingEntries.length || atlas.wing) return null
  const here = typeof window === 'undefined' ? '/dashboard/dungeons' : `${window.location.pathname}${window.location.search}${window.location.hash}`
  return (
    <section className="gw-atlas-wings" aria-label="Wings">
      <h3>Wings</h3>
      <p className="gw-muted">Each wing is entered and run on its own. This page covers the whole dungeon.</p>
      <ul className="gw-atlas-plain">
        {atlas.wingEntries.map((wing) => (
          <li key={wing.dungeonKey}>
            <a className="gw-link" href={withAtlasOpen(here, { open: wing.dungeonKey })}>{wing.name}</a>
            {wing.levelMin ? <span className="gw-muted"> · {levelText(wing).toLowerCase()}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

// What a wing does not own: shared quests and trash, unplaced bosses.
function WingNote({ atlas }) {
  if (!atlas.wing) return null
  const unplaced = [...atlas.unassigned.bosses, ...atlas.unassigned.rares]
  return (
    <p className="gw-muted gw-atlas-provenance">
      {atlas.floors.length ? `Floors: ${atlas.floors.map((floor) => floor.name).join(', ')}. ` : ''}
      Quests, trash and chest loot are listed for the whole dungeon: no source ties them to one wing.
      {unplaced.length ? ` Not placed in a wing: ${unplaced.join(', ')}.` : ''}
      {atlas.levelSource === 'parent' ? ' The level band is the whole dungeon\'s.' : ''}
    </p>
  )
}

function Overview({ entry, atlas, character, onBoss, forCharacter }) {
  return (
    <div className="gw-atlas-section">
      {atlas.description ? <p>{atlas.description}</p> : null}
      <Facts entry={entry} atlas={atlas} character={character} />
      {forCharacter}
      <Wings atlas={atlas} />
      <WingNote atlas={atlas} />
      {atlas.bosses.length ? (
        <>
          <h3>Bosses</h3>
          <ol className="gw-atlas-boss-chips">
            {atlas.bosses.map((boss) => {
              const high = (boss.abilities || []).filter((ability) => ability.priority === 'high').length
              return (
                <li key={bossKey(boss)}>
                  <button type="button" className="gw-atlas-boss-chip" onClick={() => onBoss(boss)}>
                    <Portrait boss={boss} size={28} />
                    <span>{boss.name}</span>
                    {groupAbilities(boss.abilities).some((group) => group.category === 'interrupt') ? <span className="gw-tag gw-tag--info">Interrupts</span> : null}
                    {high ? <span className="gw-tag gw-tag--warn">{high} high priority</span> : null}
                  </button>
                </li>
              )
            })}
          </ol>
        </>
      ) : null}
      {atlas.maps.map((map) => <FloorMap key={map.floorId ?? map.imageUrl} map={map} bosses={atlas.bosses} rares={atlas.rares} onBoss={onBoss} />)}
      {atlas.rares.length ? (
        <>
          <h3>Rares</h3>
          <ul className="gw-atlas-plain">{atlas.rares.map((rare) => (
            <li key={rare.npcId || rare.name}>
              <strong>{rare.name}</strong> <span className="gw-muted">{[rare.elite ? 'rare elite' : 'rare', levelRange(rare), markerPosition(rare.mapPosition) ? 'on the map (★)' : null].filter(Boolean).join(' · ')}</span>
            </li>
          ))}</ul>
        </>
      ) : null}
      {!atlas.known ? (
        <p className="gw-muted gw-atlas-gap">Levels, bosses, maps and quests for this dungeon are not in the atlas yet. Its loot is in the Loot tab.</p>
      ) : null}
      {atlas.provenance.length ? (
        <p className="gw-muted gw-atlas-provenance">
          Sources: {atlas.provenance.map((line, index) => (
            <span key={`${line.source}-${index}`}>{index ? ', ' : ''}{provenanceCopy(line).label}{line.revision ? ` (${line.revision})` : ''}{line.retrievedAt ? `, ${relativeTime(line.retrievedAt)}` : ''}</span>
          ))}
          {atlas.referenceVersion ? <span>; reference loot {atlas.referenceVersion.dataset} {atlas.referenceVersion.revision}</span> : null}
        </p>
      ) : null}
    </div>
  )
}

// Why a boss lists no loot, from what is known: chest encounters, and
// whether the Classic reference was loaded at all.
function bossLootEmpty(boss, atlas) {
  const chests = [...new Set(atlas.dungeonLoot.filter((entry) => entry && !entry.npcId && entry.sourceName).map((entry) => entry.sourceName))]
  if (chests.length) return `No loot linked to ${boss.name}. Chest loot (${chests.join(', ')}) is in the Loot tab.`
  if (atlas.referenceVersion) return `No loot linked to ${boss.name}: Guildweaver has not seen it drop, and the Classic reference lists none for this encounter.`
  return `No loot linked to ${boss.name} yet.`
}

function BossDetail({ boss, atlas, detail, role, onRole, character, lootProps }) {
  const map = atlas.maps.find((entry) => entry.floorId === boss.floorId) || atlas.maps[0]
  const abilities = boss.abilities || []
  const guide = quickGuide(abilities, role)
  return (
    <article className="gw-atlas-boss" aria-label={boss.name}>
      <header className="gw-atlas-boss__head">
        <Portrait boss={boss} size={56} />
        <div>
          <h3>{boss.name}</h3>
          {boss.npcId ? <p className="gw-muted">NPC {boss.npcId}{boss.encounterId ? ` · encounter ${boss.encounterId}` : ''}</p> : null}
        </div>
      </header>
      {abilities.length ? (
        <>
          <RoleSelect role={role} onRole={onRole} character={character} />
          <QuickGuide abilities={abilities} role={role} />
        </>
      ) : null}
      <Strategy strategy={boss.strategy} />
      {abilities.length ? (
        <details className="gw-atlas-allabilities" open={!guide.length}>
          <summary><h4 className="gw-atlas-subhead">All abilities ({abilities.length})</h4></summary>
          <Abilities abilities={abilities} />
        </details>
      ) : <p className="gw-muted">No abilities recorded for this boss yet.</p>}
      {map && markerPosition(boss.mapPosition) ? <FloorMap map={map} bosses={[boss]} highlight={bossKey(boss)} /> : null}
      <h4 className="gw-atlas-subhead">Loot</h4>
      <LootList rows={bossLoot(boss, detail)} empty={bossLootEmpty(boss, atlas)} {...lootProps} />
    </article>
  )
}

function Bosses({ atlas, detail, boss, onBoss, ...rest }) {
  const selected = atlas.bosses.find((entry) => bossKey(entry) === boss) || atlas.bosses[0]
  if (!atlas.bosses.length) {
    return (
      <>
        <p className="gw-muted gw-atlas-empty">No boss details in the atlas yet. The Loot tab lists bosses seen dropping loot.</p>
        <DangerousTrash creatures={atlas.creatures} />
      </>
    )
  }
  return (
    <>
      <div className="gw-atlas-bosses">
        <nav aria-label="Bosses">
          <ol>
            {atlas.bosses.map((entry) => (
              <li key={bossKey(entry)}>
                <button type="button" aria-current={entry === selected ? 'true' : undefined} onClick={() => onBoss(entry)}>
                  <Portrait boss={entry} size={24} /> {entry.name}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <BossDetail key={bossKey(selected)} boss={selected} atlas={atlas} detail={detail} {...rest} />
      </div>
      <DangerousTrash creatures={atlas.creatures} />
    </>
  )
}

const LOOT_KINDS = [['', 'All loot'], ['observed', 'Seen by Guildweaver'], ['reference', 'Classic reference only']]

function Loot({ items, character, atlas, lootProps }) {
  const [kind, setKind] = useState('')
  const [usable, setUsable] = useState(false)
  const usableKeys = useMemo(() => new Set(gearTargets(items, character, atlas).map((row) => row.item.itemKey)), [items, character, atlas])
  const rows = items.filter((row) => (kind === 'observed' ? row.observed : kind === 'reference' ? !row.observed : true) && (!usable || usableKeys.has(row.item.itemKey)))
  const hasReference = items.some((row) => row.reference && !row.observed)
  return (
    <div className="gw-atlas-section">
      <div className="gw-atlas-lootbar">
        {hasReference ? (
          <label className="gw-filter">
            <span>Show</span>
            <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Which loot">
              {LOOT_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        ) : null}
        {character ? <label className="gw-loot__check"><input type="checkbox" checked={usable} onChange={(event) => setUsable(event.target.checked)} /> Only what {character.name} can use</label> : null}
      </div>
      {!character ? <p className="gw-muted">Choose a character to keep a wishlist.</p> : null}
      {hasReference ? <p className="gw-muted gw-atlas-provenance">Classic reference items come from Classic data, not Guildweaver sightings. They are not verified for Forever and no drop chances are shown.</p> : null}
      <LootList rows={rows} empty={items.length ? 'No loot matches.' : 'No loot recorded here yet.'} {...lootProps} />
    </div>
  )
}

// One dungeon, opened from anywhere: cards, runs, loot, the wishlist and
// the world map. Tabs and the boss shown live in the URL (?open=&section=
// &boss=), so the view can be linked and Back closes it.
export default function DungeonDetailModal({
  instanceId, entry = null, dungeons = [], character = null, characters = [], onCharacter = null,
  server = '', section = 'overview', boss = '', onNavigate, onClose, showMapLink = true,
}) {
  const panelRef = useRef(null)
  const titleId = useId()
  useDialogFocus(panelRef, onClose)
  const detail = useDungeonDetail(instanceId)
  const wishlist = useWishlist(character?.id || '')
  const mutate = useWishlistMutation()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [planning, setPlanning] = useState(false)
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

  const openBoss = (target) => onNavigate({ section: 'bosses', boss: bossKey(target) })
  const onSource = (row) => (row.bossKey ? onNavigate({ section: 'bosses', boss: row.bossKey }) : row.sourceKind === 'quest' ? onNavigate({ section: 'quests', boss: '' }) : null)
  const lootProps = { wishes, character, busyKey: busy, onToggle: toggle, onSource }

  return (
    <div className="gw-atlas-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={panelRef} className="gw-atlas-modal__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="gw-atlas-modal__head" style={atlas.artworkUrl ? { '--art': `url("${atlas.artworkUrl}")` } : undefined}>
          <div className="gw-atlas-modal__title">
            <p className="gw-muted">{[dungeonKind(merged) === 'raid' ? 'Raid' : 'Dungeon', atlas.zoneName, levelText(atlas)].filter(Boolean).join(' · ')}</p>
            <h2 id={titleId}>{name}</h2>
          </div>
          <div className="gw-atlas-modal__actions">
            {characters.length > 1 && onCharacter ? (
              <label className="gw-filter gw-atlas-modal__character">
                <span>Character</span>
                <select value={character?.id || ''} onChange={(event) => onCharacter(event.target.value)} aria-label="Character">
                  {characters.map((option) => <option key={option.id} value={option.id}>{option.name}{option.level ? ` · ${option.level}` : ''}</option>)}
                </select>
              </label>
            ) : character ? <span className="gw-muted gw-atlas-modal__who">For {character.name}{character.level ? ` · ${character.level}` : ''}</span> : null}
            {showMapLink && atlas.entrance ? <a className="gw-btn gw-btn--sm" href={worldMapHref({ ...merged, instanceId: gameInstanceId, atlas })}><Icon name="map" size={14} /> World map</a> : null}
            <button type="button" className="gw-btn gw-btn--sm gw-btn--primary" disabled={!character} aria-expanded={planning} onClick={() => setPlanning((open) => !open)}
              title={character ? undefined : 'Sync a character to plan gear'}>
              <Icon name="sparkle" size={14} /> Plan my gear
            </button>
            <button type="button" className="gw-icon-btn gw-icon-btn--quiet" aria-label="Close" data-autofocus onClick={onClose}><Icon name="close" /></button>
          </div>
        </header>

        <nav className="gw-seg gw-atlas-tabs" aria-label={`${name} sections`}>
          {ATLAS_SECTIONS.map(([id, label]) => (
            <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => onNavigate({ section: id, boss: '' })}>{label}</button>
          ))}
        </nav>

        <div className="gw-atlas-modal__body">
          {planning && character ? (
            <PlanMyGear character={character} characters={characters} onCharacter={onCharacter} dungeon={{ instanceId: gameInstanceId, name }} dungeons={dungeons}
              onClose={() => setPlanning(false)} onImported={(next) => { if (next) wishlist.mutate(next) }} />
          ) : null}
          {error ? <p className="gw-objectives__error" role="alert">{error}</p> : null}
          {detail.status === 'loading' && !detail.data ? <SkeletonRows rows={5} label={`Loading ${name}`} /> : null}
          {(detail.status === 'error' || detail.status === 'missing') && !detail.data ? <ErrorState onRetry={detail.reload}>This dungeon could not be loaded{loadFailureDetail(detail.error)}.</ErrorState> : null}
          {/* While the detail loads, only Overview can draw from the list entry: other sections would show empty states. */}
          {detail.data || (listEntry && (section === 'overview' || detail.status !== 'loading')) ? (
            <>
              {section === 'overview' ? (
                <Overview entry={merged} atlas={atlas} character={character} onBoss={openBoss}
                  forCharacter={<ForCharacter character={character} gearCount={gearCount} wishCount={wishCount} onPrepare={() => onNavigate({ section: 'prepare', boss: '' })} />} />
              ) : null}
              {section === 'prepare' ? (
                <PrepareView entry={merged} atlas={atlas} detail={detail.data} character={character} server={server} role={role} onRole={setRole}
                  wishes={wishes} lootProps={lootProps} onBoss={openBoss} onPlan={character ? () => setPlanning(true) : null} />
              ) : null}
              {section === 'bosses' ? <Bosses atlas={atlas} detail={detail.data} boss={boss} onBoss={openBoss} role={role} onRole={setRole} character={character} lootProps={lootProps} /> : null}
              {section === 'loot' ? <Loot items={items} character={character} atlas={atlas} lootProps={lootProps} /> : null}
              {section === 'quests' ? (
                <div className="gw-atlas-section">
                  {atlas.wing && atlas.quests.length ? <p className="gw-muted">These are the whole dungeon's quests: no source ties a quest to one wing.</p> : null}
                  <QuestList quests={atlas.quests} rewardProps={lootProps} />
                </div>
              ) : null}
              {section === 'runs' ? <Runs entry={merged} character={character} server={server} /> : null}
            </>
          ) : detail.status === 'ready' ? <EmptyState title="Nothing known about this dungeon yet." icon="dungeon" /> : null}
        </div>
      </section>
    </div>
  )
}
