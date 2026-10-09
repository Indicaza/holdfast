// Pure helpers for the Professions pane, kept apart from the JSX so they can
// be tested. Layout and strings follow WoW Forever's Professions window
// (Gethe/wow-ui-source, branch forever, Blizzard_Professions*/Camelot).

// Skill lines by role in the overview (GetProfessions order: two primary
// slots, then Cooking, Fishing, First Aid).
export const SECONDARY_SLOTS = [
  { skillLineId: 185, name: 'Cooking', missing: 'Visit a trainer to learn cooking. Cooking lets you learn recipes to create food that heals you out of combat and grants you temporary buffs.' },
  { skillLineId: 356, name: 'Fishing', missing: 'Visit a trainer to learn fishing.  Fishing lets you catch fish and other strange things from water.  Fish can be cooked into delicious meals with the Cooking skill.' },
  { skillLineId: 129, name: 'First Aid', missing: 'Visit a trainer to learn first aid.  First aid lets you turn cloth into bandages for healing yourself and others.' },
]
export const PRIMARY_SLOT_NAMES = ['First Profession', 'Second Profession']
export const MISSING_PRIMARY_TEXT = 'Visit a profession trainer in a major city to learn a new profession. You may have two professions. You may have any combination of gathering and production professions.'

const SECONDARY_SKILL_LINES = new Set([...SECONDARY_SLOTS.map((slot) => slot.skillLineId), 794])
// Older snapshots label every non-primary profession "secondary", so that
// generic kind is not trusted.
const SECONDARY_KINDS = new Set(['cooking', 'fishing', 'first_aid', 'archaeology'])
// Gathering skills with no crafting window get no side tab in game
// (C_TradeSkillUI.CanTradeSkillShowCraftingUI is false for them).
const NO_CRAFTING_UI = new Set([182, 393, 356])

const RANKS = [
  [75, 'Apprentice'],
  [150, 'Journeyman'],
  [225, 'Expert'],
  [300, 'Artisan'],
]

const DIFFICULTY_ORDER = { optimal: 0, medium: 1, easy: 2, trivial: 3 }

export function skillLineOf(profession) {
  return Number(profession?.skillLineId ?? profession?.id) || null
}

export function professionKey(profession) {
  return profession?.key || `name:${String(profession?.name || '').toLowerCase()}`
}

export function isSecondary(profession) {
  return SECONDARY_SKILL_LINES.has(skillLineOf(profession))
    || SECONDARY_KINDS.has(String(profession?.kind || '').toLowerCase())
}

export function rankTitle(maxSkill) {
  const max = Number(maxSkill) || 0
  if (!max) return ''
  return (RANKS.find(([cap]) => max <= cap) || [0, 'Master'])[1]
}

// TRADESKILL_RANK ("%d/%d") and TRADESKILL_RANK_WITH_MODIFIER ("%d + %d/%d").
export function rankText(profession) {
  const current = Number(profession?.current) || 0
  const max = Number(profession?.max) || 0
  const modifier = Number(profession?.modifier) || 0
  return { current, modifier, max }
}

export function recipesFor(profession, recipes) {
  const key = professionKey(profession)
  const name = String(profession?.name || '').toLowerCase()
  return (Array.isArray(recipes) ? recipes : []).filter((recipe) =>
    recipe.professionKey === key
    || (!recipe.professionKey && String(recipe.professionName || '').toLowerCase() === name),
  )
}

// The book page: up to two primary cards (placeholders when a slot is empty)
// and the three secondary cards in game order, missing ones included.
export function overviewSlots(professions) {
  const list = Array.isArray(professions) ? professions : []
  const primary = list.filter((profession) => !isSecondary(profession)).slice(0, 2)
  return {
    primary: PRIMARY_SLOT_NAMES.map((placeholder, index) => ({ placeholder, profession: primary[index] || null })),
    secondary: SECONDARY_SLOTS.map((slot) => ({
      ...slot,
      profession: list.find((profession) => skillLineOf(profession) === slot.skillLineId
        || String(profession?.name || '').toLowerCase() === slot.name.toLowerCase()) || null,
    })),
  }
}

// Side tabs in GetProfessions order, skipping professions with no crafting
// window unless a recipe book was captured for them anyway.
export function railProfessions(professions, recipes) {
  const list = (Array.isArray(professions) ? professions : []).map((profession) => ({ ...profession, key: professionKey(profession) }))
  const ordered = [
    ...list.filter((profession) => !isSecondary(profession)),
    ...SECONDARY_SLOTS.flatMap((slot) => list.filter((profession) => isSecondary(profession) && skillLineOf(profession) === slot.skillLineId)),
    ...list.filter((profession) => isSecondary(profession) && !SECONDARY_SLOTS.some((slot) => slot.skillLineId === skillLineOf(profession))),
  ]
  return ordered.filter((profession) => !NO_CRAFTING_UI.has(skillLineOf(profession)) || recipesFor(profession, recipes).length)
}

export function recipeKey(recipe) {
  return String(recipe?.key || recipe?.id || recipe?.name || '')
}

function matches(recipe, needle) {
  if (!needle) return true
  return [recipe.name, recipe.crafted?.name, recipe.craftedItemName, ...(recipe.reagents || []).map((reagent) => reagent.name)]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle))
}

// Learned and Unlearned groups (PROFESSIONS_CATEGORY_LEARNED/UNLEARNED), each
// sorted the way the old trade skill window did: hardest first, then by name.
export function recipeGroups(recipes, query = '') {
  const needle = String(query || '').trim().toLowerCase()
  const sorted = (Array.isArray(recipes) ? recipes : [])
    .filter((recipe) => matches(recipe, needle))
    .sort((left, right) =>
      (DIFFICULTY_ORDER[left.difficulty] ?? 4) - (DIFFICULTY_ORDER[right.difficulty] ?? 4)
      || String(left.name).localeCompare(String(right.name)))
  return [
    { id: 'learned', label: 'Learned', recipes: sorted.filter((recipe) => recipe.known !== false) },
    { id: 'unlearned', label: 'Unlearned', recipes: sorted.filter((recipe) => recipe.known === false) },
  ].filter((group) => group.recipes.length)
}

// SecondsToTime-style remaining time: "1 Day 4 Hr", "3 Hr 20 Min", "12 Min".
export function cooldownRemaining(readyAt, now = Date.now()) {
  const seconds = Math.ceil(Number(readyAt) - now / 1000)
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days) return hours ? `${days} Day ${hours} Hr` : `${days} Day`
  if (hours) return minutes ? `${hours} Hr ${minutes} Min` : `${hours} Hr`
  return `${Math.max(1, Math.ceil(seconds / 60))} Min`
}

function hasTooltip(item) {
  return Array.isArray(item?.tooltip?.lines) && item.tooltip.lines.length > 0
}

function iconOf(item) {
  return item?.iconFileDataId ?? item?.iconFileId ?? null
}

// What the character's recipe books know about each item, by item ID: crafted
// items and reagents, keeping the most complete description. Reagents arrive
// without tooltips, and without a name or icon when the game had not cached the
// item yet, so they borrow from any other mention of the same item (a bar the
// character smelts, a reagent named in another recipe).
export function itemTooltipIndex(recipes) {
  const index = new Map()
  const note = (item) => {
    const itemId = Number(item?.itemId)
    if (!itemId) return
    const known = index.get(itemId) || {}
    index.set(itemId, {
      name: known.name || item.name || '',
      iconFileDataId: known.iconFileDataId ?? iconOf(item),
      qualityId: known.qualityId ?? item.qualityId ?? null,
      itemLevel: known.itemLevel ?? item.itemLevel ?? null,
      requiredLevel: known.requiredLevel ?? item.requiredLevel ?? null,
      tooltip: hasTooltip(known) ? known.tooltip : hasTooltip(item) ? item.tooltip : null,
    })
  }
  for (const recipe of Array.isArray(recipes) ? recipes : []) {
    note(recipe?.crafted)
    for (const reagent of Array.isArray(recipe?.reagents) ? recipe.reagents : []) note(reagent)
  }
  return index
}

export function withItemTooltip(item, index) {
  const known = item && index?.get(Number(item.itemId))
  if (!known) return item
  return {
    ...item,
    name: item.name || known.name,
    iconFileDataId: iconOf(item) ?? known.iconFileDataId,
    iconFileId: iconOf(item) ?? known.iconFileDataId,
    qualityId: item.qualityId ?? known.qualityId,
    itemLevel: item.itemLevel ?? known.itemLevel,
    requiredLevel: item.requiredLevel ?? known.requiredLevel,
    tooltip: hasTooltip(item) ? item.tooltip : known.tooltip,
  }
}
