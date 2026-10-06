import { useEffect, useMemo, useState } from 'react'

import { ItemDetailCard, ItemIcon } from '../WowAssets/WowIcon.jsx'
import EmptyTelemetry from './EmptyTelemetry.jsx'

const leftSlots = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'SHIRT', 'TABARD', 'WRIST']
const rightSlots = ['HANDS', 'WAIST', 'LEGS', 'FEET', 'FINGER1', 'FINGER2', 'TRINKET1', 'TRINKET2']
const weaponSlots = ['MAINHAND', 'OFFHAND', 'RANGED']

function canonicalSlot(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace('FINGER0', 'FINGER1')
    .replace('TRINKET0', 'TRINKET1')
    .replace('MAINHANDSLOT', 'MAINHAND')
    .replace('SECONDARYHANDSLOT', 'OFFHAND')
    .replace('RANGEDSLOT', 'RANGED')
}

function slotLabel(value) {
  const labels = {
    HEAD: 'Head', NECK: 'Neck', SHOULDER: 'Shoulder', BACK: 'Back', CHEST: 'Chest', SHIRT: 'Shirt', TABARD: 'Tabard', WRIST: 'Wrist',
    HANDS: 'Hands', WAIST: 'Waist', LEGS: 'Legs', FEET: 'Feet', FINGER1: 'Finger 1', FINGER2: 'Finger 2', TRINKET1: 'Trinket 1', TRINKET2: 'Trinket 2',
    MAINHAND: 'Main Hand', OFFHAND: 'Off Hand', RANGED: 'Ranged',
  }
  return labels[canonicalSlot(value)] || String(value || 'Slot')
}

function classKey(value) {
  return String(value || 'adventurer').toLowerCase().replace(/[^a-z]+/g, '-')
}

function EquipmentSlot({ item, slot, active, onSelect }) {
  return (
    <button
      type="button"
      className={`paper-doll__slot${item ? ' paper-doll__slot--filled' : ''}${active ? ' paper-doll__slot--active' : ''}`}
      onClick={() => item && onSelect(item)}
      disabled={!item}
      title={item?.name || `${slotLabel(slot)} empty`}
    >
      {item ? <ItemIcon item={item} size={46} /> : <span className="paper-doll__empty-icon" aria-hidden="true">◇</span>}
      <span className="paper-doll__slot-copy">
        <small>{slotLabel(slot)}</small>
        <strong className={item ? `item-quality-${Number(item.quality) || 0}` : ''}>{item?.name || 'Empty'}</strong>
        {item?.itemLevel ? <em>ilvl {item.itemLevel}</em> : null}
      </span>
    </button>
  )
}

export default function EquipmentPaperDoll({ equipment = [], className = '', race = '' }) {
  const bySlot = useMemo(() => {
    const result = new Map()
    for (const item of equipment) {
      const key = canonicalSlot(item.slot)
      if (key) result.set(key, item)
    }
    return result
  }, [equipment])
  const [active, setActive] = useState(equipment[0] || null)

  useEffect(() => {
    setActive(equipment[0] || null)
  }, [equipment])

  if (!equipment.length) {
    return <EmptyTelemetry title="No equipment snapshot yet.">The paper doll will populate when Guildweaver submits equipped item data.</EmptyTelemetry>
  }

  return (
    <div className="paper-doll">
      <div className="paper-doll__layout">
        <div className="paper-doll__column paper-doll__column--left">
          {leftSlots.map((slot) => <EquipmentSlot key={slot} slot={slot} item={bySlot.get(slot)} active={active === bySlot.get(slot)} onSelect={setActive} />)}
        </div>
        <div className="paper-doll__figure" data-class={classKey(className)}>
          <span className="paper-doll__crest" aria-hidden="true">♜</span>
          <strong>{className || 'Adventurer'}</strong>
          <span>{race || 'Character'}</span>
        </div>
        <div className="paper-doll__column paper-doll__column--right">
          {rightSlots.map((slot) => <EquipmentSlot key={slot} slot={slot} item={bySlot.get(slot)} active={active === bySlot.get(slot)} onSelect={setActive} />)}
        </div>
        <div className="paper-doll__weapons">
          {weaponSlots.map((slot) => <EquipmentSlot key={slot} slot={slot} item={bySlot.get(slot)} active={active === bySlot.get(slot)} onSelect={setActive} />)}
        </div>
      </div>
      <ItemDetailCard item={active} />
    </div>
  )
}
