import { useEffect, useRef, useState } from 'react'

import { GameTooltipCard, GameTooltipHover } from '../../Intelligence/GameTooltip.jsx'
import { itemTooltipPending } from '../../Intelligence/gameTooltipModel.js'
import { WowIcon } from '../../WowAssets/WowIcon.jsx'
import { acquisitionCopy, confidenceCopy, evidenceText } from '../lootModel.js'
import { Icon } from '../ui.jsx'
import { UNVERIFIED_LABEL, itemFacts, observedRateText, referenceRateText, revealSource, sourceAnchor } from './atlasModel.js'
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

// One item, opened from its slot: the game's tooltip (captured lines, or the
// pending note: never one made up from metadata), then what Holdfast knows
// about this item from this source: evidence and rates, other sources, the
// wishlist, and the reference facts, kept apart from the game's text.
export function ItemInspector({ row, wish, character, busyKey = '', onToggle, onSource, onClose }) {
  const ref = useRef(null)
  const { item } = row
  const acquired = wish?.state === 'acquired'
  const facts = itemFacts(item)
  const pending = itemTooltipPending(item)
  const evidence = row.observed ? evidenceText(item) : ''
  const own = row.sourceKey ? { key: row.sourceKey, name: row.source, kind: row.sourceKind, bossKey: row.bossKey || null, questId: row.questId ?? null } : null
  const linkable = onSource && own && (row.bossKey || row.sourceKind === 'quest' || row.alsoFrom)
  const also = Array.isArray(row.alsoFrom) ? row.alsoFrom : []
  const quality = (item.qualityId === null || item.qualityId === undefined) ? 'Quality not known' : null
  useEffect(() => { ref.current?.focus({ preventScroll: true }) }, [row])
  return (
    <section ref={ref} className="gw-iteminspect" role="group" aria-label={`${item.name || 'Item'} details`} tabIndex={-1} data-item={item.itemKey}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose(true) } }}>
      <button type="button" className="gw-icon-btn gw-icon-btn--quiet gw-iteminspect__close" aria-label="Close item details" onClick={() => onClose(true)}><Icon name="close" size={14} /></button>
      <GameTooltipCard item={item} className="gw-iteminspect__tooltip" />
      <div className="gw-iteminspect__side">
        <p className="gw-iteminspect__source">
          {row.source ? (linkable ? <>From <SourceLink source={own} onSource={onSource} /></> : <>From {row.source}</>) : 'Source not identified'}
          {' '}<Provenance row={row} />
        </p>
        <Rates row={row} />
        {row.choice ? <p className="gw-iteminspect__note">Quest reward: choose one of the rewards.</p> : null}
        {row.usableNow === false && row.requiredLevel ? <p className="gw-iteminspect__note gw-atlas-loot__later">Usable at level {row.requiredLevel}.</p> : null}
        {item.kind === 'quest-item' || quality ? <p className="gw-iteminspect__note gw-muted">{[item.kind === 'quest-item' ? 'Quest item' : null, quality].filter(Boolean).join(' · ')}.</p> : null}
        {also.length ? (
          <p className="gw-atlas-loot__also gw-muted">
            Also from{' '}
            {also.map((other, index) => (
              <span key={other.key}>{index ? ', ' : ''}<SourceLink source={other} onSource={onSource} /> <span className="gw-atlas-loot__kind">({SOURCE_KIND_WORD[other.kind] || 'source'})</span></span>
            ))}
          </p>
        ) : null}
        <div className="gw-iteminspect__actions">
          <WishButton row={row} wish={wish} character={character} busyKey={busyKey} onToggle={onToggle} />
        </div>
        <details className="gw-atlas-loot__more">
          <summary>Item facts</summary>
          {pending ? <p className="gw-muted gw-iteminspect__factnote">Reference data, not the game's tooltip.</p> : null}
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
    </section>
  )
}

// One inventory slot: the icon in its quality border, the game's tooltip on
// hover or keyboard focus, and a press opens the item. Wanted and acquired
// show as small marks; nothing is ever added by hovering.
export function ItemSlot({ row, wish, open = false, onOpen }) {
  const { item } = row
  const wanted = Boolean(wish && wish.state !== 'acquired')
  const acquired = wish?.state === 'acquired'
  const quality = Number.isInteger(item.qualityId) ? item.qualityId : null
  const name = [item.name || 'Unknown item', wanted ? 'on the wishlist' : null, acquired ? 'acquired' : null, row.choice ? 'choose one' : null,
    row.usableNow === false && row.requiredLevel ? `usable at level ${row.requiredLevel}` : null].filter(Boolean).join(', ')
  return (
    <li className="gw-slotcell">
      <GameTooltipHover item={item} touch={false}>
        <button type="button" className={`gw-slot gw-slot--q${quality ?? 'x'}${wanted ? ' is-wanted' : ''}${acquired ? ' is-acquired' : ''}${row.usableNow === false ? ' is-later' : ''}${open ? ' is-open' : ''}`}
          aria-label={name} aria-expanded={open} data-item={item.itemKey} onClick={() => onOpen(row)}>
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

// Items as an inventory: a wrapping grid of slots. Pressing one opens it
// below the grid; Escape, the close button or a press elsewhere closes it.
export function LootList({ rows, wishes, empty = 'No loot recorded here yet.', credit = true, label = '', character = null, busyKey = '', onToggle, onSource }) {
  const [openKey, setOpenKey] = useState('')
  const listRef = useRef(null)
  const panelRef = useRef(null)
  const open = rows.find((row) => row.item.itemKey === openKey) || null
  const close = (refocus = false) => {
    const key = openKey
    setOpenKey('')
    if (refocus) listRef.current?.querySelector(`[data-item="${key}"]`)?.focus()
  }
  // A press outside the grid and the open item closes it.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      const inside = [listRef.current, panelRef.current].some((element) => element?.contains(event.target))
      if (!inside) setOpenKey('')
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])
  if (!rows.length) return empty ? <p className="gw-muted">{empty}</p> : null
  return (
    <div className="gw-lootgrid">
      <ul ref={listRef} className="gw-lootgrid__slots" aria-label={label || undefined}>
        {rows.map((row) => (
          <ItemSlot key={`${row.sourceKey}-${row.item.itemKey}`} row={row} wish={wishes.get(row.item.itemKey)} open={row.item.itemKey === openKey}
            onOpen={(target) => setOpenKey((current) => (current === target.item.itemKey ? '' : target.item.itemKey))} />
        ))}
      </ul>
      {open ? (
        <div ref={panelRef}>
          <ItemInspector row={open} wish={wishes.get(open.item.itemKey)} character={character} busyKey={busyKey} onToggle={onToggle} onSource={onSource} onClose={close} />
        </div>
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
