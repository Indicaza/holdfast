import { useMemo, useState } from 'react'

import WowIcon, { ItemHoverCard, ItemIcon } from '../WowAssets/WowIcon.jsx'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import { inventoryGroups } from './inventoryModel.js'
import { formatSyncAge } from './model.js'
import './InventoryPane.css'

// Modeled on the game's bag frames: each container is a small frame with its
// bag icon and name over a grid of slots, stack counts in the slot corner,
// and the backpack's money line along the bottom. "All Items" folds every
// stack into one row per item, grouped by item class with materials first.

const VIEWS = [
  { id: 'bags', label: 'Bags' },
  { id: 'items', label: 'All Items' },
]

function Money({ money }) {
  const parts = [
    ['gold', money.gold],
    ['silver', money.silver],
    ['copper', money.copperRemainder],
  ]
  const shown = parts.filter(([, value], index) => value > 0 || index === parts.length - 1 || parts.slice(0, index).some(([, earlier]) => earlier > 0))
  return (
    <span className="inv-money" aria-label={`${money.gold} gold, ${money.silver} silver, ${money.copperRemainder} copper`}>
      {shown.map(([coin, value]) => (
        <span key={coin} className={`inv-money__part inv-money__part--${coin}`}>
          {value.toLocaleString()}
          <i aria-hidden="true" />
        </span>
      ))}
    </span>
  )
}

function Slot({ entry, bagLabel }) {
  const { item, slot } = entry
  if (!item) return <span className="inv-slot inv-slot--empty" aria-hidden="true" />
  const quality = Number(item.qualityId) || 0
  const name = item.name || `Item ${item.itemId || ''}`.trim()
  return (
    <ItemHoverCard item={item} side="right">
      <span
        className={`inv-slot inv-slot--filled inv-slot--quality-${quality}`}
        tabIndex={0}
        aria-label={`${bagLabel} slot ${slot}: ${name}${item.count > 1 ? `, ${item.count}` : ''}`}
      >
        <ItemIcon item={item} size={36} />
        {item.count > 1 ? <span className="inv-slot__count">{item.count}</span> : null}
      </span>
    </ItemHoverCard>
  )
}

function Bag({ bag }) {
  const icon = bag.item ? { ...bag.item, iconFileDataId: bag.iconFileId } : null
  const portrait = <WowIcon iconFileId={bag.iconFileId} label={bag.label} size={26} />
  return (
    <section className={`inv-bag inv-bag--${bag.kind}`} aria-label={`${bag.label}, ${bag.usedSlots} of ${bag.slotCount} slots used`}>
      <header className="inv-bag__title">
        {icon ? (
          <ItemHoverCard item={icon} side="top">
            <span className="inv-bag__portrait" tabIndex={0}>{portrait}</span>
          </ItemHoverCard>
        ) : <span className="inv-bag__portrait">{portrait}</span>}
        <strong>{bag.label}</strong>
        <small>{bag.usedSlots}/{bag.slotCount}</small>
      </header>
      <div className="inv-bag__grid">
        {bag.slots.map((entry) => <Slot key={entry.slot} entry={entry} bagLabel={bag.label} />)}
      </div>
    </section>
  )
}

function ItemRow({ item }) {
  const quality = Number(item.qualityId) || 0
  return (
    <li>
      <ItemHoverCard item={item} side="right">
        <span className="inv-row" tabIndex={0}>
          <span className={`inv-slot inv-slot--filled inv-slot--quality-${quality}`}>
            <ItemIcon item={item} size={30} />
          </span>
          <span className={`inv-row__name item-quality-${quality}`}>{item.name || `Item ${item.itemId}`}</span>
          <span className="inv-row__count">{item.count.toLocaleString()}</span>
          <small className="inv-row__stacks">{item.stacks > 1 ? `${item.stacks} stacks` : ''}</small>
        </span>
      </ItemHoverCard>
    </li>
  )
}

export default function InventoryPane({ inventory }) {
  const [view, setView] = useState('bags')
  const groups = useMemo(() => (inventory ? inventoryGroups(inventory) : []), [inventory])

  if (!inventory) {
    return (
      <div className="inventory-pane inventory-pane--empty">
        <EmptyTelemetry title="No inventory synced yet.">
          Guildweaver records bag contents and money as they change. Loot, move an item or type /gw inventory, then /reload to sync.
        </EmptyTelemetry>
      </div>
    )
  }

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

      <div className="inventory-pane__content">
        {view === 'bags' ? (
          <div className="inv-bags">
            {inventory.bags.map((bag) => <Bag key={bag.bagId} bag={bag} />)}
          </div>
        ) : (
          <div className="inv-groups">
            {groups.map((group) => (
              <section key={group.name} className="inv-group" aria-label={group.name}>
                <h4 className="inv-group__title">{group.name}</h4>
                <ul>
                  {group.items.map((item) => <ItemRow key={item.itemId ?? item.key} item={item} />)}
                </ul>
              </section>
            ))}
            {!groups.length ? <p className="inv-groups__empty">Your bags are empty.</p> : null}
          </div>
        )}
      </div>

      <footer className="inventory-pane__footer">
        <span className="inventory-pane__free">{inventory.freeSlots} free {inventory.freeSlots === 1 ? 'slot' : 'slots'}</span>
        <Money money={inventory.money} />
      </footer>
    </div>
  )
}
