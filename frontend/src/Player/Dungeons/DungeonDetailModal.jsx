import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { relativeTime } from '../playerModel.js'
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
  groupAbilities,
  levelFit,
  levelText,
  loadFailureDetail,
  lootBySource,
  markerPosition,
  needsUnverifiedBadge,
  normalizeAtlas,
  provenanceCopy,
  quickGuide,
  readinessModel,
  revealSource,
  trapFocusIndex,
  wishlistTargets,
  wishlistToggleRequest,
  withAtlasOpen,
  worldMapHref,
} from './atlasModel.js'
import { LootList, SourceGroups, UnverifiedBadge } from './AtlasLoot.jsx'
import { QuestList, QuestReadiness, QuickGuide, ReadinessSummary, RoleSelect, Runs } from './AtlasPrepare.jsx'
import PlanMyGear from './PlanMyGear.jsx'
import { useDungeonDetail, useDungeonReadiness, useWishlist, useWishlistMutation } from './useAtlasData.js'
import './DungeonAtlas.css'

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

// A drawn floor map (art) with boss and rare markers where their positions
// are known.
function FloorMap({ map, bosses, rares = [], onBoss, highlight = '' }) {
  const onFloor = (entry) => (entry.floorId ?? map.floorId) === map.floorId && markerPosition(entry.mapPosition)
  const placed = bosses.filter(onFloor)
  const placedRares = rares.filter(onFloor)
  return (
    <figure className="gw-atlas-floor">
      <div className="gw-atlas-floor__frame" style={map.width && map.height ? { aspectRatio: `${map.width} / ${map.height}` } : undefined}>
        <img src={map.imageUrl} alt={`Map of ${map.name || 'this floor'}`} loading="lazy" />
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
      {map.name || placed.length < bosses.length ? (
        <figcaption className="gw-muted">{map.name}{placed.length < bosses.length ? `${map.name ? '. ' : ''}Some boss positions are not known.` : ''}</figcaption>
      ) : null}
    </figure>
  )
}

// Where creatures were recorded, drawn by the site: a reference plot, not a
// map of the dungeon, so it stays folded away under that name.
function SpawnPlot({ map }) {
  return (
    <details className="gw-atlas-spawnplot">
      <summary>Creature positions <span className="gw-muted">· recorded spawn points, not a map</span></summary>
      <figure className="gw-atlas-floor">
        <div className="gw-atlas-floor__frame gw-atlas-floor__frame--layout" style={map.width && map.height ? { aspectRatio: `${map.width} / ${map.height}` } : undefined}>
          <svg className="gw-atlas-floor__plot" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Recorded creature positions in this dungeon">
            {map.points.map(([x, y]) => <rect key={`${x}:${y}`} x={x * 100 - 0.5} y={y * 100 - 0.5} width="1" height="1" />)}
          </svg>
        </div>
        <figcaption className="gw-muted">Every recorded creature position, north up. Levels overlap: it is not an in-game map.</figcaption>
      </figure>
    </details>
  )
}

// The dungeon's maps: drawn floor maps and the studio's map art. A dungeon
// with neither shows no map at all, only its folded spawn plot if it has one.
function DungeonMaps({ atlas, onBoss }) {
  const drawn = atlas.maps.filter((map) => map.imageUrl)
  const plots = atlas.maps.filter((map) => !map.imageUrl)
  const art = atlas.editorial?.art?.map
  if (!drawn.length && !art?.url && !plots.length) return null
  return (
    <>
      {drawn.length || art?.url ? (
        <section className="gw-atlas-maps" aria-label="Map">
          <h3>Map</h3>
          {drawn.map((map) => <FloorMap key={map.floorId ?? map.imageUrl} map={map} bosses={atlas.bosses} rares={atlas.rares} onBoss={onBoss} />)}
          {!drawn.length && art?.url ? <img className="gw-atlas-art gw-atlas-art--map" src={art.url} alt={`Map of ${atlas.zoneName || 'the dungeon'}`} loading="lazy" /> : null}
        </section>
      ) : null}
      {plots.map((map) => <SpawnPlot key={map.floorId ?? 'layout'} map={map} />)}
    </>
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

// The boss's strategy lines: the atlas's strategy and the studio's notes.
function Strategy({ boss }) {
  const strategy = { ...(boss?.strategy || {}), positioning: boss?.positioning, interrupts: boss?.interrupts, dispels: boss?.dispels }
  const lines = [['summary', 'Summary'], ['tank', 'Tank'], ['healer', 'Healer'], ['dps', 'Damage'], ['positioning', 'Positioning'], ['interrupts', 'Interrupts'], ['dispels', 'Dispels']].filter(([key]) => strategy[key])
  if (!lines.length) return null
  return <dl className="gw-atlas-strategy">{lines.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{strategy[key]}</dd></div>)}</dl>
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

// Drops a guide lists by item ID whose details nobody has reported yet.
function UnresolvedLoot({ entries, owner }) {
  if (!entries?.length) return null
  const ids = entries.map((entry) => entry.itemId).join(', ')
  return <p className="gw-muted gw-atlas-provenance">{entries.length} more drop{entries.length === 1 ? ' is' : 's are'} listed{owner ? ` for ${owner}` : ''} without item details yet (item {ids}).</p>
}

// Editorial art, cropped around its focal point.
function EditorialArt({ art, label }) {
  if (!art?.url) return null
  return <img className="gw-atlas-art" src={art.url} alt={label} loading="lazy" style={{ objectPosition: `${(art.focusX ?? 0.5) * 100}% ${(art.focusY ?? 0.5) * 100}%` }} />
}

// The studio's dungeon notes: warnings, preparation, tips, group and route.
function EditorialNotes({ editorial, lists: keys = ['warnings', 'tips'] }) {
  if (!editorial) return null
  const lists = [['warnings', 'Warnings'], ['preparation', 'Before you go'], ['tips', 'Tips']].filter(([key]) => keys.includes(key) && editorial[key]?.length)
  const texts = [['groupComposition', 'Group composition'], ['routeNotes', 'Route']].filter(([key]) => keys.includes('warnings') && editorial[key])
  if (!lists.length && !texts.length) return null
  return (
    <section className="gw-atlas-editorial" aria-label="Dungeon guide">
      {lists.map(([key, label]) => (
        <div key={key} className={`gw-atlas-editorial__block gw-atlas-editorial__block--${key}`}>
          <h3>{label}</h3>
          <ul>{editorial[key].map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      ))}
      {texts.map(([key, label]) => (
        <div key={key} className="gw-atlas-editorial__block"><h3>{label}</h3><p>{editorial[key]}</p></div>
      ))}
    </section>
  )
}

const MECHANIC_LABELS = { interrupt: 'Interrupt', dispel: 'Dispel', positioning: 'Positioning', 'tank-danger': 'Tank danger', 'healer-danger': 'Healer danger', 'crowd-control': 'Crowd control', 'special-mechanic': 'Mechanic' }
const ROLE_LABELS = { tank: 'Tank', healer: 'Healer', dps: 'Damage' }

// The studio's mechanics callouts for a boss, in the editor's order.
function Mechanics({ mechanics }) {
  if (!mechanics?.length) return null
  return (
    <section className="gw-atlas-mechanics" aria-label="Mechanics">
      <h4 className="gw-atlas-subhead">Mechanics</h4>
      <ul>
        {mechanics.map((mechanic) => (
          <li key={mechanic.id} className={`gw-atlas-mechanic gw-atlas-mechanic--${mechanic.priority}`}>
            <div className="gw-atlas-mechanic__head">
              <strong>{mechanic.ability}</strong>
              <span className="gw-tag gw-tag--info">{MECHANIC_LABELS[mechanic.type] || 'Mechanic'}</span>
              {mechanic.priority === 'high' ? <span className="gw-tag gw-tag--warn">High priority</span> : null}
              {(mechanic.roles || []).map((role) => <span key={role} className="gw-tag gw-tag--quiet">{ROLE_LABELS[role] || role}</span>)}
              {mechanic.verified ? <span className="gw-tag gw-tag--ok">Verified on Forever</span> : <span className="gw-tag gw-tag--quiet">Not verified</span>}
            </div>
            {mechanic.instruction ? <p>{mechanic.instruction}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}


// The dungeon's facts at a glance; facts it lacks are left out.
function AtAGlance({ entry, atlas }) {
  const kind = dungeonKind(entry)
  const facts = [
    ['Levels', levelText(atlas).replace(/^Levels? /, '') || null],
    ['Recommended', atlas.recommendedLevel ? `Level ${atlas.recommendedLevel}` : null],
    ['Zone', atlas.zoneName || null],
    ['Type', kind ? (kind === 'raid' ? 'Raid' : 'Dungeon') : null],
    ['Bosses', atlas.bossCount ?? (atlas.bosses.length || null)],
    ['Rares', atlas.rareCount ?? (atlas.rares.length || null)],
    ['Quests', atlas.questCount ?? (atlas.quests.length || null)],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '')
  if (!facts.length) return null
  return <dl className="gw-atlas-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}

// The selected character's short answer: what is in it for them here.
function ForCharacter({ character, gearCount, wishCount, readiness = null, onLoot, onQuests }) {
  if (!character) return null
  return (
    <section className="gw-atlas-forme" aria-label={`For ${character.name}`}>
      <p className="gw-atlas-forme__line">
        {gearCount !== null ? (
          <button type="button" className="gw-link" onClick={onLoot}>{gearCount} item{gearCount === 1 ? '' : 's'} {character.name} can use</button>
        ) : null}
        {wishCount ? <span className="gw-atlas-forme__wish"><Icon name="loot" size={13} /> {wishCount} on the wishlist</span> : null}
        {gearCount === null && !wishCount ? <span className="gw-muted">Nothing known here for {character.name} yet.</span> : null}
      </p>
      {readiness ? <ReadinessSummary model={readiness} character={character} onOpen={onQuests} /> : null}
    </section>
  )
}

// Where the atlas's facts come from: folded away, for whoever asks.
function AboutData({ atlas }) {
  if (!atlas.provenance.length && !atlas.referenceVersion && !atlas.editorial?.attribution) return null
  return (
    <details className="gw-atlas-about">
      <summary>About this data</summary>
      <p className="gw-muted gw-atlas-provenance">
        {atlas.provenance.length ? <>Sources: {atlas.provenance.map((line, index) => (
          <span key={`${line.source}-${index}`}>{index ? ', ' : ''}{provenanceCopy(line).label}{line.revision ? ` (${line.revision})` : ''}{line.retrievedAt ? `, ${relativeTime(line.retrievedAt)}` : ''}</span>
        ))}.</> : null}
        {atlas.referenceVersion ? <span> Reference loot: {atlas.referenceVersion.dataset} {atlas.referenceVersion.revision}.</span> : null}
        {atlas.editorial?.attribution ? <span> {atlas.editorial.attribution}</span> : null}
      </p>
    </details>
  )
}

// The dungeon itself, before any boss is chosen: what it is, what is in it
// for the character, the practical guide and the map.
function DungeonOverview({ entry, atlas, onBoss, forCharacter }) {
  return (
    <div className="gw-atlas-section gw-atlas-overview">
      <EditorialArt art={atlas.editorial?.art?.overview} label="Overview art" />
      {atlas.description ? <p className="gw-atlas-description">{atlas.description}</p> : null}
      {atlas.origin === 'forever' ? (
        <p className="gw-muted gw-atlas-note">A WoW Forever dungeon: its bosses and level band come from the game client{atlas.floorNames.length ? ` (${atlas.floorNames.join(', ')})` : ''}. Maps, abilities and most item details are not known yet.</p>
      ) : null}
      <AtAGlance entry={entry} atlas={atlas} />
      {forCharacter}
      <EditorialNotes editorial={atlas.editorial} />
      <Wings atlas={atlas} />
      <WingNote atlas={atlas} />
      <DungeonMaps atlas={atlas} onBoss={onBoss} />
      <DangerousTrash creatures={atlas.creatures} />
      {atlas.rares.length ? (
        <section className="gw-atlas-rares" aria-label="Rares">
          <h3>Rares</h3>
          <ul className="gw-atlas-plain">{atlas.rares.map((rare) => (
            <li key={rare.npcId || rare.name}>
              <strong>{rare.name}</strong> <span className="gw-muted">{[rare.elite ? 'rare elite' : 'rare', levelRange(rare), markerPosition(rare.mapPosition) && atlas.maps.some((map) => map.imageUrl) ? 'on the map (★)' : null].filter(Boolean).join(' · ')}</span>
            </li>
          ))}</ul>
        </section>
      ) : null}
      {!atlas.known ? (
        <p className="gw-muted gw-atlas-gap">Levels, bosses, maps and quests for this dungeon are not in the atlas yet. Its loot is in the Loot section.</p>
      ) : null}
      <AboutData atlas={atlas} />
    </div>
  )
}

// Why a boss lists no loot, from what is known: chest encounters, and
// whether the Classic reference was loaded at all.
function bossLootEmpty(boss, atlas) {
  const chests = [...new Set(atlas.dungeonLoot.filter((entry) => entry && !entry.npcId && entry.sourceName).map((entry) => entry.sourceName))]
  if (chests.length) return `No loot linked to ${boss.name}. Chest loot (${chests.join(', ')}) is in the Loot section.`
  // Never "drops nothing": only that no source here links an item to it.
  if (atlas.referenceVersion) return `No loot data for ${boss.name} yet: Guildweaver has not seen it drop, and no Classic reference source links an item to it. That does not mean it drops nothing.`
  return `Loot data for ${boss.name} is not available yet.`
}

// One boss, as the add-on's journal shows it: portrait, mechanics and
// guide, then its loot, with the next boss a click away.
function BossDetail({ boss, index, bosses, atlas, rows, role, onRole, character, lootProps, onBoss }) {
  const map = atlas.maps.find((entry) => entry.imageUrl && entry.floorId === boss.floorId) || atlas.maps.find((entry) => entry.imageUrl)
  const abilities = boss.abilities || []
  const guide = quickGuide(abilities, role)
  const previous = bosses[index - 1]
  const next = bosses[index + 1]
  return (
    <article className="gw-atlas-boss" aria-label={boss.name}>
      <header className="gw-atlas-boss__head">
        <Portrait boss={boss} size={64} />
        <div>
          <p className="gw-muted gw-atlas-boss__eyebrow">Boss {index + 1} of {bosses.length}</p>
          <h3>{boss.name}</h3>
        </div>
      </header>
      {abilities.length ? (
        <>
          <RoleSelect role={role} onRole={onRole} character={character} />
          <QuickGuide abilities={abilities} role={role} />
        </>
      ) : null}
      {boss.description ? <p className="gw-atlas-description">{boss.description}</p> : null}
      <Mechanics mechanics={boss.mechanics} />
      <Strategy boss={boss} />
      {abilities.length ? (
        <details className="gw-atlas-allabilities" open={!guide.length}>
          <summary><h4 className="gw-atlas-subhead">All abilities ({abilities.length})</h4></summary>
          <Abilities abilities={abilities} />
        </details>
      ) : !boss.mechanics?.length ? <p className="gw-muted">No abilities recorded for this boss yet.</p> : null}
      {map && markerPosition(boss.mapPosition) ? <FloorMap map={map} bosses={[boss]} highlight={bossKey(boss)} /> : null}
      <section className="gw-atlas-boss__loot" aria-label={`${boss.name} loot`}>
        <h4 className="gw-atlas-subhead">Loot</h4>
        {boss.lootNotes?.length ? (
          <ul className="gw-atlas-plain gw-atlas-lootnotes">{boss.lootNotes.map((note) => <li key={note.itemId}><span className="gw-muted">Item {note.itemId}:</span> {note.note}</li>)}</ul>
        ) : null}
        <LootList rows={rows} empty={bossLootEmpty(boss, atlas)} label={`${boss.name} loot`} {...lootProps} />
        <UnresolvedLoot entries={boss.unresolvedLoot} owner={boss.name} />
      </section>
      {boss.npcId || boss.encounterId ? (
        <details className="gw-atlas-about">
          <summary>About this boss's data</summary>
          <p className="gw-muted gw-atlas-provenance">
            {[boss.npcId ? `NPC ${boss.npcId}` : null, boss.encounterId ? `encounter ${boss.encounterId}` : null].filter(Boolean).join(' · ')}
            {Array.isArray(boss.provenance) && boss.provenance.length ? ` · ${boss.provenance.map((line) => provenanceCopy(line).label).join(', ')}` : ''}
          </p>
        </details>
      ) : null}
      {previous || next ? (
        <nav className="gw-atlas-boss__pager" aria-label="Previous and next boss">
          {previous ? <button type="button" className="gw-btn gw-btn--sm" onClick={() => onBoss(previous)}><Icon name="back" size={14} /> {previous.name}</button> : <span />}
          {next ? <button type="button" className="gw-btn gw-btn--sm" onClick={() => onBoss(next)}>{next.name} <Icon name="chevron" size={14} /></button> : null}
        </nav>
      ) : null}
    </article>
  )
}

// The boss list beside the guide, always in reach: the dungeon first, then
// each boss in order.
function BossRail({ bosses, selected, onBoss, onOverview }) {
  const listRef = useRef(null)
  // On a phone the rail is a row: keep the chosen boss in sight.
  useEffect(() => {
    const list = listRef.current
    const current = list?.querySelector('[aria-current="true"]')
    if (list && current && list.scrollWidth > list.clientWidth) list.scrollLeft = Math.max(0, current.offsetLeft - list.offsetLeft - 16)
  }, [selected])
  return (
    <nav className="gw-atlas-rail" aria-label="Bosses">
      <ol ref={listRef}>
        <li>
          <button type="button" aria-current={!selected ? 'true' : undefined} onClick={onOverview}>
            <span className="gw-atlas-rail__icon" aria-hidden="true"><Icon name="overview" size={16} /></span>
            <span className="gw-atlas-rail__name">Dungeon overview</span>
          </button>
        </li>
        {bosses.map((boss, index) => {
          const high = (boss.abilities || []).filter((ability) => ability.priority === 'high').length
          return (
            <li key={bossKey(boss)}>
              <button type="button" aria-current={boss === selected ? 'true' : undefined} onClick={() => onBoss(boss)}>
                <Portrait boss={boss} size={28} />
                <span className="gw-atlas-rail__name"><span className="gw-atlas-rail__num" aria-hidden="true">{index + 1}</span>{boss.name}</span>
                {high ? <span className="gw-atlas-rail__flag" title={`${high} high-priority abilit${high === 1 ? 'y' : 'ies'}`}>{high}<span className="gw-sr-only"> high priority</span></span> : null}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// The Overview: the boss rail beside either the dungeon or the chosen boss.
function OverviewSection({ atlas, boss, onBoss, onOverview, sourceRows, overview, ...bossProps }) {
  const mainRef = useRef(null)
  const selected = atlas.bosses.find((entry) => bossKey(entry) === boss) || null
  const index = selected ? atlas.bosses.indexOf(selected) : -1
  // A boss chosen far down the page opens at its top.
  useEffect(() => {
    const main = mainRef.current
    if (main && typeof main.getBoundingClientRect === 'function' && main.getBoundingClientRect().top < 0) main.scrollIntoView?.({ block: 'start' })
  }, [boss])
  if (!atlas.bosses.length) return overview
  return (
    <div className="gw-atlas-split">
      <BossRail bosses={atlas.bosses} selected={selected} onBoss={onBoss} onOverview={onOverview} />
      <div className="gw-atlas-split__main" ref={mainRef}>
        {selected ? <BossDetail key={bossKey(selected)} boss={selected} index={index} bosses={atlas.bosses} atlas={atlas} rows={sourceRows(selected)} onBoss={onBoss} {...bossProps} /> : overview}
      </div>
    </div>
  )
}

const LOOT_KINDS = [['', 'All loot'], ['observed', 'Seen by Guildweaver'], ['reference', 'Reference only']]

// Loot, by source, with the character's gear and wishlist in the bar.
function LootSection({ groups, items, character, atlas, lootProps, focus = '', onFocused, wishCount = 0, planner = null, planning = false, onPlan = null }) {
  const [kind, setKind] = useState('')
  const [usable, setUsable] = useState(false)
  const usableKeys = useMemo(() => new Set(gearTargets(items, character, atlas).map((row) => row.item.itemKey)), [items, character, atlas])
  const all = groups.flatMap((group) => group.sources.flatMap((source) => source.rows))
  const hasReference = all.some((row) => row.reference && !row.observed)
  const filter = (row) => (kind === 'observed' ? row.observed : kind === 'reference' ? !row.observed : true) && (!usable || usableKeys.has(row.item.itemKey))
  const matching = all.filter(filter).length
  const silent = atlas.bosses.filter((boss) => !groups.some((group) => group.sources.some((source) => source.key === `boss:${bossKey(boss)}`)))
  useEffect(() => {
    if (focus && revealSource(focus)) onFocused?.()
  }, [focus, onFocused])
  return (
    <div className="gw-atlas-section gw-atlas-lootsection">
      <div className="gw-atlas-lootbar">
        {hasReference ? (
          <label className="gw-filter">
            <span>Show</span>
            <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Which loot">
              {LOOT_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        ) : null}
        {character ? <label className="gw-loot__check"><input type="checkbox" checked={usable} onChange={(event) => setUsable(event.target.checked)} /> Only what {character.name} can use ({usableKeys.size})</label> : null}
        {character && wishCount ? <span className="gw-atlas-lootbar__wish"><Icon name="loot" size={13} /> {wishCount} on {character.name}'s wishlist</span> : null}
        {onPlan ? (
          <button type="button" className="gw-btn gw-btn--sm gw-atlas-lootbar__plan" aria-expanded={planning} onClick={onPlan}><Icon name="sparkle" size={14} /> Plan my gear</button>
        ) : null}
      </div>
      {planner}
      {!character ? <p className="gw-muted">Choose a character to keep a wishlist.</p> : null}
      {!all.length ? <p className="gw-muted">No loot recorded here yet.</p> : !matching ? <p className="gw-muted">No loot matches.</p> : (
        <SourceGroups groups={groups} filter={filter} lootProps={lootProps} onSource={lootProps.onSource} />
      )}
      {all.length && silent.length ? (
        <p className="gw-muted gw-atlas-provenance">No loot known yet for {silent.map((boss) => boss.name).join(', ')}. That does not mean {silent.length === 1 ? 'it drops' : 'they drop'} nothing.</p>
      ) : null}
      <UnresolvedLoot entries={atlas.unresolvedLoot} />
      {hasReference ? (
        <details className="gw-atlas-about">
          <summary>About loot data</summary>
          <p className="gw-muted gw-atlas-provenance">Seen by Guildweaver: players looted it with the add-on running, from that source. Classic reference items come from Classic data, not Guildweaver sightings. They are not verified for Forever and no drop chances are shown unless a source measured them.</p>
        </details>
      ) : null}
    </div>
  )
}

// Quests: what to do before going in, and the character's readiness.
function QuestsSection({ atlas, character, readiness, readinessSummary, lootProps }) {
  return (
    <div className="gw-atlas-section">
      <EditorialNotes editorial={atlas.editorial} lists={['preparation']} />
      {character ? <QuestReadiness resource={readiness} character={character} /> : null}
      {atlas.wing && atlas.quests.length ? <p className="gw-muted">These are the whole dungeon's quests: no source ties a quest to one wing.</p> : null}
      {character && readinessSummary ? (
        <details className="gw-atlas-rgroup" data-group="details">
          <summary><h4>Quest details and rewards</h4><span className="gw-tag gw-tag--quiet">{atlas.quests.length}</span></summary>
          <QuestList quests={atlas.quests} rewardProps={lootProps} />
        </details>
      ) : <QuestList quests={atlas.quests} rewardProps={lootProps} />}
      {atlas.editorial?.questNotes ? <p className="gw-atlas-editorial-note">{atlas.editorial.questNotes}</p> : null}
    </div>
  )
}

function heroStyle(atlas) {
  const url = atlas.editorial?.art?.card?.url || atlas.artworkUrl
  if (!url) return undefined
  const focus = atlas.editorial?.art?.card || (atlas.artFocus ? { focusX: atlas.artFocus.x, focusY: atlas.artFocus.y } : null)
  return { '--art': `url("${url}")`, ...(focus ? { '--art-position': `${(focus.focusX ?? 0.5) * 100}% ${(focus.focusY ?? 0.5) * 100}%` } : {}) }
}

// One dungeon: Overview (the dungeon, its bosses, guide and map), Quests,
// Loot by source and the character's runs. The section and the boss shown
// live in the URL (?open=&section=&boss=), so the view can be linked and
// Back returns to where it was opened.
//
// layout: 'page' (the Dungeons page's own view of a dungeon), 'dialog' (over
// another page, such as the world map) or 'embedded' (the Dungeon Content
// Studio's preview, drawn in place from previewDetail without fetching).
export default function DungeonDetailModal({
  instanceId, entry = null, dungeons = [], character = null, characters = [], onCharacter = null,
  server = '', section: sectionProp = 'overview', boss = '', onNavigate, onClose, showMapLink = true,
  previewDetail = null, embedded = false, layout: layoutProp = 'dialog', backHref = '', backLabel = 'All dungeons',
}) {
  const layout = embedded ? 'embedded' : layoutProp
  const section = atlasSection(sectionProp)
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

  const openBoss = (target) => onNavigate({ section: 'overview', boss: bossKey(target) })
  const openOverview = () => onNavigate({ section: 'overview', boss: '' })
  const openQuests = () => onNavigate({ section: 'quests', boss: '' })
  const openLoot = () => onNavigate({ section: 'loot', boss: '' })
  // From an item to its source: a boss's guide, the quests, or the source's
  // block in the loot list.
  const onSource = (source) => {
    if (!source) return
    if ((source.kind === 'boss' || source.sourceKind === 'boss') && source.bossKey) onNavigate({ section: 'overview', boss: source.bossKey })
    else if (source.kind === 'quest' || source.sourceKind === 'quest') openQuests()
    else if (source.key) {
      setFocusSource(source.key)
      if (section !== 'loot') openLoot()
    }
  }
  const lootProps = { wishes, character, busyKey: busy, onToggle: toggle, onSource }
  // The character's quest readiness (instanceId is a dungeon or a wing key).
  const readiness = useDungeonReadiness(character ? instanceId : '', character?.id || '')
  const readinessSummary = useMemo(() => readinessModel(readiness.data), [readiness.data])
  const fit = character ? levelFit(atlas, character) : null
  const ready = Boolean(detail.data || (listEntry && (section === 'overview' || detail.status !== 'loading')))

  const content = (
    <>
      <header className={`gw-atlas-hero${heroStyle(atlas) ? '' : ' gw-atlas-hero--blank'}`} style={heroStyle(atlas)}>
        {(layout === 'page' && backHref) || character || (showMapLink && atlas.entrance) || layout === 'dialog' ? <div className="gw-atlas-hero__bar">
          {layout === 'page' && backHref ? <a className="gw-btn gw-btn--sm gw-btn--quiet gw-atlas-back" href={backHref}><Icon name="back" size={14} /> {backLabel}</a> : <span />}
          <div className="gw-atlas-hero__actions">
            {characters.length > 1 && onCharacter ? (
              <label className="gw-filter gw-atlas-modal__character">
                <span>Character</span>
                <select value={character?.id || ''} onChange={(event) => onCharacter(event.target.value)} aria-label="Character">
                  {characters.map((option) => <option key={option.id} value={option.id}>{option.name}{option.level ? ` · ${option.level}` : ''}</option>)}
                </select>
              </label>
            ) : character ? <span className="gw-atlas-modal__who">For {character.name}{character.level ? ` · ${character.level}` : ''}</span> : null}
            {showMapLink && atlas.entrance ? <a className="gw-btn gw-btn--sm" href={worldMapHref({ ...merged, instanceId: gameInstanceId, atlas })}><Icon name="map" size={14} /> World map</a> : null}
            {layout === 'dialog' ? <button type="button" className="gw-icon-btn gw-icon-btn--quiet" aria-label="Close" data-autofocus onClick={onClose}><Icon name="close" /></button> : null}
          </div>
        </div> : null}
        <div className="gw-atlas-hero__title">
          <p className="gw-atlas-hero__eyebrow">{[dungeonKind(merged) === 'raid' ? 'Raid' : 'Dungeon', atlas.zoneName, levelText(atlas)].filter(Boolean).join(' · ')}</p>
          <h2 id={titleId} ref={headingRef} tabIndex={-1}>{name}</h2>
          {atlas.subtitle ? <p className="gw-atlas-hero__subtitle">{atlas.subtitle}</p> : null}
          {fit ? (
            <p className="gw-atlas-hero__fit">
              <span className={`gw-tag gw-tag--${FIT_COPY[fit].tone} gw-atlas-fit`}>{fit === 'fit' ? <Icon name="check" size={12} /> : null} {fitText(fit, character)}</span>
              <span className="gw-muted">{fitDetail(atlas, character)}</span>
            </p>
          ) : null}
        </div>
      </header>

      <nav className="gw-seg gw-atlas-tabs" aria-label={`${name} sections`}>
        {ATLAS_SECTIONS.map(([id, label]) => (
          <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => onNavigate({ section: id, boss: '' })}>{label}</button>
        ))}
      </nav>

      <div className="gw-atlas-modal__body">
        {error ? <p className="gw-objectives__error" role="alert">{error}</p> : null}
        {detail.status === 'loading' && !detail.data ? <SkeletonRows rows={5} label={`Loading ${name}`} /> : null}
        {(detail.status === 'error' || detail.status === 'missing') && !detail.data ? <ErrorState onRetry={detail.reload}>This dungeon could not be loaded{loadFailureDetail(detail.error)}.</ErrorState> : null}
        {/* While the detail loads, only Overview can draw from the list entry: other sections would show empty states. */}
        {ready ? (
          <>
            {section === 'overview' ? (
              <OverviewSection atlas={atlas} boss={boss} onBoss={openBoss} onOverview={openOverview} sourceRows={(target) => bySource.get(`boss:${bossKey(target)}`) || []}
                role={role} onRole={setRole} character={character} lootProps={lootProps}
                overview={<DungeonOverview entry={merged} atlas={atlas} onBoss={openBoss}
                  forCharacter={<ForCharacter character={character} gearCount={gearCount} wishCount={wishCount} readiness={readinessSummary} onLoot={openLoot} onQuests={openQuests} />} />} />
            ) : null}
            {section === 'quests' ? <QuestsSection atlas={atlas} character={character} readiness={readiness} readinessSummary={readinessSummary} lootProps={lootProps} /> : null}
            {section === 'loot' ? (
              <LootSection groups={groups} items={items} character={character} atlas={atlas} lootProps={lootProps} focus={focusSource} onFocused={() => setFocusSource('')}
                wishCount={wishCount} planning={planning} onPlan={character ? () => setPlanning((open) => !open) : null}
                planner={planning && character ? (
                  <PlanMyGear character={character} characters={characters} onCharacter={onCharacter} dungeon={{ instanceId: gameInstanceId, name }} dungeons={dungeons}
                    onClose={() => setPlanning(false)} onImported={(next) => { if (next) wishlist.mutate(next) }} />
                ) : null} />
            ) : null}
            {section === 'runs' ? <div className="gw-atlas-section"><Runs entry={merged} character={character} server={server} /></div> : null}
          </>
        ) : detail.status === 'ready' ? <EmptyState title="Nothing known about this dungeon yet." icon="dungeon" /> : null}
      </div>
    </>
  )

  if (layout === 'dialog') {
    return (
      <div className="gw-atlas-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <section ref={panelRef} className="gw-atlas-modal__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>{content}</section>
      </div>
    )
  }
  return (
    <section ref={panelRef} className={`gw-atlas-page${layout === 'embedded' ? ' gw-atlas-page--embedded' : ''}`} role="region" aria-labelledby={titleId}>{content}</section>
  )
}
