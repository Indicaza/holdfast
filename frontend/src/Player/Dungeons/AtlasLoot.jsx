import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { GameTooltipCard, GameTooltipHover } from '../../Intelligence/GameTooltip.jsx'
import { placeFloating } from '../../WowAssets/floatingPlacement.js'
import { WowIcon } from '../../WowAssets/WowIcon.jsx'
import { acquisitionCopy, confidenceCopy, evidenceText } from '../lootModel.js'
import { Icon } from '../ui.jsx'
import { UNVERIFIED_LABEL, itemFacts, observedRateText, referenceRateText, referenceTooltip, revealSource, sourceAnchor } from './atlasModel.js'
import './AtlasLootGrid.css'

export function UnverifiedBadge({ label = UNVERIFIED_LABEL }) {
  return <span className="gw-tag gw-tag--quiet gw-atlas-unverified" title="From Classic reference data; not yet checked on WoW Forever">{label}</span>
}

// Where an item comes from, in words: observed telemetry, Classic
// reference, or both.
function Provenance({ row }) {
  if (row.observed) {
    const item = row.item
    const confidence = item.confidence ? confidenceCopy(item.confidence) : null
    const evidence = evidenceText(item)
    return (
      <span className={`gw-tag gw-tag--${confidence?.tone || 'ok'} gw-atlas-loot__evidence`} title={[confidence?.help, evidence].filter(Boolean).join(' ')}>
        {confidence?.label || 'Seen by Guildweaver'}
      </span>
    )
  }
  if (row.foreverDb) return <span className="gw-tag gw-tag--quiet" title="Listed by ForeverDB from what its players saw in WoW Forever">WoW Forever (ForeverDB)</span>
  const sources = Array.isArray(row.item?.factSources) ? row.item.factSources : []
  if (sources.includes('wago-forever') && !sources.includes('wago-classic-era')) {
    return <span className="gw-tag gw-tag--quiet" title="An item WoW Forever added; its facts come from the Forever client and ForeverDB">WoW Forever item</span>
  }
  return <UnverifiedBadge label="Classic reference" />
}

// Reference and Guildweaver drop rates, side by side, each with its count.
function Rates({ row }) {
  const reference = (Array.isArray(row.item?.referenceRates) ? row.item.referenceRates : []).map(referenceRateText).filter(Boolean)
  const observed = observedRateText(row.observedRate)
  if (!reference.length && !observed) return null
  return (
    <span className="gw-atlas-loot__rates gw-muted">
      {reference.length ? <>Reference: {reference.join('; ')}</> : null}
      {reference.length && observed ? ' · ' : null}
      {observed ? (
        <span title={row.observedRate?.reason || undefined}>Guildweaver{row.observedRate?.preliminary ? ' (preliminary)' : ''}: {observed}</span>
      ) : null}
    </span>
  )
}

// A source's name as a link to it: a boss's guide, the quest, or its place
// in the loot list. Plain text when nothing can open it.
export function SourceLink({ source, onSource, children }) {
  if (!onSource || !source) return <>{children ?? source?.name}</>
  return <button type="button" className="gw-link gw-atlas-sourcelink" onClick={() => onSource(source)}>{children ?? source.name}</button>
}

const SOURCE_KIND_WORD = { boss: 'boss', rare: 'rare', trash: 'trash', shared: 'shared drop', quest: 'quest reward', unknown: 'unknown source' }

// The wishlist button for one item: add, remove, or acquired.
function WishButton({ row, wish, character, busyKey, onToggle }) {
  const { item } = row
  const wanted = Boolean(wish && wish.state !== 'acquired')
  if (wish?.state === 'acquired') return <span className="gw-tag gw-tag--ok"><Icon name="check" size={12} /> {acquisitionCopy(wish).label}</span>
  const label = `${wanted ? 'Remove' : 'Add'} ${item.name} ${wanted ? 'from' : 'to'} ${character ? `${character.name}'s` : 'the'} wishlist`
  return (
    <button type="button" className={`gw-btn gw-btn--sm gw-loot-row__toggle${wanted ? ' is-on' : ''}`} aria-pressed={wanted} disabled={(Boolean(busyKey) && busyKey === item.itemKey) || !character}
      title={character ? undefined : 'Choose a character to keep a wishlist'} aria-label={label} onClick={() => onToggle(item, wanted, row)}>
      <Icon name={wanted ? 'check' : 'plus'} size={14} /> {wanted ? 'On wishlist' : 'Add to wishlist'}
    </button>
  )
}

// What the journal knows about an item from this source, under the game's
// tooltip (the add-on's lines below the client's): where it drops, other
// sources, rates and evidence, and the character's wishlist state.
export function ItemJournalLines({ row, wish, hint = false }) {
  const { item } = row
  const also = Array.isArray(row.alsoFrom) ? row.alsoFrom : []
  const reference = (Array.isArray(item.referenceRates) ? item.referenceRates : []).map(referenceRateText).filter(Boolean)
  const observed = observedRateText(row.observedRate)
  const from = row.sourceKind === 'quest' ? `Quest reward: ${row.source}` : row.source ? `Drops from ${row.source}` : 'Source not identified'
  const evidence = row.observed ? (item.confidence ? confidenceCopy(item.confidence).label : 'Seen by Guildweaver')
    : row.foreverDb ? 'Listed by ForeverDB (seen in WoW Forever)' : 'Classic reference: not verified for Forever'
  return (
    <>
      <p className="game-tooltip__extra-from">{from}</p>
      {also.length ? <p>Also from {also.map((other) => other.name).join(', ')}</p> : null}
      {reference.length ? <p>Drop rate: {reference.join('; ')}</p> : null}
      {observed ? <p>Guildweaver{row.observedRate?.preliminary ? ' (preliminary)' : ''}: {observed}</p> : null}
      <p className="game-tooltip__extra-faint">{evidence}</p>
      {item.qualityId === null || item.qualityId === undefined ? <p className="game-tooltip__extra-faint">Quality not known yet</p> : null}
      {row.choice ? <p>Quest reward: choose one</p> : null}
      {row.usableNow === false && row.requiredLevel ? <p className="game-tooltip__extra-warn">Usable at level {row.requiredLevel}</p> : null}
      {wish?.state === 'acquired' ? <p className="game-tooltip__extra-good">On your wishlist: acquired</p>
        : wish ? <p className="game-tooltip__extra-wish">On your wishlist{wish.priority && wish.priority !== 'normal' ? ` (${wish.priority})` : ''}</p> : null}
      {hint ? <p className="game-tooltip__extra-faint">Click for details and wishlist</p> : null}
    </>
  )
}

// One item, opened from its slot: a popover beside the slot (a sheet on a
// phone) that floats over the page, so its card never grows. The game's
// tooltip (or the reference facts, marked as such), then this source's
// evidence, the other sources (linked), the wishlist button and every
// recorded fact. Escape, the close button, a press elsewhere or the slot
// scrolling away closes it; focus goes back to the slot.
export function ItemInspector({ row, wish, character, busyKey = '', onToggle, onSource, onClose, anchor = null }) {
  const ref = useRef(null)
  const [position, setPosition] = useState(null)
  const { item } = row
  const acquired = wish?.state === 'acquired'
  const facts = itemFacts(item)
  const evidence = row.observed ? evidenceText(item) : ''
  const own = row.sourceKey ? { key: row.sourceKey, name: row.source, kind: row.sourceKind, bossKey: row.bossKey || null, questId: row.questId ?? null } : null
  const linkable = onSource && own && (row.bossKey || row.sourceKind === 'quest' || row.alsoFrom)
  const also = Array.isArray(row.alsoFrom) ? row.alsoFrom : []
  const reference = referenceTooltip(item, { reference: Boolean(row.reference && !row.observed) })
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  // Placed beside its slot, kept there while the page scrolls; a sheet on narrow screens.
  useLayoutEffect(() => {
    const place = () => {
      const panel = ref.current
      if (!panel) return
      if (!anchor || window.innerWidth <= 640) { setPosition({ sheet: true }); return }
      if (!anchor.isConnected) { onCloseRef.current(false); return }
      const rect = anchor.getBoundingClientRect()
      if (rect.bottom < 0 || rect.top > window.innerHeight) { onCloseRef.current(false); return }
      const { width, height } = panel.getBoundingClientRect()
      setPosition(placeFloating(rect, width, height, 'right'))
    }
    place()
    let frame = 0
    const later = (event) => {
      if (event?.target instanceof Node && ref.current?.contains(event.target)) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    }
    window.addEventListener('scroll', later, true)
    window.addEventListener('resize', later)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', later, true)
      window.removeEventListener('resize', later)
    }
  }, [anchor, row])
  // Focus moves in once it is placed (a hidden box cannot take focus).
  const placed = position !== null
  useEffect(() => { if (placed) ref.current?.focus({ preventScroll: true }) }, [placed, row])
  // Escape closes it wherever focus is (a mouse press leaves focus on the slot).
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onCloseRef.current(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const style = position?.sheet ? undefined : position ? { left: position.left, top: position.top } : { left: 0, top: 0, visibility: 'hidden' }
  return createPortal(
    <section ref={ref} className={`gw-itempop${position?.sheet ? ' gw-itempop--sheet' : ''}`} role="dialog" aria-label={`${item.name || 'Item'} details`} tabIndex={-1}
      data-item={item.itemKey} style={style}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true) } }}>
      <button type="button" className="gw-icon-btn gw-icon-btn--quiet gw-itempop__close" aria-label="Close item details" onClick={() => onClose(true)}><Icon name="close" size={14} /></button>
      <GameTooltipCard item={item} reference={reference} className="gw-itempop__tooltip" />
      <div className="gw-itempop__side">
        <p className="gw-itempop__source">
          {row.source ? (linkable ? <>From <SourceLink source={own} onSource={onSource} /></> : <>From {row.source}</>) : 'Source not identified'}
          {' '}<Provenance row={row} />
        </p>
        <Rates row={row} />
        {row.choice ? <p className="gw-itempop__note">Quest reward: choose one of the rewards.</p> : null}
        {row.usableNow === false && row.requiredLevel ? <p className="gw-itempop__note gw-atlas-loot__later">Usable at level {row.requiredLevel}.</p> : null}
        {item.kind === 'quest-item' || item.qualityId === null || item.qualityId === undefined ? (
          <p className="gw-itempop__note gw-muted">{[item.kind === 'quest-item' ? 'Quest item' : null, item.qualityId === null || item.qualityId === undefined ? 'Quality not known' : null].filter(Boolean).join(' · ')}.</p>
        ) : null}
        {also.length ? (
          <p className="gw-atlas-loot__also gw-muted">
            Also from{' '}
            {also.map((other, index) => (
              <span key={other.key}>{index ? ', ' : ''}<SourceLink source={other} onSource={onSource} /> <span className="gw-atlas-loot__kind">({SOURCE_KIND_WORD[other.kind] || 'source'})</span></span>
            ))}
          </p>
        ) : null}
        <div className="gw-itempop__actions">
          <WishButton row={row} wish={wish} character={character} busyKey={busyKey} onToggle={onToggle} />
        </div>
        <details className="gw-atlas-loot__more">
          <summary>Item facts</summary>
          {facts.length ? (
            <dl className="gw-atlas-itemfacts">{facts.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
          ) : <p className="gw-muted">No item facts recorded yet.</p>}
          <p className="gw-muted gw-atlas-loot__source">
            {row.source ? <>Source: {row.source}</> : 'Source not identified.'}
            {evidence ? ` · Observed: ${evidence}` : ''}
            {row.reference && !row.observed && !row.foreverDb && !(row.item?.referenceRates || []).length ? ` · ${UNVERIFIED_LABEL}. Drop chances are not published.` : ''}
            {acquired ? ` · ${acquisitionCopy(wish).detail}` : ''}
          </p>
        </details>
      </div>
    </section>,
    document.body,
  )
}

// One inventory slot: the icon in its quality border, the game's tooltip
// with the journal's lines on hover or keyboard focus, and a press opens the
// item. Wanted and acquired show as small marks; nothing is ever added by
// hovering. The slot never moves or grows (see AtlasLootGrid.css).
export function ItemSlot({ row, wish, open = false, onOpen }) {
  const { item } = row
  const wanted = Boolean(wish && wish.state !== 'acquired')
  const acquired = wish?.state === 'acquired'
  const quality = Number.isInteger(item.qualityId) ? item.qualityId : null
  const name = [item.name || 'Unknown item', wanted ? 'on the wishlist' : null, acquired ? 'acquired' : null, row.choice ? 'choose one' : null,
    row.usableNow === false && row.requiredLevel ? `usable at level ${row.requiredLevel}` : null].filter(Boolean).join(', ')
  const reference = useMemo(() => referenceTooltip(item, { reference: Boolean(row.reference && !row.observed) }), [item, row.reference, row.observed])
  return (
    <li className="gw-slotcell">
      <GameTooltipHover item={item} disabled={open} touch={false} reference={reference} extra={<ItemJournalLines row={row} wish={wish} hint />}>
        <button type="button" className={`gw-slot gw-slot--q${quality ?? 'x'}${wanted ? ' is-wanted' : ''}${acquired ? ' is-acquired' : ''}${row.usableNow === false ? ' is-later' : ''}${open ? ' is-open' : ''}`}
          aria-label={name} aria-expanded={open} aria-haspopup="dialog" data-item={item.itemKey} onClick={(event) => onOpen(row, event.currentTarget)}>
          <WowIcon iconFileId={item.iconFileDataId} itemId={item.itemId} label={item.name} size={44} />
          {wanted ? <span className="gw-slot__mark gw-slot__mark--wanted" aria-hidden="true"><Icon name="check" size={10} /></span> : null}
          {acquired ? <span className="gw-slot__mark gw-slot__mark--acquired" aria-hidden="true"><Icon name="check" size={10} /></span> : null}
          {row.choice ? <span className="gw-slot__corner" aria-hidden="true">or</span> : null}
        </button>
      </GameTooltipHover>
    </li>
  )
}

// ForeverDB's licence asks for this credit wherever its data is shown.
function usesForeverDb(rows) {
  return rows.some((row) => row.foreverDb || (row.item?.referenceRates || []).some((rate) => rate?.source === 'foreverdb')
    || (row.item?.factSources || []).includes('foreverdb'))
}

function ForeverDbCredit() {
  return <p className="gw-muted gw-atlas-credit"><a className="gw-link" href="https://foreverdb.net" target="_blank" rel="noreferrer">Data from ForeverDB.net</a></p>
}

// Items as an inventory: a wrapping grid of slots. Pressing one opens it in
// a popover over the page (ItemInspector); the grid and its card keep their
// size. Escape, the close button or a press elsewhere closes it.
export function LootList({ rows, wishes, empty = 'No loot recorded here yet.', credit = true, label = '', character = null, busyKey = '', onToggle, onSource }) {
  const [opened, setOpened] = useState({ key: '', anchor: null })
  const listRef = useRef(null)
  const open = rows.find((row) => row.item.itemKey === opened.key) || null
  const close = (refocus = false) => {
    const anchor = opened.anchor
    setOpened({ key: '', anchor: null })
    if (refocus && anchor?.isConnected) anchor.focus()
  }
  // A press outside the slot and the open item closes it.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      const popover = document.querySelector('.gw-itempop')
      if (popover?.contains(event.target) || opened.anchor?.contains(event.target)) return
      setOpened({ key: '', anchor: null })
    }
    // Capture: a control that stops its own pointerdown still closes it.
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open, opened.anchor])
  if (!rows.length) return empty ? <p className="gw-muted">{empty}</p> : null
  return (
    <div className="gw-lootgrid">
      <ul ref={listRef} className="gw-lootgrid__slots" aria-label={label || undefined}>
        {rows.map((row) => (
          <ItemSlot key={`${row.sourceKey}-${row.item.itemKey}`} row={row} wish={wishes.get(row.item.itemKey)} open={row.item.itemKey === opened.key}
            onOpen={(target, anchor) => setOpened((current) => (current.key === target.item.itemKey ? { key: '', anchor: null } : { key: target.item.itemKey, anchor }))} />
        ))}
      </ul>
      {open ? (
        <ItemInspector row={open} wish={wishes.get(open.item.itemKey)} character={character} busyKey={busyKey} onToggle={onToggle} onSource={onSource} onClose={close} anchor={opened.anchor} />
      ) : null}
      {credit && usesForeverDb(rows) ? <ForeverDbCredit /> : null}
    </div>
  )
}

const SOURCE_ICON = { boss: 'dungeon', rare: 'sparkle', trash: 'target', shared: 'loot', quest: 'pin', unknown: 'info' }

function SourceBadge({ source }) {
  if (source.portraitUrl) return <img className="gw-atlas-portrait" src={source.portraitUrl} alt="" width={32} height={32} />
  return <span className={`gw-atlas-source__badge gw-atlas-source__badge--${source.kind}`} aria-hidden="true"><Icon name={SOURCE_ICON[source.kind] || 'loot'} size={16} /></span>
}

// One source's drops under its name: the link between a drop and where it
// comes from is the block it sits in.
function SourceBlock({ source, rows, lootProps, onSource, guideLabel }) {
  return (
    <section id={sourceAnchor(source.key)} className={`gw-atlas-source gw-atlas-source--${source.kind}`} aria-label={`${source.name} loot`} tabIndex={-1} data-source={source.key}>
      <header className="gw-atlas-source__head">
        <SourceBadge source={source} />
        <h4>{source.name}</h4>
        <span className="gw-muted gw-atlas-source__count">{rows.length} drop{rows.length === 1 ? '' : 's'}</span>
        {guideLabel && onSource ? <button type="button" className="gw-link gw-atlas-source__guide" onClick={() => onSource(source)}>{guideLabel}</button> : null}
      </header>
      <LootList rows={rows} credit={false} label={`${source.name} loot`} {...lootProps} onSource={onSource} />
    </section>
  )
}

// A dungeon's loot grouped by source (lootBySource): bosses, rares, trash
// and adds, shared drops and chests, quest rewards, unknown. `filter` keeps
// some rows; a source left with none is not shown.
export function SourceGroups({ groups, filter = null, lootProps, onSource }) {
  const shown = groups.map((group) => ({ ...group, sources: group.sources.map((source) => ({ source, rows: filter ? source.rows.filter(filter) : source.rows })).filter((entry) => entry.rows.length) }))
    .filter((group) => group.sources.length)
  const rows = shown.flatMap((group) => group.sources.flatMap((entry) => entry.rows))
  if (!shown.length) return null
  return (
    <>
      {shown.length > 1 ? (
        <nav className="gw-atlas-lootjump" aria-label="Loot sources">
          {shown.map((group) => (
            <button key={group.kind} type="button" className="gw-atlas-chip" onClick={() => revealSource(`group-${group.kind}`)}>
              {group.label} <span className="gw-muted">{group.sources.reduce((sum, entry) => sum + entry.rows.length, 0)}</span>
            </button>
          ))}
        </nav>
      ) : null}
      {shown.map((group) => (
        <section key={group.kind} id={sourceAnchor(`group-${group.kind}`)} className="gw-atlas-lootgroup" aria-label={group.label} tabIndex={-1}>
          <h3>{group.label}</h3>
          <div className="gw-atlas-lootgroup__sources">
            {group.sources.map(({ source, rows: sourceRows }) => (
              <SourceBlock key={source.key} source={source} rows={sourceRows} lootProps={lootProps} onSource={onSource}
                guideLabel={source.kind === 'boss' && source.bossKey ? 'Boss guide' : source.kind === 'quest' ? 'Quest details' : ''} />
            ))}
          </div>
        </section>
      ))}
      {usesForeverDb(rows) ? <ForeverDbCredit /> : null}
    </>
  )
}
