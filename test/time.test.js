import test from 'node:test'
import assert from 'node:assert/strict'
import { dateInTimeZone } from '../src/lib/time.js'

test('Kyiv report date crosses midnight independently of UTC', () => {
  assert.equal(dateInTimeZone('2026-06-28T21:30:00Z'), '2026-06-29')
})

test('Kyiv report date respects winter offset', () => {
  assert.equal(dateInTimeZone('2026-01-01T22:30:00Z'), '2026-01-02')
})
