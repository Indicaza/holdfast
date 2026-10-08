import dotenv from "dotenv";

import { ensureRuntimeDataDirectory, runtimeDataDirectory } from "../src/Data/runtimeData.js";
import { initializeGuildData } from "../src/Data/initializeData.js";
import { withGuildTransaction } from "../src/Data/database.js";
import { importMembersIntoDatabase } from "../src/Guild/memberRepository.js";
import {
  importQuestsIntoDatabase,
  readQuestsFromDatabase,
} from "../src/Quest/questRepository.js";
import { seedDevelopmentCharacters } from "./seedDevelopmentCharacters.js";

dotenv.config();

const developmentMembers = [
  {
    id: "dev-member",
    username: "dev-member",
    displayName: "Mira Member",
    initials: "MM",
    rank: "Private",
    rankManaged: true,
    billetsManaged: true,
    status: "active",
    permissions: [],
    profile: {
      battleTag: "Mira#0001",
      timezone: "America/Detroit",
      timezoneSource: "manual",
      availability: "Evenings",
      bio: "Development fixture member.",
      characters: [
        {
          id: "dev-character-mira",
          name: "Mira",
          race: "Human",
          className: "Rogue",
          spec: "Combat",
          professions: ["Skinning", "Leatherworking"],
          isMain: true,
        },
      ],
    },
  },
  {
    id: "dev-officer",
    username: "dev-officer",
    displayName: "Owen Officer",
    initials: "OO",
    rank: "Lieutenant",
    rankManaged: true,
    billetsManaged: true,
    status: "active",
    permissions: [],
    profile: {
      battleTag: "Owen#0002",
      timezone: "America/Detroit",
      timezoneSource: "manual",
      availability: "Weeknights",
      bio: "Development fixture officer.",
      characters: [
        {
          id: "dev-character-owen",
          name: "Owen",
          race: "Dwarf",
          className: "Paladin",
          spec: "Holy",
          professions: ["Mining", "Blacksmithing"],
          isMain: true,
        },
      ],
    },
  },
  {
    id: "dev-commander",
    username: "dev-commander",
    displayName: "Casey Commander",
    initials: "CC",
    rank: "Commander",
    rankManaged: true,
    billetsManaged: true,
    status: "active",
    permissions: [],
    profile: {
      battleTag: "Casey#0003",
      timezone: "America/Detroit",
      timezoneSource: "manual",
      availability: "Flexible",
      bio: "Development fixture commander with full rank authority.",
      characters: [
        {
          id: "dev-character-casey",
          name: "Casey",
          race: "Night Elf",
          className: "Warrior",
          spec: "Protection",
          professions: ["Mining", "Engineering"],
          isMain: true,
        },
      ],
    },
  },
];

const developmentQuests = {
  version: 1,
  focusedQuestId: "dev-welcome",
  rewardPolicy: "Development fixtures only — rewards are disposable local data.",
  rewardLimits: {
    rep: { min: 0, max: 1000 },
    marks: { min: 0, max: 1000 },
    marksPerQuestMax: 1000,
  },
  quests: [
    {
      id: "dev-welcome",
      publication: "published",
      mode: "permanent",
      title: "Welcome to Holdfast",
      summary: "A local sample quest for exercising signup, review, rewards, and notifications.",
      createdByMemberId: "dev-officer",
      createdAt: "2026-10-04T00:00:00.000Z",
      completed: false,
      objectives: [
        {
          id: "dev-linen",
          title: "Stock the quartermaster",
          description: "Gather starter cloth so the guild can make bags for new members.",
          priority: "High",
          completed: false,
          need: "20 Linen Cloth",
          reward: { rep: 100, marks: 5, items: [] },
          assignments: [],
        },
        {
          id: "dev-patrol",
          title: "Scout the road",
          description: "Take a short patrol assignment to exercise signup and leave flows.",
          priority: "Medium",
          completed: false,
          need: "1 volunteer",
          reward: { rep: 0, marks: 0, items: [] },
          assignments: [],
        },
      ],
    },
  ],
};

function enabled(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

async function run() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development seed data cannot run in production.");
  }

  if (!enabled(process.env.HOLDFAST_DEV_AUTH)) {
    throw new Error(
      "Set HOLDFAST_DEV_AUTH=true in backend/.env before seeding development identities.",
    );
  }

  if (!String(process.env.SESSION_SECRET || "").trim()) {
    throw new Error(
      "Set SESSION_SECRET in backend/.env before using the development login sandbox.",
    );
  }

  await ensureRuntimeDataDirectory();
  initializeGuildData();

  const resetQuests = process.argv.includes("--reset-quests");
  let questAction = "left existing quests unchanged";

  withGuildTransaction((db) => {
    importMembersIntoDatabase(db, developmentMembers);
    const current = readQuestsFromDatabase(db);

    if (!current.quests.length || resetQuests) {
      importQuestsIntoDatabase(db, developmentQuests);
      questAction = resetQuests ? "reset quests to development fixtures" : "added sample quests";
    }
  });

  await seedDevelopmentCharacters();

  console.log(`Development data ready in ${runtimeDataDirectory()}`);
  console.log(`Seeded ${developmentMembers.length} local personas and ${questAction}.`);
  console.log("Open one of these URLs while the frontend/backend are running:");
  console.log("  Member:    http://localhost:5173/api/dev/login/member");
  console.log("  Officer:   http://localhost:5173/api/dev/login/officer");
  console.log("  Commander: http://localhost:5173/api/dev/login/commander");
  console.log("Use --reset-quests only when you intentionally want to replace local quest data.");
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
