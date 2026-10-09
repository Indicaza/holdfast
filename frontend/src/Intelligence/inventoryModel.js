// View model for the character modal's Inventory tab: joins each bag slot to
// its item description (the armory sends every distinct item once) and groups
// carried totals by item class for the combined view.

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function array(value) {
  return Array.isArray(value) ? value : []
}

function count(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function coins(copperValue) {
  const copper = count(copperValue)
  return {
    copper,
    gold: Math.floor(copper / 10000),
    silver: Math.floor((copper % 10000) / 100),
    copperRemainder: copper % 100,
  }
}

// Item classes in the order the combined view lists them: materials first,
// since that is what the inventory data is ultimately for.
const CLASS_ORDER = {
  7: 0, // Trade Goods
  5: 1, // Reagent
  0: 2, // Consumable
  12: 3, // Quest
  9: 4, // Recipe
  2: 5, // Weapon
  4: 6, // Armor
  1: 7, // Container
  11: 8, // Quiver
  6: 9, // Projectile
  13: 10, // Key
  15: 11, // Miscellaneous
}

function classOrder(itemClass) {
  const id = optionalNumber(itemClass?.id)
  return id !== null && id in CLASS_ORDER ? CLASS_ORDER[id] : 50
}

const CONTAINER_LABELS = {
  backpack: 'Backpack',
  reagent: 'Reagent Bag',
  keyring: 'Keyring',
}

export function containerLabel(container) {
  return container?.name || container?.item?.name || CONTAINER_LABELS[container?.kind] || `Bag ${container?.bagId ?? ''}`.trim()
}

export function normalizeInventory(value) {
  const source = object(value)
  const containers = array(source.containers)
  if (!containers.length) return null

  const items = new Map(array(source.items).map((item) => [item?.key, object(item)]))
  const telemetry = object(source.telemetry)

  const bags = containers.map((raw) => {
    const container = object(raw)
    const slotCount = count(container.slotCount)
    const bySlot = new Map()
    for (const stack of array(container.slots)) {
      const slot = count(stack?.slot)
      if (!slot || (slotCount && slot > slotCount) || bySlot.has(slot)) continue
      const item = items.get(stack.itemKey) || {}
      bySlot.set(slot, {
        ...item,
        // The game only shows item level on gear, not on materials or consumables.
        itemLevel: item.equipLocation ? item.itemLevel ?? null : null,
        itemId: item.itemId ?? stack.itemId ?? null,
        name: item.name || '',
        count: Math.max(1, count(stack.count)),
        isBound: stack.isBound === true,
        key: stack.itemKey,
      })
    }
    const size = Math.max(slotCount, ...bySlot.keys(), 0)
    return {
      bagId: container.bagId,
      kind: container.kind || 'bag',
      label: containerLabel(container),
      iconFileId: optionalNumber(container.iconFileDataId ?? container.item?.iconFileDataId),
      item: container.item || null,
      slotCount: size,
      freeSlots: container.freeSlots == null ? size - bySlot.size : count(container.freeSlots),
      usedSlots: bySlot.size,
      slots: Array.from({ length: size }, (_, index) => ({ slot: index + 1, item: bySlot.get(index + 1) || null })),
    }
  })

  return {
    money: coins(object(source.money).copper),
    slotCount: bags.reduce((sum, bag) => sum + bag.slotCount, 0),
    freeSlots: bags.reduce((sum, bag) => sum + bag.freeSlots, 0),
    usedSlots: bags.reduce((sum, bag) => sum + bag.usedSlots, 0),
    bags,
    capturedAt: telemetry.capturedAt || null,
    revision: optionalNumber(telemetry.revision),
  }
}

// Every carried item once, with its count across all bags, grouped by item
// class (materials first) and sorted by quality then name within a group.
export function inventoryGroups(inventory) {
  const byId = new Map()
  for (const bag of array(inventory?.bags)) {
    for (const { item } of bag.slots) {
      if (!item) continue
      const id = item.itemId ?? item.key
      const entry = byId.get(id)
      if (entry) {
        entry.count += item.count
        entry.stacks += 1
      } else {
        byId.set(id, { ...item, stacks: 1 })
      }
    }
  }

  const groups = new Map()
  for (const item of byId.values()) {
    const name = item.itemClass?.name || 'Other'
    const group = groups.get(name) || { name, order: classOrder(item.itemClass), items: [] }
    group.items.push(item)
    groups.set(name, group)
  }

  return [...groups.values()]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) =>
        (Number(b.qualityId) || 0) - (Number(a.qualityId) || 0) || String(a.name).localeCompare(String(b.name))),
    }))
}
