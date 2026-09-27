const PRIORITIES = new Set(['Main', 'High', 'Medium', 'Low'])
const MODES = new Set(['rotating', 'permanent'])
const PUBLICATIONS = new Set(['draft', 'published'])

export class QuestImportError extends Error {
  constructor(message) {
    super(message)
    this.name = 'QuestImportError'
  }
}

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new QuestImportError(`${path} must be an object.`)
  }

  return value
}

function list(value, path, max) {
  if (value === undefined || value === null) return []

  if (!Array.isArray(value)) {
    throw new QuestImportError(`${path} must be an array.`)
  }

  if (value.length > max) {
    throw new QuestImportError(`${path} can contain at most ${max} entries.`)
  }

  return value
}

function text(value, path, { required = false, max = 5000 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new QuestImportError(`${path} is required.`)
    }

    return ''
  }

  if (typeof value !== 'string') {
    throw new QuestImportError(`${path} must be text.`)
  }

  const normalized = value.trim()

  if (required && !normalized) {
    throw new QuestImportError(`${path} is required.`)
  }

  if (normalized.length > max) {
    throw new QuestImportError(`${path} is too long.`)
  }

  return normalized
}

function wholeNumber(value, path) {
  const number = Number(value ?? 0)

  if (!Number.isInteger(number) || number < 0 || number > 1000000) {
    throw new QuestImportError(
      `${path} must be a whole number between 0 and 1000000.`,
    )
  }

  return number
}

function currency(value, path, range) {
  const amount = wholeNumber(value, path)

  if (
    amount !== 0 &&
    (amount < Number(range?.min ?? 0) || amount > Number(range?.max ?? 1000))
  ) {
    throw new QuestImportError(
      `${path} must be 0 or between ${range.min} and ${range.max}.`,
    )
  }

  return amount
}

function rewardItem(value, path) {
  const item = object(value, path)
  const quantity = wholeNumber(item.quantity ?? 1, `${path}.quantity`)

  if (quantity < 1) {
    throw new QuestImportError(`${path}.quantity must be at least 1.`)
  }

  return {
    id: createId('reward-item'),
    name: text(item.name, `${path}.name`, { required: true, max: 160 }),
    quantity,
  }
}

function reward(value, path, limits) {
  const input = value === undefined ? {} : object(value, path)

  return {
    rep: currency(input.rep ?? 0, `${path}.rep`, limits.rep),
    marks: currency(input.marks ?? 0, `${path}.marks`, limits.marks),
    items: list(input.items, `${path}.items`, 12).map((item, index) =>
      rewardItem(item, `${path}.items[${index}]`),
    ),
  }
}

function priority(value, path) {
  const normalized = text(value || 'Medium', path, { required: true, max: 20 })
  const matched = [...PRIORITIES].find(
    (candidate) => candidate.toLowerCase() === normalized.toLowerCase(),
  )

  if (!matched) {
    throw new QuestImportError(
      `${path} must be Main, High, Medium, or Low.`,
    )
  }

  return matched
}

function objective(value, path, limits) {
  const input = object(value, path)

  return {
    id: createId('objective'),
    title: text(input.title, `${path}.title`, { required: true, max: 160 }),
    description: text(input.description, `${path}.description`, { max: 1500 }),
    priority: priority(input.priority, `${path}.priority`),
    completed: false,
    need: text(input.need, `${path}.need`, { max: 500 }),
    reward: reward(input.reward, `${path}.reward`, limits),
    // Imported quests never assign guild members. Assignments are a human step.
    assignments: [],
  }
}

function publication(value, path) {
  const normalized = text(value || 'draft', path, { required: true, max: 20 }).toLowerCase()

  if (!PUBLICATIONS.has(normalized)) {
    throw new QuestImportError(`${path} must be draft or published.`)
  }

  return normalized
}

function mode(value, path) {
  const normalized = text(value || 'rotating', path, { required: true, max: 20 }).toLowerCase()

  if (!MODES.has(normalized)) {
    throw new QuestImportError(`${path} must be rotating or permanent.`)
  }

  return normalized
}

function sourceQuests(payload) {
  if (Array.isArray(payload)) {
    return {
      quests: payload,
      focusedQuestId: '',
    }
  }

  const input = object(payload, 'JSON')

  if (Array.isArray(input.quests)) {
    return {
      quests: input.quests,
      focusedQuestId:
        typeof input.focusedQuestId === 'string' ? input.focusedQuestId : '',
    }
  }

  if ('title' in input) {
    return {
      quests: [input],
      focusedQuestId: '',
    }
  }

  throw new QuestImportError(
    'JSON must be one quest object, an array of quests, or an object with a quests array.',
  )
}

function normalizedQuest(value, path, limits) {
  const input = object(value, path)

  return {
    sourceId: typeof input.id === 'string' ? input.id : '',
    featured: input.featured === true,
    quest: {
      id: createId('quest'),
      publication: publication(input.publication, `${path}.publication`),
      mode: mode(input.mode, `${path}.mode`),
      title: text(input.title, `${path}.title`, { required: true, max: 200 }),
      summary: text(input.summary, `${path}.summary`, { max: 2000 }),
      objectives: list(input.objectives, `${path}.objectives`, 50).map(
        (item, index) =>
          objective(item, `${path}.objectives[${index}]`, limits),
      ),
      completed: false,
    },
  }
}

export function importQuestJson(raw, currentDocument) {
  if (!String(raw || '').trim()) {
    throw new QuestImportError('Paste quest JSON or choose a JSON file first.')
  }

  let parsed

  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new QuestImportError(`That is not valid JSON: ${error.message}`)
  }

  const source = sourceQuests(parsed)

  if (!source.quests.length) {
    throw new QuestImportError('The JSON does not contain any quests.')
  }

  if (currentDocument.quests.length + source.quests.length > 60) {
    throw new QuestImportError('Import would exceed the 60 quest workspace limit.')
  }

  const imported = source.quests.map((item, index) =>
    normalizedQuest(
      item,
      `quests[${index}]`,
      currentDocument.rewardLimits,
    ),
  )

  const featuredIndexes = new Set()

  imported.forEach((item, index) => {
    if (item.featured) {
      featuredIndexes.add(index)
    }

    if (source.focusedQuestId && item.sourceId === source.focusedQuestId) {
      featuredIndexes.add(index)
    }
  })

  if (featuredIndexes.size > 1) {
    throw new QuestImportError(
      'Only one imported quest can be featured on the home page.',
    )
  }

  const featuredIndex = [...featuredIndexes][0]
  const quests = imported.map((item, index) => ({
    ...item.quest,
    publication:
      index === featuredIndex ? 'published' : item.quest.publication,
  }))
  const featuredQuest =
    featuredIndex === undefined ? null : quests[featuredIndex]

  return {
    document: {
      ...currentDocument,
      focusedQuestId: featuredQuest?.id || currentDocument.focusedQuestId,
      quests: [...currentDocument.quests, ...quests],
    },
    importedCount: quests.length,
    featuredTitle: featuredQuest?.title || '',
  }
}

export function buildQuestImportPrompt(rewardLimits) {
  const exampleRep =
    rewardLimits.rep.min > 0
      ? rewardLimits.rep.min
      : Math.min(100, rewardLimits.rep.max)

  const example = {
    quests: [
      {
        title: 'Stock the War Chest',
        summary: 'Build a reserve of useful materials for launch week.',
        publication: 'published',
        mode: 'rotating',
        featured: true,
        objectives: [
          {
            title: 'Gather copper ore',
            description: 'Bring copper ore to the guild bank.',
            priority: 'High',
            need: 'Copper Ore',
            reward: {
              rep: exampleRep,
              marks: 0,
              items: [],
            },
          },
        ],
      },
    ],
  }

  return `Create Holdfast GuildOS quest JSON from my instructions.

Return ONLY valid JSON. Do not use markdown fences, commentary, or prose outside the JSON.

Use this shape:
${JSON.stringify(example, null, 2)}

Rules:
- Top level should be { "quests": [...] }. One quest object by itself or an array also works.
- Quest publication: "draft" or "published".
- Quest mode: "rotating" or "permanent".
- Set "featured": true on at most ONE quest if it should be published and featured on the Holdfast home page.
- Objective priority must be "Main", "High", "Medium", or "Low".
- Rep rewards must be 0 or between ${rewardLimits.rep.min} and ${rewardLimits.rep.max}.
- Marks rewards must be 0 or between ${rewardLimits.marks.min} and ${rewardLimits.marks.max}.
- Item rewards use { "name": "...", "quantity": 1 }.
- DO NOT assign guild members. Omit assignments entirely or use "assignments": [].
- Do not invent member IDs, Discord IDs, names, avatars, or responsibilities.
- Do not mark objectives complete. Imported objectives always begin incomplete.
- IDs are optional; GuildOS generates fresh IDs during import.
- Keep quest/objective copy concise and useful in the Holdfast tone.

Now create the JSON for this request:
[DESCRIBE THE QUEST OR QUESTS HERE]`
}
