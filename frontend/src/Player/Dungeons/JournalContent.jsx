import { useEffect, useMemo, useRef, useState } from 'react'

import { relativeTime } from '../playerModel.js'
import { Icon } from '../ui.jsx'
import {
  bossKey,
  dungeonKind,
  gearTargets,
  groupAbilities,
  levelText,
  needsUnverifiedBadge,
  provenanceCopy,
  quickGuide,
  revealSource,
  withAtlasOpen,
} from './atlasModel.js'
import { LootList, SourceGroups, UnverifiedBadge } from './AtlasLoot.jsx'
import { QuestList, QuestReadiness, QuickGuide, ReadinessSummary, RoleSelect } from './AtlasPrepare.jsx'
import QuestPlan from './QuestPlan.jsx'

// What the Dungeon Journal's panels show: the dungeon, one encounter, the
// encounter list, all of a dungeon's loot and its quest checklist. Where they
// sit is JournalWorkspace's job.

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

export function Portrait({ boss, size = 44 }) {
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
export function ForCharacter({ character, gearCount, wishCount, readiness = null, onLoot, onQuests }) {
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
// for the character and the practical guide. The map is beside it.
export function DungeonOverview({ entry, atlas, forCharacter }) {
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
      {atlas.maps.filter((map) => !map.imageUrl).map((map) => <SpawnPlot key={map.floorId ?? 'layout'} map={map} />)}
      <DangerousTrash creatures={atlas.creatures} />
      {atlas.rares.length ? (
        <section className="gw-atlas-rares" aria-label="Rares">
          <h3>Rares</h3>
          <ul className="gw-atlas-plain">{atlas.rares.map((rare) => (
            <li key={rare.npcId || rare.name}>
              <strong>{rare.name}</strong> <span className="gw-muted">{[rare.elite ? 'rare elite' : 'rare', levelRange(rare), null].filter(Boolean).join(' · ')}</span>
            </li>
          ))}</ul>
        </section>
      ) : null}
      {!atlas.known ? (
        <p className="gw-muted gw-atlas-gap">Levels, bosses, maps and quests for this dungeon are not in the atlas yet. Its loot is under All loot.</p>
      ) : null}
      <AboutData atlas={atlas} />
    </div>
  )
}

// Why a boss lists no loot, from what is known: chest encounters, and
// whether the Classic reference was loaded at all.
function bossLootEmpty(boss, atlas) {
  const chests = [...new Set(atlas.dungeonLoot.filter((entry) => entry && !entry.npcId && entry.sourceName).map((entry) => entry.sourceName))]
  if (chests.length) return `No loot linked to ${boss.name}. Chest loot (${chests.join(', ')}) is under All loot.`
  // Never "drops nothing": only that no source here links an item to it.
  if (atlas.referenceVersion) return `No loot data for ${boss.name} yet: Guildweaver has not seen it drop, and no Classic reference source links an item to it. That does not mean it drops nothing.`
  return `Loot data for ${boss.name} is not available yet.`
}

// One boss, as the add-on's creature page shows it: the portrait and name,
// the previous and next boss, key mechanics, and its loot held in view under
// them. A boss with no known mechanics is its header and loot, with one line.
export function BossDetail({ boss, index, bosses, atlas, rows, role, onRole, character, lootProps, onBoss }) {
  const abilities = boss.abilities || []
  const guide = quickGuide(abilities, role)
  const previous = bosses[index - 1]
  const next = bosses[index + 1]
  const high = abilities.filter((ability) => ability.priority === 'high').length + (boss.mechanics || []).filter((mechanic) => mechanic.priority === 'high').length
  const interrupts = abilities.some((ability) => ability.interruptible === true) || (boss.mechanics || []).some((mechanic) => mechanic.type === 'interrupt')
  const wanted = rows.filter((row) => lootProps.wishes?.get(row.item.itemKey) && lootProps.wishes.get(row.item.itemKey).state !== 'acquired').length
  const strategy = boss.strategy && Object.values(boss.strategy).some(Boolean)
  const hasGuide = Boolean(abilities.length || boss.mechanics?.length || boss.description || strategy || boss.positioning || boss.interrupts || boss.dispels)
  return (
    <article className={`gw-journal-boss gw-jw-boss gw-atlas-boss${hasGuide ? '' : ' gw-jw-boss--sparse'}`} aria-label={boss.name}>
      <header className="gw-jw-boss__head">
        <Portrait boss={boss} size={48} />
        <div className="gw-jw-boss__title">
          <p className="gw-jw-boss__eyebrow">Encounter {index + 1} of {bosses.length}</p>
          <h3>{boss.name}</h3>
          {high || interrupts || wanted ? (
            <p className="gw-journal-boss__facts">
              {high ? <span className="gw-journal-tag gw-journal-tag--bad">{high} high priority</span> : null}
              {interrupts ? <span className="gw-journal-tag gw-journal-tag--info">Interrupts</span> : null}
              {wanted ? <span className="gw-journal-tag gw-journal-tag--wish">{wanted} on the wishlist</span> : null}
            </p>
          ) : null}
        </div>
        {previous || next ? (
          <nav className="gw-atlas-boss__pager" aria-label="Previous and next boss">
            <button type="button" disabled={!previous} aria-label={previous ? `Previous boss: ${previous.name}` : 'No previous boss'} title={previous?.name} onClick={() => onBoss(previous)}><Icon name="back" size={14} /></button>
            <button type="button" disabled={!next} aria-label={next ? `Next boss: ${next.name}` : 'No next boss'} title={next?.name} onClick={() => onBoss(next)}><Icon name="chevron" size={14} /></button>
          </nav>
        ) : null}
      </header>
      <div className="gw-jw-boss__guide">
        {boss.description ? <p className="gw-atlas-description">{boss.description}</p> : null}
        {abilities.length || boss.mechanics?.length ? <h4 className="gw-journal-subhead">Key mechanics</h4> : null}
        {abilities.length ? (
          <>
            <RoleSelect role={role} onRole={onRole} character={character} />
            <QuickGuide abilities={abilities} role={role} />
          </>
        ) : null}
        <Mechanics mechanics={boss.mechanics} />
        <Strategy boss={boss} />
        {abilities.length ? (
          <details className="gw-atlas-allabilities" open={!guide.length}>
            <summary><h4 className="gw-atlas-subhead">All abilities ({abilities.length})</h4></summary>
            <Abilities abilities={abilities} />
          </details>
        ) : null}
        {!hasGuide ? <p className="gw-journal-empty gw-muted">Mechanics for {boss.name} are not recorded yet.</p> : null}
        {boss.npcId || boss.encounterId ? (
          <details className="gw-atlas-about">
            <summary>About this data</summary>
            <p className="gw-muted gw-atlas-provenance">
              {[boss.npcId ? `NPC ${boss.npcId}` : null, boss.encounterId ? `encounter ${boss.encounterId}` : null, boss.catalogName ? `loot catalog: ${boss.catalogName}` : null].filter(Boolean).join(' · ')}
              {Array.isArray(boss.provenance) && boss.provenance.length ? ` · ${boss.provenance.map((line) => provenanceCopy(line).label).join(', ')}` : ''}
            </p>
          </details>
        ) : null}
      </div>
      <section className="gw-jw-boss__loot gw-atlas-boss__loot" aria-label={`${boss.name} loot`}>
        <h4 className="gw-journal-subhead">Loot{rows.length ? <span> {rows.length}</span> : null}</h4>
        {boss.lootNotes?.length ? (
          <ul className="gw-atlas-plain gw-atlas-lootnotes">{boss.lootNotes.map((note) => <li key={note.itemId}><span className="gw-muted">Item {note.itemId}:</span> {note.note}</li>)}</ul>
        ) : null}
        <LootList rows={rows} empty={bossLootEmpty(boss, atlas)} label={`${boss.name} loot`} {...lootProps} />
        <UnresolvedLoot entries={boss.unresolvedLoot} owner={boss.name} />
      </section>
    </article>
  )
}

// The boss list beside the guide, always in reach: the dungeon first, then
// each boss in order.
export function BossRail({ bosses, selected, onBoss, onOverview, sourceRows = () => [], wishes = null, numbered = false }) {
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
          const high = (boss.abilities || []).filter((ability) => ability.priority === 'high').length + (boss.mechanics || []).filter((mechanic) => mechanic.priority === 'high').length
          const rows = sourceRows(boss)
          const wanted = wishes ? rows.filter((row) => wishes.get(row.item.itemKey) && wishes.get(row.item.itemKey).state !== 'acquired').length : 0
          return (
            <li key={bossKey(boss)}>
              <button type="button" className="gw-journal-rail__boss" aria-current={boss === selected ? 'true' : undefined} onClick={() => onBoss(boss)}>
                <Portrait boss={boss} size={36} />
                <span className="gw-atlas-rail__name">
                  <span className="gw-journal-rail__line">{numbered ? <span className="gw-atlas-rail__num" aria-hidden="true">{index + 1}</span> : null}{boss.name}</span>
                  <span className="gw-journal-rail__sub">{rows.length ? `${rows.length} drop${rows.length === 1 ? '' : 's'}` : 'No loot known'}{wanted ? <span className="gw-journal-rail__wish"> · {wanted} wanted</span> : null}</span>
                </span>
                {high ? <span className="gw-atlas-rail__flag" title={`${high} high-priority mechanic${high === 1 ? '' : 's'}`}>{high}<span className="gw-sr-only"> high priority</span></span> : null}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

const LOOT_KINDS = [['', 'All loot'], ['observed', 'Seen by Guildweaver'], ['reference', 'Reference only']]

// Loot, by source, with the character's gear and wishlist in the bar.
export function LootSection({ groups, items, character, atlas, lootProps, focus = '', onFocused, wishCount = 0, planner = null, planning = false, onPlan = null }) {
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
// Quests: the preparation checklist for the character (the planner's plan,
// as in the add-on), then the quest facts and rewards on demand. Without a
// plan (no quest list for this dungeon) the readiness groups stand in.
export function QuestsSection({ atlas, character, readiness, plan, lootProps }) {
  const details = <QuestList quests={atlas.quests} rewardProps={lootProps} />
  return (
    <div className="gw-atlas-section gw-atlas-quests-section">
      <EditorialNotes editorial={atlas.editorial} lists={['preparation']} />
      {character ? (
        <QuestPlan resource={plan} character={character} readiness={readiness} fallback={<QuestReadiness resource={readiness} character={character} />} />
      ) : atlas.quests.length ? <p className="gw-muted">Choose a character to get a preparation checklist from its synced quests.</p> : null}
      {atlas.wing && atlas.quests.length ? <p className="gw-muted">These are the whole dungeon's quests: no source ties a quest to one wing.</p> : null}
      {character && atlas.quests.length ? (
        <details className="gw-atlas-rgroup" data-group="details">
          <summary><h4>Quest details and rewards</h4><span className="gw-tag gw-tag--quiet">{atlas.quests.length}</span></summary>
          {details}
        </details>
      ) : details}
      {atlas.editorial?.questNotes ? <p className="gw-atlas-editorial-note">{atlas.editorial.questNotes}</p> : null}
    </div>
  )
}
