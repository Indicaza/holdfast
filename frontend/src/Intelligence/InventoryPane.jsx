import { useMemo, useState } from 'react'

import WowIcon, { ItemHoverCard, ItemIcon } from '../WowAssets/WowIcon.jsx'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import { statsArt } from './characterArt.js'
import { inventoryGroups, inventorySummary } from './inventoryModel.js'
import { formatSyncAge } from './model.js'
import './CharacterEquipmentSheet.css'
import './CharacterStats.css'
import './InventoryPane.css'

// The game's bag windows, drawn with their own art (public/inventory-art):
// the backpack's frame with its money bar, and every other bag built from the
// container frame's top, row and bottom pieces, so each is exactly as tall as
// its slots. Beside them, a character-sheet column sums up money, bag space,
// vendor value and the most-carried materials. "All Items" folds every stack
// into one row per item, grouped by item class with materials first.

const VIEWS = [
  { id: 'bags', label: 'Bags' },
  { id: 'items', label: 'All Items' },
]

const COINS = [
  ['gold', 'gold'],
  ['silver', 'silver'],
  ['copperRemainder', 'copper'],
]

// MoneyFrame: show gold and silver once there are any, copper always.
function Money({ money, className = '' }) {
  const shown = COINS.filter((_, index) => index === COINS.length - 1 || COINS.slice(0, index + 1).some(([earlier]) => money[earlier] > 0))
  return (
    <span className={`inv-money${className ? ` ${className}` : ''}`} aria-label={`${money.gold} gold, ${money.silver} silver, ${money.copperRemainder} copper`}>
      {shown.map(([key, coin]) => (
        <span key={coin} className="inv-money__part">
          {money[key].toLocaleString()}
          <img src={`/inventory-art/coin-${coin}.webp`} alt="" width="13" height="13" />
        </span>
      ))}
    </span>
  )
}

function Cell({ entry, bagLabel, style }) {
  const { item, slot } = entry
  if (!item) return <span className="inv-cell" style={style} aria-hidden="true" />
  const quality = Number(item.qualityId) || 0
  const name = item.name || `Item ${item.itemId || ''}`.trim()
  return (
    <ItemHoverCard item={item} side="right">
      <span
        className={`inv-cell inv-cell--filled inv-cell--quality-${quality}`}
        style={style}
        tabIndex={0}
        role="img"
        aria-label={`${bagLabel} slot ${slot}: ${name}${item.count > 1 ? `, ${item.count}` : ''}`}
      >
        <ItemIcon item={item} size={36} />
        {item.count > 1 ? <span className="inv-cell__count">{item.count}</span> : null}
      </span>
    </ItemHoverCard>
  )
}

// One row of four. A short first row sits against the right edge; the frame
// art has room for two there, so a one- or three-slot remainder fills the gap
// with blanked-out cells.
function Row({ row, bag, frame }) {
  const missing = 4 - row.cells.length
  const fillers = row.lead && frame !== 'partial' ? Array.from({ length: missing }, (_, index) => index) : []
  return (
    <div className="inv-bag__cells">
      {fillers.map((index) => <span key={`filler-${index}`} className="inv-cell inv-cell--blank" aria-hidden="true" />)}
      {row.cells.map((entry, index) => (
        <Cell
          key={entry.slot}
          entry={entry}
          bagLabel={bag.label}
          style={index === 0 && row.lead && frame === 'partial' ? { gridColumnStart: 5 - row.cells.length } : undefined}
        />
      ))}
    </div>
  )
}

function Portrait({ bag }) {
  const icon = <WowIcon iconFileId={bag.iconFileId} label={bag.label} size={32} />
  if (!bag.item) return <span className="inv-bag__portrait">{icon}</span>
  return (
    <ItemHoverCard item={{ ...bag.item, iconFileDataId: bag.iconFileId }} side="top">
      <span className="inv-bag__portrait" tabIndex={0} role="img" aria-label={bag.item.name || bag.label}>{icon}</span>
    </ItemHoverCard>
  )
}

function Bag({ bag, money }) {
  const label = `${bag.label}, ${bag.usedSlots} of ${bag.slotCount} slots used`
  const title = <span className="inv-bag__title">{bag.label}</span>

  if (bag.frame === 'backpack') {
    return (
      <section className="inv-bag inv-bag--backpack-frame" aria-label={label}>
        <div className="inv-bag__piece inv-bag__piece--backpack">
          {title}
          <div className="inv-bag__grid">
            {bag.slots.map((entry) => <Cell key={entry.slot} entry={entry} bagLabel={bag.label} />)}
          </div>
          <div className="inv-bag__money"><Money money={money} /></div>
        </div>
      </section>
    )
  }

  const [first, ...rest] = bag.rows
  return (
    <section className={`inv-bag inv-bag--${bag.kind}`} aria-label={label}>
      <div className={`inv-bag__piece inv-bag__piece--top-${bag.frame}`}>
        <Portrait bag={bag} />
        {title}
        {first ? <Row row={first} bag={bag} frame={bag.frame} /> : null}
      </div>
      {rest.map((row) => (
        <div key={row.cells[0].slot} className="inv-bag__piece inv-bag__piece--row">
          <Row row={row} bag={bag} frame={bag.frame} />
        </div>
      ))}
      <div className="inv-bag__piece inv-bag__piece--bottom" aria-hidden="true" />
    </section>
  )
}

function ItemLine({ item }) {
  const quality = Number(item.qualityId) || 0
  return (
    <li>
      <ItemHoverCard item={item} side="left">
        <span className="inv-line" tabIndex={0}>
          <span className={`inv-line__icon inv-cell--quality-${quality}`}><ItemIcon item={item} size={22} /></span>
          <span className={`inv-line__name item-quality-${quality}`}>{item.name || `Item ${item.itemId}`}</span>
          <span className="inv-line__count">{item.count.toLocaleString()}</span>
        </span>
      </ItemHoverCard>
    </li>
  )
}

function Summary({ inventory, className }) {
  const summary = useMemo(() => inventorySummary(inventory), [inventory])
  return (
    <aside className="character-sheet__stats inv-summary" aria-label="Inventory summary" style={{ '--character-stats-art': statsArt(className) }}>
      <div className="wow-stats">
        <section className="wow-stats__section">
          <h3 className="wow-stats__plate">Money</h3>
          <div className="inv-summary__money"><Money money={inventory.money} /></div>
        </section>

        <section className="wow-stats__section">
          <h3 className="wow-stats__plate">Bags</h3>
          <dl>
            {inventory.bags.map((bag) => (
              <div key={bag.bagId} className="wow-stat">
                <dt>{bag.label}</dt>
                <dd>{bag.usedSlots}/{bag.slotCount}</dd>
              </div>
            ))}
            <div className="wow-stat">
              <dt>Free Slots</dt>
              <dd className={inventory.freeSlots === 0 ? 'wow-stat__value--debuffed' : undefined}>{inventory.freeSlots}</dd>
            </div>
          </dl>
        </section>

        <section className="wow-stats__section">
          <h3 className="wow-stats__plate">Carried</h3>
          <dl>
            <div className="wow-stat"><dt>Items</dt><dd>{summary.distinctItems}</dd></div>
            <div className="wow-stat"><dt>Stacks</dt><dd>{summary.stacks}</dd></div>
            <div className="wow-stat"><dt>Vendor Value</dt><dd><Money money={summary.vendorValue} className="inv-money--inline" /></dd></div>
          </dl>
        </section>

        {summary.materials.length ? (
          <section className="wow-stats__section">
            <h3 className="wow-stats__plate">Materials</h3>
            <ul className="inv-lines">
              {summary.materials.map((item) => <ItemLine key={item.itemId ?? item.key} item={item} />)}
            </ul>
            {summary.materialKinds > summary.materials.length ? (
              <p className="inv-summary__more">+{summary.materialKinds - summary.materials.length} more in All Items</p>
            ) : null}
          </section>
        ) : null}
      </div>
    </aside>
  )
}

function AllItems({ inventory }) {
  const groups = useMemo(() => inventoryGroups(inventory), [inventory])
  if (!groups.length) return <p className="inv-groups__empty">These bags are empty.</p>
  return (
    <div className="inv-groups wow-stats">
      {groups.map((group) => (
        <section key={group.name} className="wow-stats__section inv-group" aria-label={group.name}>
          <h3 className="wow-stats__plate">{group.name}</h3>
          <ul className="inv-lines">
            {group.items.map((item) => <ItemLine key={item.itemId ?? item.key} item={item} />)}
          </ul>
        </section>
      ))}
    </div>
  )
}

export default function InventoryPane({ inventory, className = '' }) {
  const [view, setView] = useState('bags')

  if (!inventory) {
    return (
      <div className="inventory-pane inventory-pane--empty">
        <EmptyTelemetry title="No inventory synced yet.">
          Guildweaver records bag contents and money as they change. Loot or move an item (or type /gw inventory), then /reload to sync.
        </EmptyTelemetry>
      </div>
    )
  }

  const backpack = inventory.bags.find((bag) => bag.frame === 'backpack')

  return (
    <div className="inventory-pane">
      <header className="inventory-pane__title">
        <span className="inventory-pane__portrait">
          <WowIcon iconFileId={inventory.bags[0]?.iconFileId} label="Inventory" size={34} />
        </span>
        <span className="inventory-pane__heading">
          <strong>Inventory</strong>
          <small>{inventory.usedSlots} of {inventory.slotCount} slots used · {formatSyncAge(inventory.capturedAt).replace(/^Synced/, 'Updated')}</small>
        </span>
        <span className="inventory-pane__views" role="group" aria-label="Inventory view">
          {VIEWS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`inventory-pane__view${view === entry.id ? ' is-active' : ''}`}
              aria-pressed={view === entry.id}
              onClick={() => setView(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </span>
      </header>

      <div className="inventory-pane__body">
        <div className="inventory-pane__main">
          {view === 'bags' ? (
            <div className="inv-bags">
              {inventory.bags.map((bag) => <Bag key={bag.bagId} bag={bag} money={inventory.money} />)}
            </div>
          ) : <AllItems inventory={inventory} />}
          {!backpack && view === 'bags' ? (
            <div className="inv-bags__money"><Money money={inventory.money} /></div>
          ) : null}
        </div>
        <Summary inventory={inventory} className={className} />
      </div>
    </div>
  )
}
