import { monitorEventLoopDelay } from "node:perf_hooks";

// Startup lifecycle: the process binds its port at once and answers health
// checks while the database is prepared, but serves no application request
// until every required step has finished. States move forward only:
//
//   starting -> http_bound -> initializing -> migrating -> ready
//                                                     \-> failed
//
// After `ready`, background services (market refresh, backups, Discord
// sync) report themselves as `maintenance` phases without affecting
// readiness. Phase timings are logged as one JSON line each, with no data
// values, so startup can be measured from the logs alone.

export const STATES = Object.freeze(["starting", "http_bound", "initializing", "migrating", "ready", "failed"]);

export function createStartupLifecycle({ clock = () => performance.now(), wallClock = () => new Date(), log = console } = {}) {
  const startedAt = clock();
  const startedAtIso = wallClock().toISOString();
  let state = "starting";
  let current = null;
  let readyAt = null;
  let failure = null;
  const phases = [];

  function emit(fields) {
    log.info?.(JSON.stringify({ event: "startup", ...fields }));
  }

  function transition(next) {
    if (state === "failed" || state === "ready" && next !== "failed") return;
    if (STATES.indexOf(next) < STATES.indexOf(state)) return;
    state = next;
    emit({ state, atMs: Math.round(clock() - startedAt) });
  }

  // Runs one named step and records its duration. `state` is the lifecycle
  // state while it runs (initializing or migrating).
  async function phase(name, fn, { state: during = "initializing" } = {}) {
    transition(during);
    current = name;
    const began = clock();
    try {
      const result = await fn();
      const ms = Math.round(clock() - began);
      phases.push({ name, ms, ok: true });
      emit({ phase: name, ms, ok: true });
      return result;
    } catch (error) {
      const ms = Math.round(clock() - began);
      phases.push({ name, ms, ok: false });
      emit({ phase: name, ms, ok: false, error: error.code || error.name || "Error" });
      throw error;
    } finally {
      current = null;
    }
  }

  return {
    phase,
    bound() { transition("http_bound"); },
    ready() {
      transition("ready");
      readyAt = clock();
      emit({ ready: true, totalMs: Math.round(readyAt - startedAt) });
    },
    fail(error) {
      failure = error?.code || error?.name || "Error";
      state = "failed";
      emit({ state, error: failure, atMs: Math.round(clock() - startedAt) });
    },
    get state() { return state; },
    isReady() { return state === "ready"; },
    snapshot() {
      return {
        state,
        phase: current,
        startedAt: startedAtIso,
        uptimeMs: Math.round(clock() - startedAt),
        readyAfterMs: readyAt === null ? null : Math.round(readyAt - startedAt),
        phases: phases.map((entry) => ({ ...entry })),
        failure,
      };
    },
  };
}

// The request handler used until the application is ready. Liveness is
// answered (the process is up); everything else is 503 with Retry-After,
// including readiness, so no request can reach an unmigrated database.
export function notReadyHandler(lifecycle) {
  return (req, res) => {
    const pathname = (req.url || "/").split("?")[0];
    const { state, phase } = lifecycle.snapshot();
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET" && pathname === "/api/health/live") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "ok", ready: false, state, phase }));
      return;
    }
    res.statusCode = 503;
    res.setHeader("Retry-After", "5");
    if (pathname.startsWith("/api/")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: state === "failed" ? "failed" : "starting", state, phase }));
      return;
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Holdfast is starting. Try again in a few seconds.\n");
  };
}

// Logs when synchronous work held the event loop long enough that health
// checks (5 s on Render) could time out. Reports the worst stall per window.
export function startEventLoopStallMonitor({ thresholdMs = 1000, intervalMs = 30_000, log = console } = {}) {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const timer = setInterval(() => {
    const maxMs = Math.round(histogram.max / 1e6);
    if (maxMs >= thresholdMs) {
      log.warn?.(JSON.stringify({ event: "event_loop_stall", maxMs, p99Ms: Math.round(histogram.percentile(99) / 1e6) }));
    }
    histogram.reset();
  }, intervalMs);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    histogram.disable();
  };
}
