export function farmingDuration(seconds) {
  const minutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

export function farmingRunLabel(session) {
  if (session.quality === 'awaiting_observations') return 'Waiting for harvest sync';
  if (session.quality === 'in_progress') return 'In progress';
  if (session.quality === 'incomplete_sync') return 'Incomplete sync';
  if (session.quality === 'short_sample') return 'Short sample';
  return session.timing === 'measured' ? 'Measured run' : 'Estimated run';
}

export function farmingHourlyYield(output) {
  return typeof output.perHour === 'number' && Number.isFinite(output.perHour)
    ? `${output.perHour.toFixed(1)}/hour` : 'More data needed';
}

export function farmingCoverageLabel(session) {
  if (!session.partial || typeof session.coverage !== 'number') return '';
  const percent = Math.floor(Math.min(1, Math.max(0, session.coverage)) * 100);
  return `${session.observedGathers}/${session.expectedGathers} harvests synced (${percent}%)`;
}
