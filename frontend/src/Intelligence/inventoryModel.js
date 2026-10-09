// View model for the character modal's Inventory tab, laid out like the
// game's bag windows: one Combined Backpack holding the backpack and every
// equipped bag, and the reagent bag (and a classic keyring holding keys) in
// windows of their own. The organized view folds those same slots into useful
// item-class groups without losing the physical bag layout.

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

export const QUALITY_NAMES = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact', 'Heirloom']

// Materials first: the organized view is primarily an at-a-glance crafting
// and economy surface, not merely another rendering of the bags.
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

// INVTYPE_* as the game's tooltips name them.
export const EQUIP_SLOT_NAMES = {
  INVTYPE_HEAD: 'Head',
  INVTYPE_NECK: 'Neck',
  INVTYPE_SHOULDER: 'Shoulder',
  INVTYPE_BODY: 'Shirt',
  INVTYPE_CHEST: 'Chest',
  INVTYPE_ROBE: 'Chest',
  INVTYPE_WAIST: 'Waist',
  INVTYPE_LEGS: 'Legs',
  INVTYPE_FEET: 'Feet',
  INVTYPE_WRIST: 'Wrist',
  INVTYPE_HAND: 'Hands',
  INVTYPE_FINGER: 'Finger',
  INVTYPE_TRINKET: 'Trinket',
  INVTYPE_CLOAK: 'Back',
  INVTYPE_WEAPON: 'One-Hand',
  INVTYPE_SHIELD: 'Off Hand',
  INVTYPE_2HWEAPON: 'Two-Hand',
  INVTYPE_WEAPONMAINHAND: 'Main Hand',
  INVTYPE_WEAPONOFFHAND: 'Off Hand',
  INVTYPE_HOLDABLE: 'Held In Off-hand',
  INVTYPE_RANGED: 'Ranged',
  INVTYPE_RANGEDRIGHT: 'Ranged',
  INVTYPE_THROWN: 'Thrown',
  INVTYPE_RELIC: 'Relic',
  INVTYPE_TABARD: 'Tabard',
  INVTYPE_BAG: 'Bag',
  INVTYPE_QUIVER: 'Quiver',
  INVTYPE_AMMO: 'Ammo',
}

const WINDOW_TITLES = {
  combined: 'Combined Backpack',
  reagent: 'Reagent Bag',
  keyring: 'Keyring',
}

function slotItem(item, stack) {
  const quantity = Math.max(1, count(stack.count))
  const unitSellPrice = stack.hasNoValue ? null : optionalNumber(item.sellPrice)
  return {
    ...item,
    itemId: item.itemId ?? stack.itemId ?? null,
    name: item.name || '',
    count: quantity,
    unitSellPrice,
    // Hovering a stack in the bags prices the whole stack.
    sellPrice: unitSellPrice ? unitSellPrice * quantity : null,
    isBound: stack.isBound === true,
    key: stack.itemKey,
  }
}

// Every slot of one container, empty ones included, in slot order.
function containerSlots(container, items) {
  const slotCount = count(container.slotCount)
  const bySlot = new Map()
  for (const stack of array(container.slots)) {
    const slot = count(stack?.slot)
    if (!slot || (slotCount && slot > slotCount) || bySlot.has(slot)) continue
    bySlot.set(slot, slotItem(items.get(stack.itemKey) || {}, stack))
  }
  const size = Math.max(slotCount, ...bySlot.keys(), 0)
  return Array.from({ length: size }, (_, index) => ({
    id: `${container.bagId}:${index + 1}`,
    bagId: container.bagId,
    slot: index + 1,
    item: bySlot.get(index + 1) || null,
  }))
}

function bagWindow(kind, containers, items) {
  const first = containers[0] || {}
  return {
    kind,
    id: kind === 'combined' ? 'combined' : `${kind}:${first.bagId}`,
    title: kind === 'combined' ? WINDOW_TITLES.combined : first.name || first.item?.name || WINDOW_TITLES[kind],
    iconFileId: optionalNumber(first.iconFileDataId ?? first.item?.iconFileDataId),
    slots: containers.flatMap((container) => containerSlots(container, items)),
  }
}

export function normalizeInventory(value) {
  const source = object(value)
  const containers = array(source.containers).map(object).filter((container) => count(container.slotCount) > 0)
  if (!containers.length) return null

  const items = new Map(array(source.items).map((item) => [item?.key, object(item)]))
  const kind = (container) => container.kind || (container.bagId === 0 ? 'backpack' : 'bag')

  // The combined window stacks the bags from the last one down to the
  // backpack, which sits at the bottom.
  const carried = containers
    .filter((container) => kind(container) === 'backpack' || kind(container) === 'bag')
    .sort((a, b) => (kind(a) === 'backpack') - (kind(b) === 'backpack') || Number(b.bagId) - Number(a.bagId))
  const backpack = carried.find((container) => kind(container) === 'backpack')
  const combined = bagWindow('combined', carried, items)
  combined.iconFileId = optionalNumber(backpack?.iconFileDataId) ?? combined.iconFileId

  const windows = [
    ...containers.filter((container) => kind(container) === 'reagent').map((container) => bagWindow('reagent', [container], items)),
    // A keyring is only worth a window when it holds keys.
    ...containers
      .filter((container) => kind(container) === 'keyring' && array(container.slots).length > 0)
      .map((container) => bagWindow('keyring', [container], items)),
  ]
  if (combined.slots.length) windows.push(combined)

  const space = windows.filter((window) => window.kind !== 'keyring').flatMap((window) => window.slots)
  const used = space.filter((slot) => slot.item).length
  const telemetry = object(source.telemetry)
  return {
    money: coins(object(source.money).copper),
    slotCount: space.length,
    usedSlots: used,
    freeSlots: space.length - used,
    windows,
    capturedAt: telemetry.capturedAt || null,
    revision: optionalNumber(telemetry.revision),
  }
}

// Every carried item once, aggregated across stacks and grouped by the game's
// item class. Quality sorting makes valuable/interesting items visually rise
// inside each group while material classes stay at the top of the page.
export function inventoryGroups(inventory, query = '') {
  const terms = searchTerms(query)
  const byItem = new Map()

  for (const window of array(inventory?.windows)) {
    for (const entry of array(window.slots)) {
      const item = entry?.item
      if (!item) continue
      const key = item.itemId ?? item.key ?? entry.id
      const existing = byItem.get(key)
      if (existing) {
        existing.count += Math.max(1, count(item.count))
        existing.stacks += 1
        existing.sellPrice = existing.unitSellPrice ? existing.unitSellPrice * existing.count : null
      } else {
        const quantity = Math.max(1, count(item.count))
        byItem.set(key, {
          ...item,
          count: quantity,
          stacks: 1,
          sellPrice: item.unitSellPrice ? item.unitSellPrice * quantity : item.sellPrice,
        })
      }
    }
  }

  const groups = new Map()
  for (const item of byItem.values()) {
    if (terms.length && !matchesSearch(itemSearchText(item), terms)) continue
    const name = item.itemClass?.name || 'Other'
    const group = groups.get(name) || { name, order: classOrder(item.itemClass), items: [] }
    group.items.push(item)
    groups.set(name, group)
  }

  return [...groups.values()]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((group) => ({
      ...group,
      count: group.items.reduce((sum, item) => sum + item.count, 0),
      items: group.items.sort((a, b) =>
        (Number(b.qualityId) || 0) - (Number(a.qualityId) || 0) || String(a.name).localeCompare(String(b.name))),
    }))
}

// Leading empty cells that push a short first row against the right edge,
// as the game lays out its bag windows.
export function leadingGap(slotCount, columns) {
  const remainder = slotCount % columns
  return remainder ? columns - remainder : 0
}

// Everything the bag search looks at: the name, item class and subclass, the
// equip slot, quality, every tooltip line, the use effect, binding, reagent
// status and the item id.
export function itemSearchText(item) {
  if (!item) return ''
  const tooltip = array(item.tooltip?.lines).flatMap((line) => [line?.left, line?.right])
  return [
    item.name,
    item.itemClass?.name,
    item.itemSubclass?.name,
    EQUIP_SLOT_NAMES[item.equipLocation],
    QUALITY_NAMES[Number(item.qualityId)],
    item.spell?.name,
    item.isBound ? 'soulbound bound' : '',
    item.isCraftingReagent ? 'crafting reagent material' : '',
    item.itemId,
    ...tooltip,
  ]
    .filter((part) => part !== null && part !== undefined && part !== '')
    .join(' ')
    .toLowerCase()
}

export function searchTerms(query) {
  return String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
}

export function matchesSearch(searchText, terms) {
  return terms.every((term) => searchText.includes(term))
}
