import { Router } from "express";

import { requireAuthenticated } from "../Auth/permissions.js";
import { createArmoryHandlers } from "../Character/intelligenceRouter.js";
import { readCharacterArmoryFromReadModel } from "../Character/ReadModel/readModelReader.js";
import { publishPlayerChanged } from "../Live/playerChangeEvents.js";
import {
  readPlayerCharacters,
  readPlayerDevices,
  readPlayerFarming,
  readPlayerOverview,
  readPlayerProfessions,
  renamePlayerDevice,
  revokePlayerDevice,
  searchPlayerCrafts,
} from "./playerRepository.js";
import { requestedServer } from "./playerServers.js";
import { readDungeonRun, readDungeonRuns } from "../Dungeon/dungeonRunRepository.js";

// Mounted at /api/player: the signed-in player's own workspace. Every route
// takes the account from the session (req.auth.user.id) and never from the
// request, so there is no way to name another player's account. Another
// player's character or device answers 404, like one that does not exist.
export function createPlayerRouter({ provider, icons } = {}) {
  const router = Router();
  const ownArmory = createArmoryHandlers({
    provider,
    icons,
    readArmory: (req) => readCharacterArmoryFromReadModel(req.params.characterId, { ownerId: req.auth.user.id }),
  });

  router.use(requireAuthenticated, (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  function respond(name, read) {
    return (req, res) => {
      try {
        res.json(read(req));
      } catch (error) {
        console.error(`Unable to read player ${name}`, error);
        res.status(500).json({ error: `player_${name}_unavailable` });
      }
    };
  }

  const owner = (req) => req.auth.user.id;
  const server = (req) => requestedServer(req.query?.server);

  router.get("/overview", respond("overview", (req) => readPlayerOverview(owner(req))));
  router.get("/characters", respond("characters", (req) => readPlayerCharacters(owner(req), { server: server(req) })));
  router.get("/characters/:characterId", ownArmory.armory);
  router.get("/characters/:characterId/recipes", ownArmory.recipes);
  router.get("/professions", respond("professions", (req) => readPlayerProfessions(owner(req), { server: server(req) })));
  router.get("/craft-finder", respond("crafts", (req) => ({
    results: searchPlayerCrafts(owner(req), req.query?.q || "", { server: server(req) }),
  })));
  router.get("/farming", respond("farming", (req) => readPlayerFarming(owner(req), { server: server(req) })));
  router.get("/dungeon-runs", respond("dungeon_runs", (req) => readDungeonRuns({
    memberId: owner(req), server: server(req), character: req.query?.character, realm: req.query?.realm,
    dungeon: req.query?.dungeon, from: req.query?.from, to: req.query?.to, limit: req.query?.limit,
  })));
  // Another player's run answers 404, like one that does not exist.
  router.get("/dungeon-runs/:runId", (req, res) => {
    try {
      const run = readDungeonRun({ memberId: owner(req), id: req.params.runId });
      if (!run) {
        res.status(404).json({ error: "dungeon_run_not_found" });
        return;
      }
      res.json({ run });
    } catch (error) {
      console.error("Unable to read player dungeon run", error);
      res.status(500).json({ error: "player_dungeon_run_unavailable" });
    }
  });
  router.get("/devices", respond("devices", (req) => ({ devices: readPlayerDevices(owner(req)) })));

  // Disconnecting a device revokes its key: the bridge on that computer has
  // to be connected again before it can upload.
  router.post("/devices/:deviceId/disconnect", (req, res) => {
    try {
      const result = revokePlayerDevice(owner(req), req.params.deviceId);
      if (result.status === "not-found") {
        res.status(404).json({ error: "device_not_found" });
        return;
      }
      if (result.status === "disconnected") publishPlayerChanged(owner(req), "player.device.disconnected");
      else res.locals.unchanged = true;
      res.json({ status: result.status, device: result.device });
    } catch (error) {
      console.error("Unable to disconnect player device", error);
      res.status(500).json({ error: "device_disconnect_failed" });
    }
  });

  // Naming a device only changes its label here; its key is untouched.
  router.post("/devices/:deviceId/rename", (req, res) => {
    try {
      const result = renamePlayerDevice(owner(req), req.params.deviceId, req.body?.name);
      if (result.status === "invalid") {
        res.status(400).json({ error: "device_name_invalid" });
        return;
      }
      if (result.status === "not-found") {
        res.status(404).json({ error: "device_not_found" });
        return;
      }
      publishPlayerChanged(owner(req), "player.device.renamed");
      res.json({ status: result.status, device: result.device });
    } catch (error) {
      console.error("Unable to rename player device", error);
      res.status(500).json({ error: "device_rename_failed" });
    }
  });

  return router;
}
