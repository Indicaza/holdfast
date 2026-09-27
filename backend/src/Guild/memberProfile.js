import crypto from "node:crypto";

const MAX_CHARACTERS = 12;
const MAX_PROFESSIONS = 6;

function text(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function characterId(value) {
  const supplied = text(value, 80);
  return supplied || crypto.randomUUID();
}

function normalizeProfessions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set();

  for (const profession of value) {
    const normalized = text(profession, 40);

    if (normalized) {
      unique.add(normalized);
    }

    if (unique.size >= MAX_PROFESSIONS) {
      break;
    }
  }

  return [...unique];
}

function normalizeCharacters(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const characters = value
    .slice(0, MAX_CHARACTERS)
    .map((character) => ({
      id: characterId(character?.id),
      name: text(character?.name, 32),
      race: text(character?.race, 32),
      className: text(character?.className, 32),
      spec: text(character?.spec, 48),
      professions: normalizeProfessions(character?.professions),
      isMain: Boolean(character?.isMain),
    }))
    .filter((character) => character.name);

  if (!characters.length) {
    return [];
  }

  const mainIndex = characters.findIndex((character) => character.isMain);

  characters.forEach((character, index) => {
    character.isMain = index === (mainIndex >= 0 ? mainIndex : 0);
  });

  return characters;
}

export function emptyMemberProfile() {
  return {
    battleTag: "",
    timezone: "",
    availability: "",
    bio: "",
    characters: [],
  };
}

export function normalizeMemberProfile(value) {
  const input = value && typeof value === "object" ? value : {};

  return {
    battleTag: text(input.battleTag, 64),
    timezone: text(input.timezone, 64),
    availability: text(input.availability, 160),
    bio: text(input.bio, 500),
    characters: normalizeCharacters(input.characters),
  };
}

export function primaryCharacter(profile) {
  const characters = Array.isArray(profile?.characters)
    ? profile.characters
    : [];

  return (
    characters.find((character) => character.isMain) ||
    characters[0] ||
    null
  );
}
