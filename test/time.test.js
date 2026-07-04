import test from 'node:test'
import assert from 'node:assert/strict'
import { dateInTimeZone } from '../src/lib/time.js'

test('report date crosses midnight in a positive-offset zone (DST)', () => {
  // 21:30 UTC is already the next day in a UTC+3 summer zone.
  assert.equal(dateInTimeZone('2026-06-28T21:30:00Z', 'Europe/Athens'), '2026-06-29')
})

test('report date respects the winter offset', () => {
  // 22:30 UTC is the next day in a UTC+2 winter zone.
  assert.equal(dateInTimeZone('2026-01-01T22:30:00Z', 'Europe/Athens'), '2026-01-02')
})

test('report date defaults to UTC when no zone is given', () => {
  assert.equal(dateInTimeZone('2026-06-28T21:30:00Z', 'UTC'), '2026-06-28')
})
