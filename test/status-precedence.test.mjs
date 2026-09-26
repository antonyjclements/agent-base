/**
 * AC2: how a thread reads on the map. First match wins, in this order:
 * errored, running, PR merged, awaiting input, dormant (three days quiet), idle.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { STALE_MS, statusFor } from '../src/game/status.js'

const NOW = Date.UTC(2026, 8, 26, 12)
const quiet = { hasError: false, running: false, prState: '', unread: false, lastActivityAt: NOW }

// Highest precedence first: the status, and the fields that produce it.
const LADDER = [
  ['blocked', { hasError: true }],
  ['working', { running: true }],
  ['celebrating', { prState: 'MERGED' }],
  ['waiting', { unread: true }],
  ['sleeping', { lastActivityAt: NOW - STALE_MS - 1 }],
  ['idle', {}],
]

test('a quiet, recent thread is idle', () => {
  assert.equal(statusFor(quiet, NOW), 'idle')
})

for (let i = 0; i < LADDER.length; i++) {
  for (let j = i + 1; j < LADDER.length; j++) {
    const [higher, hi] = LADDER[i]
    const [lower, lo] = LADDER[j]
    test(`${higher} outranks ${lower}`, () => {
      assert.equal(statusFor({ ...quiet, ...lo, ...hi }, NOW), higher)
    })
  }
}

test('a thread that is everything at once reads as errored', () => {
  const everything = Object.assign({}, quiet, ...LADDER.map(([, fields]) => fields))
  assert.equal(statusFor(everything, NOW), 'blocked')
})

test('dormant needs strictly more than three days of silence', () => {
  assert.equal(statusFor({ ...quiet, lastActivityAt: NOW - STALE_MS }, NOW), 'idle')
  assert.equal(statusFor({ ...quiet, lastActivityAt: NOW - STALE_MS - 1 }, NOW), 'sleeping')
})
