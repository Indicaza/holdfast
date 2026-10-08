function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function array(value) {
  return Array.isArray(value) ? value : []
}

function text(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeGameData(payload) {
  const source = object(payload)
  return {
    gameBuild: text(source.gameBuild),
    locale: text(source.locale),
    items: object(source.items),
    spells: object(source.spells),
    recipes: object(source.recipes),
    professions: object(source.professions),
    talents: object(source.talents),
    missing: array(source.missing).map((entry) => ({ ...object(entry) })),
    provider: object(source.provider),
  }
}

function catalogEntry(gameData, bucket, id) {
  if (id === null || id === undefined || id === '') return null
  const source = object(gameData?.[bucket])
  return source[String(id)] || null
}

function enrichItem(item, gameData) {
  const source = object(item)
  const catalog = catalogEntry(gameData, 'items', source.itemId ?? source.itemID)
  const metadata = object(catalog?.metadata)
  return {
    ...metadata,
    ...source,
    name: text(source.name) || text(catalog?.name),
    iconFileId: optionalNumber(source.iconFileId ?? source.iconFileID ?? catalog?.iconFileId),
    quality: optionalNumber(source.quality ?? source.qualityId ?? catalog?.qualityId),
    catalog: catalog || null,
  }
}

function enrichProfession(profession, gameData) {
  const source = object(profession)
  const catalog = catalogEntry(gameData, 'professions', source.id ?? source.professionId)
  return {
    ...object(catalog?.metadata),
    ...source,
    name: text(source.name) || text(catalog?.name) || 'Profession',
    iconFileId: optionalNumber(source.iconFileId ?? source.iconFileID ?? catalog?.iconFileId),
    catalog: catalog || null,
  }
}

function enrichRecipe(recipe, gameData) {
  const source = object(recipe)
  const catalog = catalogEntry(gameData, 'recipes', source.id ?? source.recipeId)
  return {
    ...object(catalog?.metadata),
    ...source,
    name: text(source.name) || text(catalog?.name) || 'Unknown recipe',
    iconFileId: optionalNumber(source.iconFileId ?? source.iconFileID ?? catalog?.iconFileId),
    reagents: array(source.reagents).map((reagent) => {
      const raw = object(reagent)
      const item = catalogEntry(gameData, 'items', raw.itemId ?? raw.itemID)
      return {
        ...raw,
        name: text(raw.name) || text(item?.name),
        iconFileId: optionalNumber(raw.iconFileId ?? raw.iconFileID ?? item?.iconFileId),
        catalog: item || null,
      }
    }),
    catalog: catalog || null,
  }
}

function enrichTalentEntry(entry, gameData) {
  const source = object(entry)
  const catalog = catalogEntry(gameData, 'spells', source.spellId ?? source.spellID)
  return {
    ...object(catalog?.metadata),
    ...source,
    name: text(source.name) || text(catalog?.name),
    description: text(source.description) || text(catalog?.metadata?.description),
    iconFileId: optionalNumber(source.iconFileId ?? source.iconFileID ?? catalog?.iconFileId),
    catalog: catalog || null,
  }
}

function normalizeTreeDefinition(value) {
  const source = object(value)
  return {
    ...source,
    treeId: optionalNumber(source.treeId),
    treeHash: text(source.treeHash),
    locale: text(source.locale),
    name: text(source.name),
    iconFileDataId: optionalNumber(source.iconFileDataId ?? source.iconFileID),
    metadata: object(source.metadata),
    art: object(source.art),
  }
}

function normalizeTalentArt(talents) {
  const direct = object(talents?.art)
  const directTabs = array(direct.talentTabs).filter(Boolean)
  if (directTabs.length) return { ...direct, talentTabs: directTabs }

  for (const definition of array(talents?.treeDefinitions)) {
    const definitionArt = object(definition?.art)
    const definitionTabs = array(definitionArt.talentTabs).filter(Boolean)
    if (!definitionTabs.length) continue

    return {
      ...definitionArt,
      ...direct,
      specialization: Object.keys(object(direct.specialization)).length ? direct.specialization : definitionArt.specialization,
      trees: Object.keys(object(direct.trees)).length ? direct.trees : definitionArt.trees,
      talentTabs: definitionTabs,
    }
  }

  return direct
}

export function canonicalEquipmentSlot(value) {
  const original = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const hadSlotSuffix = original.endsWith('SLOT')
  const normalized = original.replace(/SLOT$/, '')

  if (!hadSlotSuffix) return normalized

  const aliases = {
    FINGER0: 'FINGER1',
    FINGER1: 'FINGER2',
    TRINKET0: 'TRINKET1',
    TRINKET1: 'TRINKET2',
    SECONDARYHAND: 'OFFHAND',
  }

  return aliases[normalized] || normalized
}

export function normalizeIntelligence(payload) {
  const source = object(payload)
  const summary = object(source.summary)

  return {
    summary: {
      characterCount: number(summary.characterCount),
      professionCount: number(summary.professionCount),
      recipeCount: number(summary.recipeCount),
    },
    characters: array(source.characters).map((character) => ({
      ...object(character),
      id: text(character?.id),
      name: text(character?.fullName) || text(character?.name) || 'Unknown adventurer',
      firstName: text(character?.firstName),
      lastName: text(character?.lastName),
      fullName: text(character?.fullName) || text(character?.name),
      className: text(character?.className),
      spec: text(character?.spec),
      race: text(character?.race),
      realm: text(character?.realm),
      guildName: text(character?.guildName),
      organizationName: text(character?.organizationName),
      level: number(character?.level),
      lastSeenAt: character?.lastSeenAt || null,
    })),
    professions: array(source.professions).map((profession) => ({
      name: text(profession?.name) || 'Profession',
      characters: number(profession?.characters),
    })),
    classDistribution: array(source.classDistribution).map((entry) => ({
      name: text(entry?.name) || 'Unknown',
      count: number(entry?.count),
    })),
    specDistribution: array(source.specDistribution).map((entry) => ({
      name: text(entry?.name) || 'Unknown',
      count: number(entry?.count),
    })),
  }
}

export function normalizeArmory(payload) {
  const source = object(payload)
  const character = object(source.character)
  const talents = object(source.talents)
  const gameData = normalizeGameData(source.gameData)
  const firstName = text(character.firstName)
  const lastName = text(character.lastName)
  const fullName = text(character.fullName) || text(character.name) || [firstName, lastName].filter(Boolean).join(' ')

  return {
    character: {
      id: text(character.id),
      memberId: text(character.memberId),
      memberName: text(character.memberName),
      memberRank: text(character.memberRank),
      name: fullName || 'Unknown adventurer',
      firstName,
      lastName,
      fullName,
      race: text(character.race),
      className: text(character.className),
      spec: text(character.spec),
      level: number(character.level),
      realm: text(character.realm),
      region: text(character.region),
      guildName: text(character.guildName),
      organization: character.organization && typeof character.organization === 'object' ? character.organization : null,
      lastSeenAt: character.lastSeenAt || source.capturedAt || null,
      gameBuild: text(character.gameBuild),
      schemaVersion: number(character.schemaVersion),
      isMain: Boolean(character.isMain),
    },
    stats: object(source.stats),
    equipment: array(source.equipment).map((item) => enrichItem(item, gameData)),
    talents: {
      configId: talents.configId ?? null,
      treeId: talents.treeId ?? null,
      treeIds: array(talents.treeIds),
      treeHashes: array(talents.treeHashes).map((entry) => ({ ...object(entry) })),
      treeDefinitions: array(talents.treeDefinitions).map(normalizeTreeDefinition),
      art: normalizeTalentArt(talents),
      specId: talents.specId ?? null,
      name: text(talents.name),
      pointsSpent: talents.pointsSpent == null ? null : number(talents.pointsSpent),
      pointsAvailable: talents.pointsAvailable == null ? null : number(talents.pointsAvailable),
      nodes: array(talents.nodes).map((node) => ({
        ...object(node),
        id: node?.id ?? 0,
        x: number(node?.x),
        y: number(node?.y),
        rank: number(node?.rank),
        maxRank: number(node?.maxRank),
        selected: Boolean(node?.selected),
        entries: array(node?.entries).map((entry) => enrichTalentEntry(entry, gameData)),
      })),
      edges: array(talents.edges).map((edge) => ({ ...object(edge) })),
    },
    professions: array(source.professions).map((profession) => enrichProfession(profession, gameData)),
    recipes: array(source.recipes).map((recipe) => enrichRecipe(recipe, gameData)),
    gameData,
    capturedAt: source.capturedAt || character.lastSeenAt || null,
  }
}

export function formatSyncAge(value) {
  if (!value) return 'Not synced yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Sync time unavailable'

  const delta = Date.now() - date.getTime()
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (delta < minute) return 'Synced just now'
  if (delta < hour) return `Synced ${Math.max(1, Math.floor(delta / minute))}m ago`
  if (delta < day) return `Synced ${Math.floor(delta / hour)}h ago`
  if (delta < 7 * day) return `Synced ${Math.floor(delta / day)}d ago`

  return `Synced ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)}`
}
