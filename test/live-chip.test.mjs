/**
 * AC14, what the page shows: the Live chip names cmux while it reports, shows it as quiet when it is
 * there and silent, and never names it when it is switched off or absent. Kept as a pure function so it
 * needs no scene or DOM.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { liveChip } from '../src/game/live-chip.js'

const NOW = Date.UTC(2026, 8, 26, 12)
const MIN = 60 * 1000

test('file polling and screen detection are labelled separately from hook reporting', () => {
  assert.equal(liveChip({ active: false, terminalSessions: 1 }).text, 'Claude · files')
  assert.match(liveChip({ active: false, terminalSessions: 1 }).title, /every three seconds/)
  assert.equal(liveChip({ active: false, screen: { enabled: true, checked: 1 } }).text, 'cmux screen ●')
  assert.equal(liveChip({ active: false, screen: { enabled: true, checked: 0 } }).text, 'cmux screen ○')
  const combined = liveChip({ active: true, tools: {}, sources: [], screen: { enabled: true, checked: 0 } })
  assert.equal(combined.text, 'Live · Claude ○ Codex ○ · screen ○')
  assert.match(combined.title, /Screen detection could not read a matched pane/)
})
const live = (o = {}) => ({
  active: true,
  tools: { 'claude-code': NOW - 1000, codex: 0 },
  sources: [{ id: 'hooks', present: true, lastAt: NOW - 1000 }],
  ...o,
})
const cmux = (lastAt, present = true) => ({ id: 'cmux', present, lastAt })

test('nothing reporting, or nothing known, hides the chip', () => {
  assert.equal(liveChip(null, NOW), null)
  assert.equal(liveChip(undefined, NOW), null)
  assert.equal(liveChip({ active: false, tools: {}, sources: [] }, NOW), null)
  assert.equal(liveChip({}, NOW), null)
})

test('with only hooks it reads as it always has, and does not mention cmux', () => {
  const chip = liveChip(live(), NOW)
  assert.equal(chip.text, 'Live · Claude Code ● Codex ○')
  assert.match(chip.title, /^Live status from hooks\./)
  assert.ok(!/cmux/i.test(chip.text + chip.title))
})

test('cmux reporting is named, with a filled dot, and credited in the tooltip', () => {
  const chip = liveChip(live({ sources: [{ id: 'hooks', present: false, lastAt: 0 }, cmux(NOW - 2000)] }), NOW)
  assert.equal(chip.text, 'Live · Claude Code ● Codex ○ · cmux ●')
  assert.match(chip.title, /^Live status from cmux\./)
})

test('hooks and cmux both reporting are both credited', () => {
  const chip = liveChip(live({ sources: [{ id: 'hooks', present: true, lastAt: NOW - 1000 }, cmux(NOW - 2000)] }), NOW)
  assert.match(chip.title, /^Live status from hooks and cmux\./)
})

test('cmux that is there but has said nothing lately is shown as quiet, and the tooltip says so', () => {
  for (const lastAt of [0, NOW - 11 * MIN]) {
    const chip = liveChip(live({ sources: [{ id: 'hooks', present: true, lastAt: NOW - 1000 }, cmux(lastAt)] }), NOW)
    assert.equal(chip.text, 'Live · Claude Code ● Codex ○ · cmux ○', `lastAt ${lastAt}`)
    assert.match(chip.title, /cmux is there but has said nothing lately/)
  }
})

test('cmux that is there but silent shows the chip by itself, when nothing else is reporting', () => {
  const quiet = (lastAt) => ({ active: false, tools: { 'claude-code': 0, codex: 0 }, sources: [{ id: 'hooks', present: false, lastAt: 0 }, cmux(lastAt)] })
  for (const lastAt of [0, NOW - 11 * MIN]) {
    const chip = liveChip(quiet(lastAt), NOW)
    assert.ok(chip, `lastAt ${lastAt}: the chip is shown`)
    assert.equal(chip.text, 'Live · Claude Code ○ Codex ○ · cmux ○')
    assert.match(chip.title, /cmux is there but has said nothing lately/)
    assert.ok(!/live status from/i.test(chip.title), 'it does not claim a source is reporting')
  }
})

test('nothing reporting still hides the chip unless cmux is there to be named', () => {
  const hooksQuiet = { id: 'hooks', present: true, lastAt: NOW - 11 * MIN }
  for (const sources of [[hooksQuiet], [hooksQuiet, cmux(0, false)], [], undefined]) {
    assert.equal(liveChip({ active: false, tools: { 'claude-code': 0, codex: 0 }, sources }, NOW), null, JSON.stringify(sources))
  }
})

test('cmux that is absent, switched off, or unknown to an older server is never named', () => {
  const cases = [
    live({ sources: [{ id: 'hooks', present: true, lastAt: NOW - 1000 }, cmux(0, false)] }), // its file is not there
    live({ sources: [{ id: 'hooks', present: true, lastAt: NOW - 1000 }] }), // switched off: not listed at all
    live({ sources: undefined }), // an older server with no list
    live({ sources: 'nonsense' }),
    live({ sources: [null, 5, {}] }),
  ]
  for (const l of cases) {
    const chip = liveChip(l, NOW)
    assert.ok(!/cmux/i.test(chip.text + chip.title), JSON.stringify(l.sources))
  }
})

test('a dot is filled for ten minutes after a tool last reported, and not a moment longer', () => {
  const at = (ms) => liveChip(live({ tools: { 'claude-code': NOW - ms, codex: 0 } }), NOW).text
  assert.equal(at(10 * MIN - 1), 'Live · Claude Code ● Codex ○')
  assert.equal(at(10 * MIN), 'Live · Claude Code ○ Codex ○')
})
