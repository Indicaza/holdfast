import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { useLiveResource } from '../../Live/useLiveResource.js'
import { dungeonHref, formatRunDuration } from '../dungeonRunModel.js'
import { QUALITY_NAMES, acquisitionCopy } from '../lootModel.js'
import { playerApiUrl, relativeTime } from '../playerModel.js'
import { EmptyState, ErrorState, Icon, ItemLabel, SkeletonRows } from '../ui.jsx'
import {
  ATLAS_SECTIONS,
  FIT_COPY,
  bossKey,
  bossLoot,
  dungeonKind,
  groupAbilities,
  levelFit,
  levelText,
  lootRows,
  markerPosition,
  needsUnverifiedBadge,
  normalizeAtlas,
  provenanceCopy,
  trapFocusIndex,
  wishlistToggleRequest,
  worldMapHref,
} from './atlasModel.js'
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

function UnverifiedBadge() {
  return <span className="gw-tag gw-tag--quiet gw-atlas-unverified" title="From a Classic reference; not yet checked on Forever">Classic reference — unverified for Forever</span>
}

// A floor map with boss markers where their positions are known.
function FloorMap({ map, bosses, onBoss, highlight = '' }) {
  const placed = bosses.filter((boss) => (boss.floorId ?? map.floorId) === map.floorId && markerPosition(boss.mapPosition))
  return (
    <figure className="gw-atlas-floor">
      <div className="gw-atlas-floor__frame" style={map.width && map.height ? { aspectRatio: `${map.width} / ${map.height}` } : undefined}>
        <img src={map.imageUrl} alt={`Map of ${map.name || 'this floor'}`} loading="lazy" />
        {placed.map((boss, index) => (
          <button key={bossKey(boss)} type="button" className={`gw-atlas-floor__marker${highlight === bossKey(boss) ? ' is-active' : ''}`}
            style={markerPosition(boss.mapPosition)} aria-label={`${boss.name} on the map`} onClick={() => onBoss?.(boss)}>
            {index + 1}
          </button>
        ))}
      </div>
      {map.name ? <figcaption className="gw-muted">{map.name}{placed.length < bosses.length ? ' · some boss positions are not known yet' : ''}</figcaption> : null}
    </figure>
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

// One item: icon with the game's tooltip, facts, wanted state and toggle.
function LootLine({ row, wish, character, busy, onToggle }) {
  const { item } = row
  const wanted = Boolean(wish && wish.state !== 'acquired')
  const acquired = wish?.state === 'acquired'
  const facts = [QUALITY_NAMES[item.qualityId], item.itemLevel ? `ilvl ${item.itemLevel}` : null, item.slot, row.source ? `from ${row.source}` : 'source not identified'].filter(Boolean)
  return (
    <li className={`gw-atlas-loot${wanted ? ' is-wanted' : ''}${acquired ? ' is-acquired' : ''}`}>
      <ItemLabel item={item} size={26} muted={acquired} />
      <span className="gw-atlas-loot__facts gw-muted">{facts.join(' · ')}</span>
      {acquired ? <span className="gw-tag gw-tag--ok"><Icon name="check" size={12} /> {acquisitionCopy(wish).label}</span> : null}
      {!acquired ? (
        <button type="button" className={`gw-btn gw-btn--sm gw-loot-row__toggle${wanted ? ' is-on' : ''}`} aria-pressed={wanted} disabled={busy || !character}
          aria-label={`${wanted ? 'Remove' : 'Add'} ${item.name} ${wanted ? 'from' : 'to'} ${character ? `${character.name}'s` : 'the'} wishlist`} onClick={() => onToggle(item, wanted)}>
          <Icon name={wanted ? 'check' : 'plus'} size={14} /> {wanted ? 'Wanted' : 'Want'}
        </button>
      ) : null}
    </li>
  )
}

function LootList({ rows, wishes, character, busy, onToggle, empty = 'No loot recorded here yet.' }) {
  if (!rows.length) return <p className="gw-muted">{empty}</p>
  return (
    <ul className="gw-atlas-loot-list">
      {rows.map((row) => <LootLine key={`${row.sourceKey}-${row.item.itemKey}`} row={row} wish={wishes.get(row.item.itemKey)} character={character} busy={busy} onToggle={onToggle} />)}
    </ul>
  )
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

function Overview({ entry, atlas, character, onBoss }) {
  return (
    <div className="gw-atlas-section">
      {atlas.description ? <p>{atlas.description}</p> : null}
      <Facts entry={entry} atlas={atlas} character={character} />
      {atlas.maps.map((map) => <FloorMap key={map.floorId ?? map.imageUrl} map={map} bosses={atlas.bosses} onBoss={onBoss} />)}
      {atlas.bosses.length ? (
        <>
          <h3>Bosses</h3>
          <ol className="gw-atlas-boss-chips">
            {atlas.bosses.map((boss) => (
              <li key={bossKey(boss)}>
                <button type="button" className="gw-atlas-boss-chip" onClick={() => onBoss(boss)}>
                  <Portrait boss={boss} size={28} />
                  <span>{boss.name}</span>
                  {groupAbilities(boss.abilities).some((group) => group.category === 'interrupt') ? <span className="gw-tag gw-tag--info">Interrupts</span> : null}
                </button>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      {atlas.rares.length ? (
        <>
          <h3>Rares</h3>
          <ul className="gw-atlas-plain">{atlas.rares.map((rare) => <li key={rare.npcId || rare.name}>{rare.name}</li>)}</ul>
        </>
      ) : null}
      {!atlas.known ? (
        <p className="gw-muted gw-atlas-gap">Levels, bosses, maps and quests for this dungeon are not in the atlas yet. Its loot is below.</p>
      ) : null}
      {atlas.provenance.length ? (
        <p className="gw-muted gw-atlas-provenance">
          Sources: {atlas.provenance.map((line, index) => (
            <span key={`${line.source}-${index}`}>{index ? ', ' : ''}{provenanceCopy(line).label}{line.revision ? ` (${line.revision})` : ''}{line.retrievedAt ? `, ${relativeTime(line.retrievedAt)}` : ''}</span>
          ))}
        </p>
      ) : null}
    </div>
  )
}

function BossDetail({ boss, atlas, detail, ...loot }) {
  const map = atlas.maps.find((entry) => entry.floorId === boss.floorId) || atlas.maps[0]
  return (
    <article className="gw-atlas-boss">
      <header className="gw-atlas-boss__head">
        <Portrait boss={boss} size={64} />
        <div>
          <h3>{boss.name}</h3>
          {boss.npcId ? <p className="gw-muted">NPC {boss.npcId}{boss.encounterId ? ` · encounter ${boss.encounterId}` : ''}</p> : null}
        </div>
      </header>
      {map && markerPosition(boss.mapPosition) ? <FloorMap map={map} bosses={[boss]} highlight={bossKey(boss)} /> : null}
      <Strategy strategy={boss.strategy} />
      <h4 className="gw-atlas-subhead">Abilities</h4>
      <Abilities abilities={boss.abilities} />
      <h4 className="gw-atlas-subhead">Loot</h4>
      <LootList rows={bossLoot(boss, detail)} empty="No loot linked to this boss yet." {...loot} />
    </article>
  )
}

function Bosses({ atlas, detail, boss, onBoss, ...loot }) {
  const selected = atlas.bosses.find((entry) => bossKey(entry) === boss) || atlas.bosses[0]
  if (!atlas.bosses.length) return <p className="gw-muted">No boss details in the atlas yet. The Loot tab lists bosses seen dropping loot.</p>
  return (
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
      <BossDetail key={bossKey(selected)} boss={selected} atlas={atlas} detail={detail} {...loot} />
    </div>
  )
}

function Quests({ atlas }) {
  if (!atlas.quests.length) return <p className="gw-muted">No quests for this dungeon in the atlas yet.</p>
  return (
    <ul className="gw-atlas-quests">
      {atlas.quests.map((quest) => (
        <li key={quest.questId || quest.name}>
          <strong>{quest.name}</strong>
          <span className="gw-muted">{[quest.level ? `Level ${quest.level}` : null, quest.minLevel ? `from ${quest.minLevel}` : null, quest.faction, quest.giver ? `from ${quest.giver}` : null].filter(Boolean).join(' · ')}</span>
        </li>
      ))}
    </ul>
  )
}

function Runs({ entry, character, server }) {
  const name = entry?.name || ''
  const url = name ? playerApiUrl('dungeon-runs', server, { dungeon: name, character: character?.id || '' }) : ''
  const { status, data } = useLiveResource(url, { topics: ['player'], enabled: Boolean(url) })
  if (status === 'loading') return <SkeletonRows rows={3} label="Loading your runs" />
  if (status === 'error' || status === 'missing') return <ErrorState>Your runs could not be loaded.</ErrorState>
  const runs = data?.runs || []
  const all = dungeonHref({ filters: { dungeon: name, character: character?.id || '' }, server })
  if (!runs.length) return <p className="gw-muted">No runs of {name}{character ? ` by ${character.name}` : ''} synced yet.</p>
  return (
    <>
      <ul className="gw-atlas-runs">
        {runs.slice(0, 8).map((run) => (
          <li key={run.id}>
            <a href={dungeonHref({ filters: { dungeon: name }, runId: run.id, server })}>{run.character?.name || 'Run'}</a>
            <span className="gw-muted">{formatRunDuration(run.timer?.seconds ?? run.durationSeconds)} · {relativeTime(run.startedAt ? new Date(run.startedAt * 1000).toISOString() : null)}</span>
          </li>
        ))}
      </ul>
      <a className="gw-link" href={all}>All runs here</a>
    </>
  )
}

// One dungeon, opened from anywhere: cards, runs, loot, the wishlist and
// the world map. Tabs and the boss shown live in the URL (?open=&section=
// &boss=), so the view can be linked and Back closes it.
export default function DungeonDetailModal({ instanceId, entry = null, dungeons = [], character = null, server = '', section = 'overview', boss = '', onNavigate, onClose, showMapLink = true }) {
  const panelRef = useRef(null)
  const titleId = useId()
  useDialogFocus(panelRef, onClose)
  const detail = useDungeonDetail(instanceId)
  const wishlist = useWishlist(character?.id || '')
  const mutate = useWishlistMutation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [planning, setPlanning] = useState(false)

  const listEntry = entry || dungeons.find((dungeon) => dungeon.instanceId === instanceId) || null
  const merged = useMemo(() => ({ ...(detail.data?.instance || {}), ...(listEntry || {}), atlas: detail.data?.atlas || listEntry?.atlas }), [detail.data, listEntry])
  const atlas = useMemo(() => {
    const full = normalizeAtlas(merged.atlas)
    const fromList = normalizeAtlas(listEntry?.atlas)
    return { ...fromList, ...Object.fromEntries(Object.entries(full).filter(([, value]) => value !== null && value !== '' && !(Array.isArray(value) && !value.length))), known: full.known || fromList.known }
  }, [merged, listEntry])
  const name = merged.name || `Dungeon ${instanceId}`
  const wishes = useMemo(() => new Map((wishlist.data?.items || []).map((item) => [item.itemKey, item])), [wishlist.data])
  const rows = useMemo(() => lootRows(detail.data), [detail.data])

  async function toggle(item, wanted) {
    if (!character) return
    const request = wishlistToggleRequest(character.id, item, wanted, detail.data?.instance || listEntry)
    setBusy(true)
    setError('')
    try {
      const result = await mutate(request.path, request.method, request.body)
      if (result?.items) wishlist.mutate(result)
    } catch (failure) {
      setError(failure?.status === 409 ? 'This wishlist is full.' : failure?.status === 422 ? 'Guildweaver does not know that item yet.' : 'That change was not saved. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const loot = { wishes, character, busy, onToggle: toggle }
  const openBoss = (target) => onNavigate({ section: 'bosses', boss: bossKey(target) })

  return (
    <div className="gw-atlas-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={panelRef} className="gw-atlas-modal__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="gw-atlas-modal__head" style={atlas.artworkUrl ? { '--art': `url("${atlas.artworkUrl}")` } : undefined}>
          <div className="gw-atlas-modal__title">
            <p className="gw-muted">{[dungeonKind(merged) === 'raid' ? 'Raid' : 'Dungeon', atlas.zoneName, levelText(atlas)].filter(Boolean).join(' · ')}</p>
            <h2 id={titleId}>{name}</h2>
          </div>
          <div className="gw-atlas-modal__actions">
            {showMapLink && atlas.entrance ? <a className="gw-btn gw-btn--sm" href={worldMapHref({ ...merged, instanceId, atlas })}><Icon name="map" size={14} /> Show on world map</a> : null}
            <button type="button" className="gw-btn gw-btn--sm gw-btn--primary" disabled={!character} aria-expanded={planning} onClick={() => setPlanning((open) => !open)}>
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
            <PlanMyGear character={character} dungeon={{ instanceId, name }} dungeons={dungeons} onClose={() => setPlanning(false)}
              onImported={(next) => { if (next) wishlist.mutate(next) }} />
          ) : null}
          {error ? <p className="gw-objectives__error" role="alert">{error}</p> : null}
          {detail.status === 'loading' && !detail.data ? <SkeletonRows rows={5} label={`Loading ${name}`} /> : null}
          {(detail.status === 'error' || detail.status === 'missing') && !detail.data ? <ErrorState>This dungeon could not be loaded.</ErrorState> : null}
          {detail.data || listEntry ? (
            <>
              {section === 'overview' ? <Overview entry={merged} atlas={atlas} character={character} onBoss={openBoss} /> : null}
              {section === 'bosses' ? <Bosses atlas={atlas} detail={detail.data} boss={boss} onBoss={openBoss} {...loot} /> : null}
              {section === 'loot' ? (
                <>
                  {!character ? <p className="gw-muted">Sync a character to keep a wishlist.</p> : null}
                  <LootList rows={rows} {...loot} />
                </>
              ) : null}
              {section === 'quests' ? <Quests atlas={atlas} /> : null}
              {section === 'runs' ? <Runs entry={merged} character={character} server={server} /> : null}
            </>
          ) : detail.status === 'ready' ? <EmptyState title="Nothing known about this dungeon yet." icon="dungeon" /> : null}
        </div>
      </section>
    </div>
  )
}
