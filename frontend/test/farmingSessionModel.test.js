import assert from 'node:assert/strict';
import test from 'node:test';
import { farmingDuration, farmingRunLabel, farmingHourlyYield, farmingCoverageLabel } from '../src/Intelligence/Farming/farmingSessionModel.js';

test('farming time and hourly yields preserve uncertainty', () => {
  assert.equal(farmingDuration(5400), '1h 30m');
  assert.equal(farmingDuration(30), '0m');
  assert.equal(farmingDuration(null), '0m');
  assert.equal(farmingRunLabel({ quality: 'short_sample', timing: 'measured' }), 'Short sample');
  assert.equal(farmingRunLabel({ quality: 'awaiting_observations' }), 'Waiting for harvest sync');
  assert.equal(farmingRunLabel({ quality: 'in_progress' }), 'In progress');
  assert.equal(farmingRunLabel({ quality: 'sustained', timing: 'measured' }), 'Measured run');
  assert.equal(farmingRunLabel({ quality: 'sustained', timing: 'estimated' }), 'Estimated run');
  assert.equal(farmingHourlyYield({ perHour: null }), 'More data needed');
  assert.equal(farmingHourlyYield({ perHour: 40 }), '40.0/hour');
});


test('incomplete sync and partial rates expose coverage clearly', () => {
  assert.equal(farmingRunLabel({ quality: 'incomplete_sync' }), 'Incomplete sync');
  assert.equal(farmingCoverageLabel({ partial: true, coverage: 0.9, observedGathers: 18, expectedGathers: 20 }), '18/20 harvests synced (90%)');
  assert.equal(farmingCoverageLabel({ partial: true, coverage: 0.899, observedGathers: 899, expectedGathers: 1000 }), '899/1000 harvests synced (89%)');
  assert.equal(farmingCoverageLabel({ partial: false }), '');
  assert.equal(farmingCoverageLabel({ partial: true }), '');
});
