import assert from 'node:assert/strict';
import test from 'node:test';
import { farmingDuration, farmingRunLabel, farmingHourlyYield } from '../src/Intelligence/Farming/farmingSessionModel.js';

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
