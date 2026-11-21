import { useState } from 'react'

import { QUALITY_NAMES, acquisitionCopy, confidenceCopy, evidenceText } from '../lootModel.js'
import { Icon, ItemLabel } from '../ui.jsx'
import { UNVERIFIED_LABEL, itemFacts, observedRateText, referenceRateText, revealSource, sourceAnchor } from './atlasModel.js'

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

// One item: icon (with the game's tooltip for observed items), facts,
// where it came from, wishlist state and a one-click toggle. Other sources
// that give the same item are named and linked; "Item facts" opens the full
// record and a link back to its source.
export function LootLine({ row, wish, character, busyKey = '', onToggle, onSource }) {
  const { item } = row
  const busy = Boolean(busyKey) && busyKey === item.itemKey
  const wanted = Boolean(wish && wish.state !== 'acquired')
  const acquired = wish?.state === 'acquired'
  const facts = itemFacts(item)
  const quality = (item.qualityId === null || item.qualityId === undefined) && row.reference ? 'quality unknown' : QUALITY_NAMES[item.qualityId]
  const summary = [item.kind === 'quest-item' ? 'Quest item' : null, quality, item.itemLevel ? `ilvl ${item.itemLevel}` : null, item.slot, row.hideSource ? null : row.source ? `from ${row.source}` : 'source not identified'].filter(Boolean)
  const evidence = row.observed ? evidenceText(item) : ''
  const label = `${wanted ? 'Remove' : 'Add'} ${item.name} ${wanted ? 'from' : 'to'} ${character ? `${character.name}'s` : 'the'} wishlist`
  const own = row.sourceKey ? { key: row.sourceKey, name: row.source, kind: row.sourceKind, bossKey: row.bossKey || null, questId: row.questId ?? null } : null
  const linkable = onSource && own && (row.bossKey || row.sourceKind === 'quest' || row.alsoFrom)
  const also = Array.isArray(row.alsoFrom) ? row.alsoFrom : []
  return (
    <li className={`gw-atlas-loot${wanted ? ' is-wanted' : ''}${acquired ? ' is-acquired' : ''}`} data-item={item.itemKey}>
      <ItemLabel item={item} size={30} muted={acquired} tooltip={Boolean(row.observed)} />
      <span className="gw-atlas-loot__facts gw-muted">
        {summary.join(' · ')}
        {row.usableNow === false && row.requiredLevel ? <> · <span className="gw-atlas-loot__later">at level {row.requiredLevel}</span></> : null}
        {row.choice ? ' · choose one' : ''}
      </span>
      <Rates row={row} />
      <span className="gw-atlas-loot__side">
        <Provenance row={row} />
        {acquired ? <span className="gw-tag gw-tag--ok"><Icon name="check" size={12} /> {acquisitionCopy(wish).label}</span> : (
          <button type="button" className={`gw-btn gw-btn--sm gw-loot-row__toggle${wanted ? ' is-on' : ''}`} aria-pressed={wanted} disabled={busy || !character}
            title={character ? undefined : 'Choose a character to keep a wishlist'} aria-label={label} onClick={() => onToggle(item, wanted, row)}>
            <Icon name={wanted ? 'check' : 'plus'} size={14} /> {wanted ? 'Wanted' : 'Want'}
          </button>
        )}
      </span>
      {also.length ? (
        <p className="gw-atlas-loot__also gw-muted">
          Also from{' '}
          {also.map((other, index) => (
            <span key={other.key}>{index ? ', ' : ''}<SourceLink source={other} onSource={onSource} /> <span className="gw-atlas-loot__kind">({SOURCE_KIND_WORD[other.kind] || 'source'})</span></span>
          ))}
        </p>
      ) : null}
      <details className="gw-atlas-loot__more">
        <summary>Item facts</summary>
        {facts.length ? (
          <dl className="gw-atlas-itemfacts">{facts.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
        ) : <p className="gw-muted">No item facts recorded yet.</p>}
        <p className="gw-muted gw-atlas-loot__source">
          {row.source ? (linkable ? <>Source: <SourceLink source={own} onSource={onSource} /></> : <>Source: {row.source}</>) : 'Source not identified.'}
          {evidence ? ` · Observed: ${evidence}` : ''}
          {row.reference && !row.observed && !row.foreverDb && !(row.item?.referenceRates || []).length ? ` · ${UNVERIFIED_LABEL}. Drop chances are not published.` : ''}
          {acquired ? ` · ${acquisitionCopy(wish).detail}` : ''}
        </p>
      </details>
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

// A list of items, optionally capped with a "Show all" button.
export function LootList({ rows, wishes, empty = 'No loot recorded here yet.', limit = 0, credit = true, ...line }) {
  const [all, setAll] = useState(false)
  if (!rows.length) return empty ? <p className="gw-muted">{empty}</p> : null
  const shown = limit && !all ? rows.slice(0, limit) : rows
  return (
    <>
      <ul className="gw-atlas-loot-list">
        {shown.map((row) => <LootLine key={`${row.sourceKey}-${row.item.itemKey}`} row={row} wish={wishes.get(row.item.itemKey)} {...line} />)}
      </ul>
      {shown.length < rows.length ? (
        <button type="button" className="gw-btn gw-btn--sm gw-atlas-more" onClick={() => setAll(true)}>Show all {rows.length}</button>
      ) : null}
      {credit && usesForeverDb(shown) ? <ForeverDbCredit /> : null}
    </>
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
        <span className="gw-muted">{rows.length} item{rows.length === 1 ? '' : 's'}</span>
        {guideLabel && onSource ? <button type="button" className="gw-link gw-atlas-source__guide" onClick={() => onSource(source)}>{guideLabel}</button> : null}
      </header>
      <LootList rows={rows} credit={false} onSource={onSource} {...lootProps} />
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
          {group.sources.map(({ source, rows: sourceRows }) => (
            <SourceBlock key={source.key} source={source} rows={sourceRows} lootProps={lootProps} onSource={onSource}
              guideLabel={source.kind === 'boss' && source.bossKey ? 'Boss guide' : source.kind === 'quest' ? 'Quest details' : ''} />
          ))}
        </section>
      ))}
      {usesForeverDb(rows) ? <ForeverDbCredit /> : null}
    </>
  )
}
