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
      name: text(character?.name) || 'Unknown adventurer',
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

  return {
    character: {
      id: text(character.id),
      memberId: text(character.memberId),
      memberName: text(character.memberName),
      memberRank: text(character.memberRank),
      name: text(character.name) || 'Unknown adventurer',
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
    equipment: array(source.equipment).map((item) => ({ ...object(item) })),
    talents: {
      configId: talents.configId ?? null,
      treeId: talents.treeId ?? null,
      specId: talents.specId ?? null,
      name: text(talents.name),
      nodes: array(talents.nodes).map((node) => ({
        ...object(node),
        id: node?.id ?? 0,
        x: number(node?.x),
        y: number(node?.y),
        rank: number(node?.rank),
        maxRank: number(node?.maxRank),
        selected: Boolean(node?.selected),
        entries: array(node?.entries).map((entry) => ({ ...object(entry) })),
      })),
      edges: array(talents.edges).map((edge) => ({ ...object(edge) })),
    },
    professions: array(source.professions).map((profession) => ({ ...object(profession) })),
    recipes: array(source.recipes).map((recipe) => ({ ...object(recipe) })),
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
