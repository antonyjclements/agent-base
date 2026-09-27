// @spec:MB-016
import test from 'node:test'
import assert from 'node:assert/strict'
import { pollInterval } from '../src/game/poll-interval.js'

test('live terminals poll quickly even when idle and no hooks report', () => {
  assert.equal(pollInterval({ active: false, terminalSessions: 1 }), 3000)
  assert.equal(pollInterval({ active: true }), 3000)
  assert.equal(pollInterval({ active: false, terminalSessions: 0 }), 15000)
  assert.equal(pollInterval(null), 15000)
})
