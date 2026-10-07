import { useEffect, useMemo, useState } from 'react'

import { ItemDetailCard, ItemHoverTarget, ItemIcon } from '../WowAssets/WowIcon.jsx'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import { canonicalEquipmentSlot } from './model.js'
import './ArmoryPolish.css'

const leftSlots = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'SHIRT', 'TABARD', 'WRIST']
const rightSlots = ['HANDS', 'WAIST', 'LEGS', 'FEET', 'FINGER1', 'FINGER2', 'TRINKET1', 'TRINKET2']
const weaponSlots = ['MAINHAND', 'OFFHAND', 'RANGED']

function slotLabel(value) {
  const labels = {
    HEAD: 'Head', NECK: 'Neck', SHOULDER: 'Shoulder', BACK: 'Back', CHEST: 'Chest', SHIRT: 'Shirt', TABARD: 'Tabard', WRIST: 'Wrist',
    HANDS: 'Hands', WAIST: 'Waist', LEGS: 'Legs', FEET: 'Feet', FINGER1: 'Finger 1', FINGER2: 'Finger 2', TRINKET1: 'Trinket 1', TRINKET2: 'Trinket 2',
    MAINHAND: 'Main Hand', OFFHAND: 'Off Hand', RANGED: 'Ranged',
  }
  return labels[canonicalEquipmentSlot(value)] || String(value || 'Slot')
}

function classKey(value) {
  return String(value || 'adventurer').toLowerCase().replace(/[^a-z]+/g, '-')
}

function EquipmentSlot({ item, slot, active, onSelect }) {
  const label = slotLabel(slot)

  if (!item) {
    return (
      <button
        type="button"
        className="paper-doll__slot paper-doll__slot--empty"
        disabled
        aria-label={`${label} empty`}
      >
        <span className="paper-doll__empty-icon" aria-hidden="true">◇</span>
        <span className="paper-doll__slot-copy">
          <small>{label}</small>
          <strong>Empty</strong>
        </span>
      </button>
    )
  }

  const quality = Number(item.quality) || 0
  const itemName = item.name || `Item ${item.itemId || ''}`
  return (
    <ItemHoverTarget item={item} className="paper-doll__hover">
      {(tooltipId) => (
        <button
          type="button"
          className={`paper-doll__slot paper-doll__slot--filled paper-doll__slot--quality-${quality}${active ? ' paper-doll__slot--active' : ''}`}
          onClick={() => onSelect(item)}
          aria-describedby={tooltipId}
          aria-pressed={active}
          title={itemName}
        >
          <ItemIcon item={item} size={48} />
          <span className="paper-doll__slot-copy">
            <span className="paper-doll__slot-kicker">
              <small>{label}</small>
              {item.itemLevel ? <em>ilvl {item.itemLevel}</em> : null}
            </span>
            <strong className={`item-quality-${quality}`}>{itemName}</strong>
            <span className="paper-doll__slot-type">{item.itemSubclassName || item.subclass || item.itemClassName || ''}</span>
          </span>
        </button>
      )}
    </ItemHoverTarget>
  )
}

export default function EquipmentPaperDoll({ equipment = [], className = '', race = '' }) {
  const bySlot = useMemo(() => {
    const result = new Map()
    for (const item of equipment) {
      const key = canonicalEquipmentSlot(item.slot)
      if (key) result.set(key, item)
    }
    return result
  }, [equipment])
  const [active, setActive] = useState(equipment[0] || null)

  useEffect(() => {
    setActive(equipment[0] || null)
  }, [equipment])

  const itemLevels = equipment
    .map((item) => Number(item.itemLevel))
    .filter((value) => Number.isFinite(value) && value > 0)
  const averageItemLevel = itemLevels.length
    ? Math.round(itemLevels.reduce((sum, value) => sum + value, 0) / itemLevels.length)
    : null

  if (!equipment.length) {
    return <EmptyTelemetry title="No equipment snapshot yet.">The paper doll will populate when Guildweaver submits equipped item data.</EmptyTelemetry>
  }

  return (
    <div className="paper-doll paper-doll--armory">
      <div className="paper-doll__layout">
        <div className="paper-doll__column paper-doll__column--left">
          {leftSlots.map((slot) => <EquipmentSlot key={slot} slot={slot} item={bySlot.get(slot)} active={active === bySlot.get(slot)} onSelect={setActive} />)}
        </div>
        <div className="paper-doll__figure" data-class={classKey(className)}>
          <span className="paper-doll__figure-label">Current loadout</span>
          <span className="paper-doll__crest" aria-hidden="true">♜</span>
          <strong>{className || 'Adventurer'}</strong>
          <span>{race || 'Character'}</span>
          <div className="paper-doll__loadout-stats">
            <div><b>{equipment.length}</b><small>equipped</small></div>
            <div><b>{averageItemLevel || '—'}</b><small>avg ilvl</small></div>
          </div>
          <small className="paper-doll__hint">Hover gear for the in-game tooltip. Click to pin details.</small>
        </div>
        <div className="paper-doll__column paper-doll__column--right">
          {rightSlots.map((slot) => <EquipmentSlot key={slot} slot={slot} item={bySlot.get(slot)} active={active === bySlot.get(slot)} onSelect={setActive} />)}
        </div>
        <div className="paper-doll__weapons">
          {weaponSlots.map((slot) => <EquipmentSlot key={slot} slot={slot} item={bySlot.get(slot)} active={active === bySlot.get(slot)} onSelect={setActive} />)}
        </div>
      </div>
      <div className="paper-doll__detail-rail">
        <span className="paper-doll__detail-label">Selected gear</span>
        <ItemDetailCard item={active} />
      </div>
    </div>
  )
}
