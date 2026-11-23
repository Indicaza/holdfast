// Keeps a long background scan to about a third of one CPU: work briefly,
// then sleep. The clock is read only every few rows.
export function createPacer({ workMs = 20, restMs = 40, everyRows = 64, now = () => performance.now(), sleep } = {}) {
  let burstStarted = now()
  let rows = 0
  const rest = () => {
    sleep(restMs)
    burstStarted = now()
  }
  const pace = () => {
    rows += 1
    if (rows % everyRows === 0 && now() - burstStarted >= workMs) rest()
  }
  pace.rest = rest
  return pace
}
