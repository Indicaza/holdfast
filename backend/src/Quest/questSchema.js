export class QuestValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "QuestValidationError";
  }
}

const PRIORITIES = ["Main", "High", "Medium", "Low"];
const PUBLICATION_STATES = ["draft", "published", "archived"];
const QUEST_MODES = ["rotating", "permanent"];
const DEFAULT_REWARD_LIMITS = {
  rep: { min: 0, max: 1000 },
  marks: { min: 0, max: 1000 },
};

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new QuestValidationError(`${path} must be an object`);
  }

  return value;
}

function text(value, path, maxLength = 5000) {
  if (typeof value !== "string") {
    throw new QuestValidationError(`${path} must be text`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new QuestValidationError(`${path} is required`);
  }

  if (normalized.length > maxLength) {
    throw new QuestValidationError(`${path} is too long`);
  }

  return normalized;
}

function optionalText(value, path, maxLength = 5000) {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  return text(value, path, maxLength);
}

function wholeNumber(value, path) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < 0 || number > 1000000) {
    throw new QuestValidationError(`${path} must be a non-negative whole number`);
  }

  return number;
}

function list(value, path, maxItems = 50) {
  if (!Array.isArray(value)) {
    throw new QuestValidationError(`${path} must be a list`);
  }

  if (value.length > maxItems) {
    throw new QuestValidationError(`${path} has too many items`);
  }

  return value;
}

function identifier(value, path) {
  const normalized = text(value, path, 120);

  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new QuestValidationError(`${path} contains unsupported characters`);
  }

  return normalized;
}

function publication(value, path) {
  const normalized = value ?? "draft";

  if (!PUBLICATION_STATES.includes(normalized)) {
    throw new QuestValidationError(
      `${path} must be draft, published, or archived`,
    );
  }

  return normalized;
}

function questMode(value, path) {
  const normalized = value || "rotating";

  if (!QUEST_MODES.includes(normalized)) {
    throw new QuestValidationError(`${path} must be rotating or permanent`);
  }

  return normalized;
}

function priority(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (["main", "critical", "current"].includes(normalized)) return "Main";
  if (["high", "strategic", "red carpet", "high support"].includes(normalized)) {
    return "High";
  }
  if (normalized === "low") return "Low";
  return "Medium";
}

function rewardItem(value, path, index) {
  const input = object(value, path);
  const quantity = wholeNumber(input.quantity ?? 1, `${path}.quantity`);

  if (quantity < 1) {
    throw new QuestValidationError(`${path}.quantity must be at least 1`);
  }

  return {
    id: identifier(input.id || `reward-item-${index + 1}`, `${path}.id`),
    name: text(input.name, `${path}.name`, 160),
    quantity,
  };
}

function reward(value, path) {
  const input = object(value ?? {}, path);

  return {
    rep: wholeNumber(input.rep ?? 0, `${path}.rep`),
    marks: wholeNumber(input.marks ?? 0, `${path}.marks`),
    items: list(input.items ?? [], `${path}.items`, 12).map((item, index) =>
      rewardItem(item, `${path}.items[${index}]`, index),
    ),
  };
}

function rewardRange(value, path, fallback) {
  const input = object(value ?? fallback, path);
  const min = wholeNumber(input.min ?? fallback.min, `${path}.min`);
  const max = wholeNumber(input.max ?? fallback.max, `${path}.max`);

  if (max < min) {
    throw new QuestValidationError(`${path}.max must be greater than or equal to min`);
  }

  return { min, max };
}

function rewardLimits(value, path) {
  const input = object(value ?? DEFAULT_REWARD_LIMITS, path);

  return {
    rep: rewardRange(input.rep, `${path}.rep`, DEFAULT_REWARD_LIMITS.rep),
    marks: rewardRange(input.marks, `${path}.marks`, DEFAULT_REWARD_LIMITS.marks),
  };
}

function validateRewardWithinLimits(value, limits, path) {
  for (const [currency, label] of [
    ["rep", "Guild XP / Rep"],
    ["marks", "Service Marks"],
  ]) {
    const amount = value[currency];
    const range = limits[currency];

    if (amount !== 0 && (amount < range.min || amount > range.max)) {
      throw new QuestValidationError(
        `${path}.${currency} must be 0 or between ${range.min} and ${range.max} (${label})`,
      );
    }
  }
}

function assignment(value, path) {
  const input = object(value, path);
  const memberId = optionalText(input.memberId, `${path}.memberId`, 120);
  const avatar = optionalText(input.avatar, `${path}.avatar`, 1000);

  return {
    memberId,
    name: text(input.name || "Open", `${path}.name`, 120),
    responsibility: optionalText(input.responsibility, `${path}.responsibility`, 160),
    detail: optionalText(input.detail, `${path}.detail`, 240),
    initials: text(input.initials || "+", `${path}.initials`, 4),
    ...(avatar ? { avatar } : {}),
  };
}

function objective(value, path, index, limits) {
  const input = object(value, path);
  const normalizedReward = reward(input.reward, `${path}.reward`);
  validateRewardWithinLimits(normalizedReward, limits, `${path}.reward`);

  return {
    id: identifier(input.id || `objective-${index + 1}`, `${path}.id`),
    title: text(input.title, `${path}.title`, 160),
    description: optionalText(input.description, `${path}.description`, 1500),
    priority: priority(input.priority ?? input.status),
    completed: input.completed === true,
    need: optionalText(input.need, `${path}.need`, 500),
    reward: normalizedReward,
    assignments: list(input.assignments ?? [], `${path}.assignments`, 20).map(
      (item, assignmentIndex) =>
        assignment(item, `${path}.assignments[${assignmentIndex}]`),
    ),
  };
}

function quest(value, path, index, limits) {
  const input = object(value, path);
  const objectives = list(input.objectives ?? [], `${path}.objectives`, 50).map(
    (item, objectiveIndex) =>
      objective(item, `${path}.objectives[${objectiveIndex}]`, objectiveIndex, limits),
  );
  const mode = questMode(input.mode, `${path}.mode`);

  return {
    id: identifier(input.id || `quest-${index + 1}`, `${path}.id`),
    publication: publication(input.publication, `${path}.publication`),
    mode,
    title: text(input.title, `${path}.title`, 200),
    summary: optionalText(input.summary, `${path}.summary`, 2000),
    objectives,
    completed:
      mode !== "permanent" &&
      objectives.length > 0 &&
      objectives.every((objectiveItem) => objectiveItem.completed),
  };
}

export function normalizeQuestDocument(value) {
  const input = object(value, "questDocument");
  const limits = rewardLimits(input.rewardLimits, "questDocument.rewardLimits");
  const quests = list(input.quests ?? [], "questDocument.quests", 60).map(
    (item, index) => quest(item, `questDocument.quests[${index}]`, index, limits),
  );

  const questIds = new Set();
  const objectiveIds = new Set();

  for (const questItem of quests) {
    if (questIds.has(questItem.id)) {
      throw new QuestValidationError(`Duplicate quest id: ${questItem.id}`);
    }

    questIds.add(questItem.id);

    for (const objectiveItem of questItem.objectives) {
      if (objectiveIds.has(objectiveItem.id)) {
        throw new QuestValidationError(`Duplicate objective id: ${objectiveItem.id}`);
      }

      objectiveIds.add(objectiveItem.id);
    }
  }

  const publishedQuests = quests.filter(
    (questItem) => questItem.publication === "published",
  );
  const requestedFocus = optionalText(
    input.focusedQuestId,
    "questDocument.focusedQuestId",
    120,
  );
  const focusedQuest =
    requestedFocus &&
    publishedQuests.find((questItem) => questItem.id === requestedFocus);
  const focusedQuestId =
    focusedQuest?.id || (publishedQuests.length === 1 ? publishedQuests[0].id : "");

  return {
    version: 1,
    focusedQuestId,
    rewardPolicy: optionalText(input.rewardPolicy, "questDocument.rewardPolicy", 2000),
    rewardLimits: limits,
    quests,
  };
}

export function projectQuests(value) {
  const document = normalizeQuestDocument(value);

  return {
    focusedQuestId: document.focusedQuestId,
    quests: document.quests
      .filter((questItem) => questItem.publication === "published")
      .map((questItem) => ({
        id: questItem.id,
        mode: questItem.mode,
        title: questItem.title,
        summary: questItem.summary,
        completed: questItem.completed,
        completedObjectives: questItem.objectives.filter(
          (objectiveItem) => objectiveItem.completed,
        ).length,
        objectiveCount: questItem.objectives.length,
        objectives: questItem.objectives,
      })),
  };
}

export const defaultRewardLimits = DEFAULT_REWARD_LIMITS;
export const objectivePriorities = PRIORITIES;
