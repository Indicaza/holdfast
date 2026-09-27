import test from "node:test";
import assert from "node:assert/strict";

import {
  isValidTimeZone,
  normalizeMemberProfile,
  primaryCharacter,
} from "../src/Guild/memberProfile.js";

test("member profile normalization trims fields and chooses one main character", () => {
  const profile = normalizeMemberProfile({
    battleTag: "  Rook#1234  ",
    timezone: "America/Detroit",
    timezoneSource: "manual",
    availability: " Evenings ",
    bio: " Leave it stronger. ",
    characters: [
      {
        id: "char-one",
        name: " Rook ",
        race: " Night Elf ",
        className: " Warrior ",
        spec: " Arms ",
        professions: ["Mining", "Mining", "Blacksmithing"],
        isMain: false,
      },
      {
        id: "char-two",
        name: "Alt",
        race: "Human",
        className: "Mage",
        spec: "Frost",
        professions: [],
        isMain: true,
      },
      {
        id: "char-three",
        name: "Third",
        isMain: true,
      },
    ],
  });

  assert.equal(profile.battleTag, "Rook#1234");
  assert.equal(profile.availability, "Evenings");
  assert.equal(profile.bio, "Leave it stronger.");
  assert.deepEqual(profile.characters[0].professions, [
    "Mining",
    "Blacksmithing",
  ]);
  assert.equal(profile.characters[0].isMain, false);
  assert.equal(profile.characters[1].isMain, true);
  assert.equal(profile.characters[2].isMain, false);
  assert.equal(primaryCharacter(profile).id, "char-two");
});

test("legacy timezone values default to manual source", () => {
  const profile = normalizeMemberProfile({
    timezone: "America/Detroit",
  });

  assert.equal(profile.timezoneSource, "manual");
});

test("timezone validation accepts IANA zones and rejects invalid values", () => {
  assert.equal(isValidTimeZone("America/Detroit"), true);
  assert.equal(isValidTimeZone("Definitely/Not_A_Zone"), false);
  assert.equal(isValidTimeZone(""), false);
});
