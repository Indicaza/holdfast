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

// Bags are drawn four slots to a row. A size that is not a multiple of four
// puts the remainder in the first row, right-aligned, as the game does; slot
// numbers run left to right, top to bottom.
export function bagRows(slots) {
  const lead = slots.length % 4
  const rows = []
  if (lead) rows.push({ lead: true, cells: slots.slice(0, lead) })
  for (let index = lead; index < slots.length; index += 4) rows.push({ lead: false, cells: slots.slice(index, index + 4) })
  return rows
}

// The art a bag frame is drawn with: the backpack's own frame (portrait and
// money bar) for a standard 16-slot backpack, otherwise a bag whose top row is
// either full or the two-slot partial row.
export function bagFrame(bag) {
  if (bag.kind === 'backpack' && bag.slotCount === 16) return 'backpack'
  return bag.slotCount % 4 === 2 ? 'partial' : 'full'
}

function stackItem(item, stack) {
  const quantity = Math.max(1, count(stack.count))
  const unitSellPrice = stack.hasNoValue ? null : optionalNumber(item.sellPrice)
  return {
    ...item,
    // The game only shows item level on gear, not on materials or consumables.
    itemLevel: item.equipLocation ? item.itemLevel ?? null : null,
    itemId: item.itemId ?? stack.itemId ?? null,
    name: item.name || '',
    count: quantity,
    unitSellPrice,
    // Bag tooltips price the whole stack.
    sellPrice: unitSellPrice ? unitSellPrice * quantity : null,
    isBound: stack.isBound === true,
    key: stack.itemKey,
  }
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
      bySlot.set(slot, stackItem(items.get(stack.itemKey) || {}, stack))
    }
    const size = Math.max(slotCount, ...bySlot.keys(), 0)
    const slots = Array.from({ length: size }, (_, index) => ({ slot: index + 1, item: bySlot.get(index + 1) || null }))
    const bag = {
      bagId: container.bagId,
      kind: container.kind || 'bag',
      label: containerLabel(container),
      iconFileId: optionalNumber(container.iconFileDataId ?? container.item?.iconFileDataId),
      item: container.item || null,
      slotCount: size,
      freeSlots: container.freeSlots == null ? size - bySlot.size : count(container.freeSlots),
      usedSlots: bySlot.size,
      slots,
      rows: bagRows(slots),
    }
    return { ...bag, frame: bagFrame(bag) }
  })
    // An empty keyring is not worth a frame; one holding keys is.
    .filter((bag) => bag.slotCount > 0 && (bag.kind !== 'keyring' || bag.usedSlots > 0))

  // As in game, the keyring does not count toward bag space.
  const space = bags.filter((bag) => bag.kind !== 'keyring')
  return {
    money: coins(object(source.money).copper),
    slotCount: space.reduce((sum, bag) => sum + bag.slotCount, 0),
    freeSlots: space.reduce((sum, bag) => sum + bag.freeSlots, 0),
    usedSlots: space.reduce((sum, bag) => sum + bag.usedSlots, 0),
    bags,
    capturedAt: telemetry.capturedAt || null,
    revision: optionalNumber(telemetry.revision),
  }
}

// Every carried item once, with its count and value across all bags.
export function carriedItems(inventory) {
  const byId = new Map()
  for (const bag of array(inventory?.bags)) {
    for (const { item } of bag.slots) {
      if (!item) continue
      const id = item.itemId ?? item.key
      const entry = byId.get(id)
      if (entry) {
        entry.count += item.count
        entry.stacks += 1
        // Priced per stack: a stack the vendor will not buy adds nothing.
        if (item.sellPrice) entry.sellPrice = (entry.sellPrice || 0) + item.sellPrice
        entry.unitSellPrice ??= item.unitSellPrice
      } else {
        byId.set(id, { ...item, stacks: 1 })
      }
    }
  }
  return [...byId.values()]
}

// Carried items grouped by item class (materials first), sorted by quality
// then name within a group.
export function inventoryGroups(inventory) {
  const groups = new Map()
  for (const item of carriedItems(inventory)) {
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

function isMaterial(item) {
  return Number(item.itemClass?.id) === 7 || item.isCraftingReagent === true
}

// The side panel's figures: what the bags are worth to a vendor, how many
// distinct items they hold, and the most-carried materials.
export function inventorySummary(inventory, materialLimit = 6) {
  const items = carriedItems(inventory)
  return {
    vendorValue: coins(items.reduce((sum, item) => sum + (item.sellPrice || 0), 0)),
    distinctItems: items.length,
    stacks: items.reduce((sum, item) => sum + item.stacks, 0),
    materials: items
      .filter(isMaterial)
      .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)))
      .slice(0, materialLimit),
    materialKinds: items.filter(isMaterial).length,
  }
}
