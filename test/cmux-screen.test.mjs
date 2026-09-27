// @spec:MB-016
import test from 'node:test'
import assert from 'node:assert/strict'
import { CmuxScreenStatus, promptOnScreen, matchSurfaces, screenStatusEnabled } from '../server/status/cmux-screen.mjs'

const W = '11111111-1111-4111-8111-111111111111'
const S = '22222222-2222-4222-8222-222222222222'
const S2 = '33333333-3333-4333-8333-333333333333'
const permission = 'PRIVATE SENTINEL\nDo you want to proceed?\n❯ 1. Yes\n  2. No\nEsc to cancel'
const question = 'Which option?\n❯ 1. One\n  2. Two\nEnter to select · Tab/Arrow keys to navigate · Esc to cancel'
const tree = (surfaces = [{ id: S, processes: [{ pid: 5, children: [{ pid: 42 }] }] }]) => ({ windows: [{ workspaces: [{ id: W, panes: [{ surfaces }] }] }] })
const markers = () => new Map([['session', { cli: true, terminalPids: [42] }]])
const threads = () => [{ id: 'claude-code:session', harness: 'claude-code', terminalLive: true, ref: { cliSessionId: 'session' }, running: true, lastActivityAt: 1 }]

test('screen reads require an explicit opt-in, independently of the event-stream switch', () => {
  for (const value of [undefined, '', 'off', 'false', 'unexpected']) assert.equal(screenStatusEnabled({ MOON_BASE_CMUX_SCREEN: value }), false)
  for (const value of ['on', '1', 'true', 'YES']) assert.equal(screenStatusEnabled({ MOON_BASE_CMUX_SCREEN: value, MOON_BASE_CMUX_STATUS: 'off' }), true)
})

test('visible permission, plan and question controls are recognized without retaining content', () => {
  assert.equal(promptOnScreen(permission), 'permission')
  assert.equal(promptOnScreen(question), 'question')
  assert.equal(promptOnScreen('Would you like to proceed?\n❯ 1. Yes, auto-accept edits\n  2. No\nEnter to confirm · Esc to cancel'), 'plan')
  assert.equal(promptOnScreen('\u001b[32m' + permission + '\u001b[0m'), 'permission')
})
test('quotes, scrollback above a new prompt, truncated dialogs and ordinary output are unknown', () => {
  for (const text of ['Working...', '❯ ', 'Do you want to proceed?', permission.replace('❯', ' '), permission + '\n❯ run tests', '> ' + permission.replaceAll('\n', '\n> '), '```\n' + permission + '\n```']) {
    assert.equal(promptOnScreen(text), null, text)
  }
})
test('PID matching uses nested processes, never cwd; ambiguous and malformed bindings are skipped', () => {
  assert.deepEqual(matchSurfaces(tree(), markers()), [{ sessionId: 'session', workspace: W, surface: S }])
  assert.deepEqual(matchSurfaces(tree([{ id: S, top_level_pids: [42] }, { id: S2, top_level_pids: [42] }]), markers()), [])
  assert.deepEqual(matchSurfaces(tree([{ id: '--focus', top_level_pids: [42] }]), markers()), [])
  assert.deepEqual(matchSurfaces(tree(), new Map([['session', { cli: true, terminalPids: [42, 43] }]])), [])
  assert.deepEqual(matchSurfaces(tree(), new Map([['session', { cli: false, terminalPids: [42] }]])), [])
  assert.deepEqual(matchSurfaces({ windows: 'changed shape' }, markers()), [])
  const both = markers(); both.set('other', { cli: true, terminalPids: [5] })
  assert.deepEqual(matchSurfaces(tree(), both), [])
})
test('opt-in screen overlay clears after an answer or failed read, keeps text out of state', async () => {
  let now = 10000, screen = permission, fail = false
  const calls = []
  const reader = new CmuxScreenStatus({ enabled: true, now: () => now,
    top: async () => tree(), read: async target => { calls.push(target); if (fail) throw Error('PRIVATE SENTINEL'); return screen } })
  let out = await reader.overlay(threads(), markers())
  assert.equal(out[0].running, false)
  assert.equal(out[0].unread, true)
  assert.equal(out[0].liveSource, 'cmux-screen')
  assert.equal(JSON.stringify([out, reader.summary()]).includes('PRIVATE SENTINEL'), false)
  assert.deepEqual(calls[0], { sessionId: 'session', workspace: W, surface: S })
  now += 3000; screen = 'Thinking...'
  out = await reader.overlay(threads(), markers())
  assert.equal(out[0].running, true)
  now += 3000; screen = permission
  assert.equal((await reader.overlay(threads(), markers()))[0].running, false)
  now += 3000; fail = true
  assert.equal((await reader.overlay(threads(), markers()))[0].running, true)
  assert.equal(reader.summary().problem, 'read-failed')
})
test('off makes no commands; unavailable topology fails closed; concurrent scans coalesce', async () => {
  let calls = 0
  const top = async () => { calls++; return tree() }
  const off = new CmuxScreenStatus({ enabled: false, top })
  assert.deepEqual(await off.overlay(threads(), markers()), threads())
  assert.equal(calls, 0)
  const on = new CmuxScreenStatus({ enabled: true, top, read: async () => permission })
  await Promise.all([on.overlay(threads(), markers()), on.overlay(threads(), markers())])
  assert.equal(calls, 1)
  const failed = new CmuxScreenStatus({ enabled: true, top: async () => { throw Error('secret') } })
  assert.deepEqual(await failed.overlay(threads(), markers()), threads())
  assert.equal(failed.summary().problem, 'unavailable')
})

test('a new turn and a disappeared process cannot inherit cached screen waiting', async () => {
  const reader = new CmuxScreenStatus({ enabled: true, now: () => 10000, top: async () => tree(), read: async () => permission })
  assert.equal((await reader.overlay(threads(), markers()))[0].running, false)
  const newer = threads().map(t => ({ ...t, markerAt: 10001 }))
  assert.equal((await reader.overlay(newer, markers()))[0].running, true)
  assert.deepEqual(await reader.overlay(threads(), new Map()), threads())
})

test('many sessions use bounded batches and every pane gets a turn', async () => {
  const manyMarkers = new Map(), manyThreads = [], surfaces = [], seen = new Set()
  for (let i = 0; i < 20; i++) {
    const id = `session-${i}`, surface = `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`
    manyMarkers.set(id, { cli: true, terminalPids: [i + 1] })
    manyThreads.push({ ...threads()[0], id, ref: { cliSessionId: id } })
    surfaces.push({ id: surface, top_level_pids: [i + 1] })
  }
  let now = 10000, count = 0
  const reader = new CmuxScreenStatus({ enabled: true, now: () => now, top: async () => tree(surfaces), read: async t => { count++; seen.add(t.surface); return permission } })
  await reader.overlay(manyThreads, manyMarkers)
  assert.equal(count, 16)
  now += 3000
  await reader.overlay(manyThreads, manyMarkers)
  assert.equal(count, 32)
  assert.equal(seen.size, 20)
})
