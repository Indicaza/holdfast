import { useEffect, useMemo, useState } from 'react'

import { ItemDetailCard, ItemHoverCard, ItemIcon } from '../WowAssets/WowIcon.jsx'
import EmptyTelemetry from './EmptyTelemetry.jsx'
import { canonicalEquipmentSlot } from './model.js'
import './CharacterArmoryV2.css'

const leftSlots = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'SHIRT', 'TABARD', 'WRIST']
const rightSlots = ['HANDS', 'WAIST', 'LEGS', 'FEET', 'FINGER1', 'FINGER2', 'TRINKET1', 'TRINKET2']
const weaponSlots = ['MAINHAND', 'OFFHAND', 'RANGED']
const allSlots = [...leftSlots, ...rightSlots, ...weaponSlots]

function slotLabel(value) {
  const labels = {
    HEAD: 'Head', NECK: 'Neck', SHOULDER: 'Shoulder', BACK: 'Back', CHEST: 'Chest', SHIRT: 'Shirt', TABARD: 'Tabard', WRIST: 'Wrist',
    HANDS: 'Hands', WAIST: 'Waist', LEGS: 'Legs', FEET: 'Feet', FINGER1: 'Finger 1', FINGER2: 'Finger 2', TRINKET1: 'Trinket 1', TRINKET2: 'Trinket 2',
    MAINHAND: 'Main Hand', OFFHAND: 'Off Hand', RANGED: 'Ranged',
  }
  const key = canonicalEquipmentSlot(value)
  return labels[key] || String(value || 'Slot')
}

function classKey(value) {
  return String(value || 'adventurer').toLowerCase().replace(/[^a-z]+/g, '-')
}

function EquipmentSlot({ item, slot, active, onSelect, tooltipSide = 'right' }) {
  const button = (
    <button
      type="button"
      className={`paper-doll__slot${item ? ' paper-doll__slot--filled' : ''}${active ? ' paper-doll__slot--active' : ''}`}
      onClick={() => item && onSelect(item)}
      disabled={!item}
      aria-label={item ? `${slotLabel(slot)}: ${item.name || `item ${item.itemId || ''}`}` : `${slotLabel(slot)} empty`}
    >
      {item ? <ItemIcon item={item} size={48} /> : <span className="paper-doll__empty-icon" aria-hidden="true">◇</span>}
      <span className="paper-doll__slot-copy">
        <small>{slotLabel(slot)}</small>
        <strong className={item ? `item-quality-${Number(item.quality) || 0}` : ''}>{item?.name || 'Empty'}</strong>
        {item?.itemLevel ? <em>Item Level {item.itemLevel}</em> : null}
      </span>
    </button>
  )

  return item ? <ItemHoverCard item={item} side={tooltipSide}>{button}</ItemHoverCard> : button
}

function GearSummary({ equipment, className, race }) {
  const itemLevels = equipment.map((item) => Number(item?.itemLevel)).filter((value) => Number.isFinite(value) && value > 0)
  const average = itemLevels.length ? Math.round(itemLevels.reduce((sum, value) => sum + value, 0) / itemLevels.length) : null
  const notable = equipment.filter((item) => Number(item?.quality) >= 3).length

  return (
    <div className="paper-doll__figure" data-class={classKey(className)}>
      <span className="paper-doll__crest" aria-hidden="true">♜</span>
      <strong>{className || 'Adventurer'}</strong>
      <span>{race || 'Character'}</span>
      <div className="paper-doll__gear-summary">
        <div><b>{equipment.length}</b><small>equipped</small></div>
        <div><b>{average ?? '—'}</b><small>avg ilvl</small></div>
        <div><b>{notable}</b><small>rare+</small></div>
      </div>
    </div>
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
  const orderedEquipment = useMemo(
    () => allSlots.map((slot) => bySlot.get(slot)).filter(Boolean),
    [bySlot],
  )
  const [active, setActive] = useState(orderedEquipment[0] || null)

  useEffect(() => {
    setActive(orderedEquipment[0] || null)
  }, [orderedEquipment])

  if (!equipment.length) {
    return <EmptyTelemetry title="No equipment snapshot yet.">The paper doll will populate when Guildweaver submits equipped item data.</EmptyTelemetry>
  }

  return (
    <div className="paper-doll">
      <div className="paper-doll__layout">
        <div className="paper-doll__column paper-doll__column--left">
          {leftSlots.map((slot) => <EquipmentSlot key={slot} slot={slot} item={bySlot.get(slot)} active={active === bySlot.get(slot)} onSelect={setActive} tooltipSide="right" />)}
        </div>
        <GearSummary equipment={equipment} className={className} race={race} />
        <div className="paper-doll__column paper-doll__column--right">
          {rightSlots.map((slot) => <EquipmentSlot key={slot} slot={slot} item={bySlot.get(slot)} active={active === bySlot.get(slot)} onSelect={setActive} tooltipSide="left" />)}
        </div>
        <div className="paper-doll__weapons">
          {weaponSlots.map((slot) => <EquipmentSlot key={slot} slot={slot} item={bySlot.get(slot)} active={active === bySlot.get(slot)} onSelect={setActive} tooltipSide="top" />)}
        </div>
      </div>
      <ItemDetailCard item={active} />
    </div>
  )
}
