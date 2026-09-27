import test from "node:test";
import assert from "node:assert/strict";

import { safeReturnTo } from "../src/Auth/discordAuth.js";

test("OAuth return path preserves safe local routes", () => {
  assert.equal(
    safeReturnTo("/quests?signupQuest=q1&signupObjective=o1#board"),
    "/quests?signupQuest=q1&signupObjective=o1#board",
  );
});

test("OAuth return path rejects external and protocol-relative redirects", () => {
  assert.equal(safeReturnTo("https://evil.example"), "/");
  assert.equal(safeReturnTo("//evil.example/path"), "/");
  assert.equal(safeReturnTo("not-a-route"), "/");
});
