import { useState } from 'react'

import { QUALITY_NAMES, acquisitionCopy, confidenceCopy, evidenceText } from '../lootModel.js'
import { Icon, ItemLabel } from '../ui.jsx'
import { UNVERIFIED_LABEL, itemFacts, observedRateText, referenceRateText } from './atlasModel.js'

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

// One item: icon (with the game's tooltip for observed items), facts,
// where it came from, wishlist state and a one-click toggle. "Item facts"
// opens the full record and a link back to its source.
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
  return (
    <li className={`gw-atlas-loot${wanted ? ' is-wanted' : ''}${acquired ? ' is-acquired' : ''}`} data-item={item.itemKey}>
      <ItemLabel item={item} size={26} muted={acquired} tooltip={Boolean(row.observed)} />
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
      <details className="gw-atlas-loot__more">
        <summary>Item facts</summary>
        {facts.length ? (
          <dl className="gw-atlas-itemfacts">{facts.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
        ) : <p className="gw-muted">No item facts recorded yet.</p>}
        <p className="gw-muted gw-atlas-loot__source">
          {row.source ? (
            onSource && (row.bossKey || row.sourceKind === 'quest') ? (
              <>Source: <button type="button" className="gw-link" onClick={() => onSource(row)}>{row.source}</button></>
            ) : <>Source: {row.source}</>
          ) : 'Source not identified.'}
          {evidence ? ` · Observed: ${evidence}` : ''}
          {row.reference && !row.observed && !row.foreverDb && !(row.item?.referenceRates || []).length ? ` · ${UNVERIFIED_LABEL}. Drop chances are not published.` : ''}
          {acquired ? ` · ${acquisitionCopy(wish).detail}` : ''}
        </p>
      </details>
    </li>
  )
}

// A list of items, optionally capped with a "Show all" button.
export function LootList({ rows, wishes, empty = 'No loot recorded here yet.', limit = 0, ...line }) {
  const [all, setAll] = useState(false)
  if (!rows.length) return <p className="gw-muted">{empty}</p>
  const shown = limit && !all ? rows.slice(0, limit) : rows
  // ForeverDB's licence asks for this credit wherever its data is shown.
  const foreverDb = shown.some((row) => row.foreverDb || (row.item?.referenceRates || []).some((rate) => rate?.source === 'foreverdb')
    || (row.item?.factSources || []).includes('foreverdb'))
  return (
    <>
      <ul className="gw-atlas-loot-list">
        {shown.map((row) => <LootLine key={`${row.sourceKey}-${row.item.itemKey}`} row={row} wish={wishes.get(row.item.itemKey)} {...line} />)}
      </ul>
      {shown.length < rows.length ? (
        <button type="button" className="gw-btn gw-btn--sm gw-atlas-more" onClick={() => setAll(true)}>Show all {rows.length}</button>
      ) : null}
      {foreverDb ? <p className="gw-muted gw-atlas-credit"><a className="gw-link" href="https://foreverdb.net" target="_blank" rel="noreferrer">Data from ForeverDB.net</a></p> : null}
    </>
  )
}
