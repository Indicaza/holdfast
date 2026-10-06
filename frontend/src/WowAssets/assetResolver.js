function positiveInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function configuredTemplate() {
  const runtime = globalThis.__HOLDFAST_WOW_ASSET_TEMPLATE__
  const build = import.meta.env?.VITE_WOW_ICON_TEMPLATE
  return typeof runtime === 'string' && runtime ? runtime : typeof build === 'string' ? build : ''
}

export function resolveWowIconAsset({ iconFileId, itemId, spellId, recipeId, size = 64 } = {}) {
  const template = configuredTemplate()
  if (!template) return null

  const id = positiveInteger(iconFileId) || positiveInteger(itemId) || positiveInteger(spellId) || positiveInteger(recipeId)
  if (!id) return null

  const replacements = {
    '{id}': id,
    '{iconFileID}': positiveInteger(iconFileId) || id,
    '{itemID}': positiveInteger(itemId) || id,
    '{spellID}': positiveInteger(spellId) || id,
    '{recipeID}': positiveInteger(recipeId) || id,
    '{size}': positiveInteger(size) || 64,
  }

  let url = template
  for (const [token, value] of Object.entries(replacements)) {
    url = url.replaceAll(token, String(value))
  }

  try {
    const parsed = new URL(url, window?.location?.origin || 'https://holdfast.invalid')
    return parsed.protocol === 'https:' || parsed.origin === window?.location?.origin ? parsed.toString() : null
  } catch {
    return null
  }
}

export function wowAssetDescriptor(input = {}) {
  const iconFileId = positiveInteger(input.iconFileId ?? input.iconFileID)
  const itemId = positiveInteger(input.itemId ?? input.itemID)
  const spellId = positiveInteger(input.spellId ?? input.spellID)
  const recipeId = positiveInteger(input.recipeId ?? input.recipeID)

  return {
    iconFileId,
    itemId,
    spellId,
    recipeId,
    src: resolveWowIconAsset({ iconFileId, itemId, spellId, recipeId, size: input.size }),
  }
}
