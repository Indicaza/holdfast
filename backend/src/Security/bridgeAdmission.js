// Admission before parsing multi-megabyte request bodies or touching SQLite.
// Excess demand stays at the client, never in an unbounded server queue.
export function createBridgeAdmission({ capacity = 16, burst = 24, perSecond = 12, now = Date.now } = {}) {
  let active = 0, tokens = burst, last = now();
  return (req, res, next) => {
    const timestamp = now();
    tokens = Math.min(burst, tokens + Math.max(0, timestamp - last) * perSecond / 1000);
    last = timestamp;
    if (active >= capacity || tokens < 1) {
      res.set("Retry-After", "3");
      res.set("X-Guildweaver-Backpressure", "1");
      res.set("Cache-Control", "no-store");
      return res.status(503).json({ error: "bridge_busy", retryAfterSeconds: 3 });
    }
    active++;
    tokens--;
    let released = false;
    const release = () => { if (!released) { released = true; active--; } };
    res.once("finish", release);
    res.once("close", release);
    next();
  };
}
