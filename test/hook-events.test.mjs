/**
 * The live-status pipeline on the server: events off disk, into a per-session state, over the
 * threads the adapters found.
 *
 * AC6 (the states each tool can report, and how quickly they show) and AC7 (no events, or events
 * that stop, and status falls back to what the files say) are here. So is the rule that a hook
 * event is only ever a display hint: it can colour a bot that exists, and nothing else.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { EVENTS, parseEvent, MAX_LINE } from '../server/hooks/events.mjs'
import { LiveStatus, TTL, stateFor } from '../server/hooks/live.mjs'
import { statusFor } from '../src/game/status.js'

const NOW = Date.UTC(2026, 8, 26, 12)
const SID = '01a0dbe1-e660-7c61-999c-16e6243ba432'
const OTHER = '01a0dbe2-aaaa-7c61-999c-16e6243ba432'

const line = (o) => JSON.stringify({ v: 1, ts: NOW, tool: 'claude', event: 'UserPromptSubmit', sessionId: SID, ...o })

async function withLive(fn, options = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'live-'))
  await fsp.chmod(dir, 0o700)
  const file = path.join(dir, 'events.jsonl')
  const clock = { now: NOW }
  const live = new LiveStatus({ file, now: () => clock.now, ...options })
  const emit = (...events) => fsp.appendFile(file, events.map((e) => (typeof e === 'string' ? e : line(e))).join('\n') + '\n', { mode: 0o600 })
  try {
    return await fn({ live, emit, file, dir, clock })
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

const base = { running: false, unread: false, hasError: false, prState: '', lastActivityAt: NOW - 1000 }
const claudeThread = { ...base, id: `claude-code:${SID}`, harness: 'claude-code', lastFocusedAt: NOW - 500, ref: { cliSessionId: SID, desktopSessionId: 'local_abc' } }
const codexThread = { ...base, id: `codex:${SID}`, harness: 'codex', lastFocusedAt: 0, ref: { sessionId: SID } }

// ── parsing ───────────────────────────────────────────────────────────────────

test('a well-formed line becomes a normalised event', () => {
  const e = parseEvent(line({ event: 'Notification', notificationType: 'permission_prompt', cwd: '/tmp/demo', turnId: 't1' }), NOW)
  assert.deepEqual(e, { tool: 'claude', event: 'Notification', sessionId: SID, turnId: 't1', notificationType: 'permission_prompt', cwd: '/tmp/demo', at: NOW })
})

test('anything that is not exactly an event we register is refused', () => {
  const bad = [
    '',
    'not json',
    '{}',
    '[]',
    'null',
    line({ v: 2 }),
    line({ tool: 'cursor' }),
    line({ event: 'FileChanged' }),
    line({ tool: 'codex', event: 'StopFailure' }), // Codex has no such event
    line({ tool: 'claude', event: 'Interrupt' }), // and Claude Code has no such one
    line({ sessionId: '../../etc/passwd' }),
    line({ sessionId: 'a b' }),
    line({ sessionId: 'x'.repeat(200) }),
    line({ sessionId: 5 }),
    line({ cwd: 'x'.repeat(MAX_LINE) }),
  ]
  for (const l of bad) assert.equal(parseEvent(l, NOW), null, l.slice(0, 60))
})

test('extra fields are dropped, a future or missing timestamp becomes the arrival time, an old one stays old', () => {
  const e = parseEvent(line({ prompt: 'SECRET', ts: NOW + 10 * 24 * 3600 * 1000 }), NOW)
  assert.equal(e.prompt, undefined)
  assert.equal(e.at, NOW)
  assert.equal(parseEvent(line({ ts: 'soon' }), NOW).at, NOW)
  assert.equal(parseEvent(line({ ts: NOW - 2 * 24 * 3600 * 1000 }), NOW).at, NOW - 2 * 24 * 3600 * 1000, 'an old event stays old')
})

test('the script and the server agree on which events exist', async () => {
  const script = await import('../hooks/moon-base-hook.mjs')
  for (const tool of ['claude', 'codex']) assert.deepEqual([...script.EVENTS[tool]].sort(), [...EVENTS[tool]].sort(), tool)
})

// ── what each event means, per tool (AC6) ─────────────────────────────────────

test('Claude Code events map to running, awaiting, finished and errored', () => {
  assert.equal(stateFor('claude', { event: 'UserPromptSubmit' }), 'running')
  assert.equal(stateFor('claude', { event: 'PostToolUse' }), 'running')
  assert.equal(stateFor('claude', { event: 'PermissionRequest' }), 'awaiting')
  assert.equal(stateFor('claude', { event: 'Notification', notificationType: 'permission_prompt' }), 'awaiting')
  assert.equal(stateFor('claude', { event: 'Notification', notificationType: 'elicitation_dialog' }), 'awaiting')
  assert.equal(stateFor('claude', { event: 'Notification', notificationType: 'auth_success' }), null)
  assert.equal(stateFor('claude', { event: 'Stop' }), 'finished')
  assert.equal(stateFor('claude', { event: 'StopFailure' }), 'errored')
  assert.equal(stateFor('claude', { event: 'SessionEnd' }), 'ended')
})

test('Codex events map to running, awaiting and finished, and never to errored', () => {
  assert.equal(stateFor('codex', { event: 'UserPromptSubmit' }), 'running')
  assert.equal(stateFor('codex', { event: 'PostToolUse' }), 'running')
  assert.equal(stateFor('codex', { event: 'PermissionRequest' }), 'awaiting')
  assert.equal(stateFor('codex', { event: 'Stop' }), 'finished')
  assert.equal(stateFor('codex', { event: 'SessionEnd' }), 'ended')
  for (const event of ['StopFailure', 'Notification']) assert.equal(stateFor('codex', { event }), null, event)
})

// ── the overlay ───────────────────────────────────────────────────────────────

test('a running event marks the thread running, and says the status came from hooks', async () => {
  await withLive(async ({ live, emit }) => {
    await emit({ event: 'UserPromptSubmit' })
    await live.refresh()
    const [t] = live.overlay([{ ...claudeThread, hasError: true }])
    assert.equal(t.running, true)
    assert.equal(t.hasError, false, 'a new turn clears a stale error')
    assert.equal(t.liveSource, 'hooks')
    assert.equal(statusFor(t, NOW), 'working')
  })
})

test('a permission request is awaiting, and the next tool result puts it back to running', async () => {
  await withLive(async ({ live, emit }) => {
    await emit({ event: 'UserPromptSubmit' }, { event: 'PermissionRequest' })
    await live.refresh()
    let [t] = live.overlay([{ ...claudeThread, running: true }])
    assert.equal(t.running, false)
    assert.equal(t.unread, true)
    assert.equal(statusFor(t, NOW), 'waiting')

    await emit({ event: 'PostToolUse' })
    await live.refresh()
    ;[t] = live.overlay([claudeThread])
    assert.equal(t.running, true)
    assert.equal(statusFor(t, NOW), 'working')
  })
})

test('a finished turn is no longer running, and waits on you only if you have not looked since', async () => {
  await withLive(async ({ live, emit }) => {
    await emit({ event: 'Stop' }, { tool: 'codex', event: 'Stop' })
    await live.refresh()
    const [c, x] = live.overlay([
      { ...claudeThread, running: true, lastFocusedAt: NOW - 500 },
      { ...codexThread, running: true },
    ])
    assert.equal(c.running, false)
    assert.equal(c.unread, true, 'you last looked before it finished')
    assert.equal(x.unread, true, 'Codex records no focus history, so a fresh finish waits')
    const [looked] = live.overlay([{ ...claudeThread, lastFocusedAt: NOW + 1000 }])
    assert.equal(looked.unread, false, 'you looked after it finished')
  })
})

test('a stop-failure is an error, with no running', async () => {
  await withLive(async ({ live, emit }) => {
    await emit({ event: 'StopFailure' })
    await live.refresh()
    const [t] = live.overlay([{ ...claudeThread, running: true }])
    assert.equal(t.hasError, true)
    assert.equal(t.running, false)
    assert.equal(statusFor(t, NOW), 'blocked')
  })
})

test('a session end hands the thread back to what its files say', async () => {
  await withLive(async ({ live, emit }) => {
    await emit({ event: 'UserPromptSubmit' }, { event: 'SessionEnd' })
    await live.refresh()
    const [t] = live.overlay([claudeThread])
    assert.deepEqual(t, claudeThread)
    assert.equal(t.liveSource, undefined)
  })
})

test('an event colours only the tool it came from, even when the raw session id is shared', async () => {
  await withLive(async ({ live, emit }) => {
    await emit({ tool: 'codex', event: 'UserPromptSubmit' })
    await live.refresh()
    const [c, x] = live.overlay([claudeThread, codexThread])
    assert.equal(c.running, false)
    assert.equal(c.liveSource, undefined)
    assert.equal(x.running, true)
  })
})

test('a thread is matched through its ref as well as its id', async () => {
  await withLive(async ({ live, emit }) => {
    await emit({ event: 'UserPromptSubmit' })
    await live.refresh()
    const desktopKeyed = { ...claudeThread, id: 'claude-code:local_abc' }
    assert.equal(live.overlay([desktopKeyed])[0].running, true)
  })
})

test('the latest event for a session wins', async () => {
  await withLive(async ({ live, emit }) => {
    await emit({ event: 'UserPromptSubmit' }, { event: 'Stop' }, { event: 'UserPromptSubmit' }, { event: 'StopFailure' })
    await live.refresh()
    assert.equal(live.overlay([claudeThread])[0].hasError, true)
  })
})

// ── an event is only a hint (AC6, and the trust rule) ─────────────────────────

test('an event for a session nobody scanned creates no bot, and is forgotten', async () => {
  await withLive(async ({ live, emit, clock }) => {
    await emit({ sessionId: OTHER, event: 'UserPromptSubmit' })
    await live.refresh()
    const threads = [claudeThread, codexThread]
    assert.deepEqual(live.overlay(threads), threads, 'nothing added, nothing changed')
    assert.equal(live.size, 1, 'kept briefly, in case the scan has not caught up')
    clock.now += TTL.unknown + 1
    live.overlay(threads)
    assert.equal(live.size, 0, 'then dropped')
  })
})

test('a session that appears in the scan just after its first event picks the event up', async () => {
  await withLive(async ({ live, emit, clock }) => {
    await emit({ event: 'UserPromptSubmit' })
    await live.refresh()
    assert.equal(live.overlay([]).length, 0)
    clock.now += 10_000
    assert.equal(live.overlay([claudeThread])[0].running, true)
  })
})

// ── falling back (AC7) ────────────────────────────────────────────────────────

test('events that stop arriving stop counting: running expires and the files speak again', async () => {
  await withLive(async ({ live, emit, clock }) => {
    await emit({ event: 'UserPromptSubmit' })
    await live.refresh()
    const fromFiles = { ...claudeThread, running: false }
    assert.equal(live.overlay([fromFiles])[0].running, true)
    clock.now += TTL.running + 1
    const [t] = live.overlay([fromFiles])
    assert.deepEqual(t, fromFiles)
    assert.equal(t.liveSource, undefined)
  })
})

test('every state has a limit, and a finished turn stops waving after its own', async () => {
  await withLive(async ({ live, emit, clock }) => {
    await emit({ event: 'Stop' })
    await live.refresh()
    assert.equal(live.overlay([claudeThread])[0].unread, true)
    clock.now += TTL.finished + 1
    assert.equal(live.overlay([claudeThread])[0].unread, false)
  })
})

test('with no events file at all, nothing changes and nothing throws', async () => {
  await withLive(async ({ live }) => {
    await live.refresh()
    assert.deepEqual(live.overlay([claudeThread]), [claudeThread])
    assert.deepEqual(live.summary(), { active: false, tools: { 'claude-code': 0, codex: 0 } })
  })
})

test('the summary says which tools have reported lately', async () => {
  await withLive(async ({ live, emit, clock }) => {
    await emit({ tool: 'codex', event: 'Stop' })
    await live.refresh()
    assert.deepEqual(live.summary(), { active: true, tools: { 'claude-code': 0, codex: NOW } })
    clock.now += 11 * 60 * 1000
    assert.equal(live.summary().active, false)
  })
})

// ── reading the file ──────────────────────────────────────────────────────────

test('an event shows up on the very next read (AC6 latency is the poll interval, not the pipeline)', async () => {
  await withLive(async ({ live, emit }) => {
    await live.refresh()
    const started = Date.now()
    await emit({ event: 'UserPromptSubmit' })
    await live.refresh()
    assert.equal(live.overlay([claudeThread])[0].running, true)
    assert.ok(Date.now() - started < 200)
  })
})

test('after two scans at once, events appended next are not skipped', async () => {
  // The failure this guards: both readers start at the same offset and each advances it over the same
  // bytes, so the offset ends up past the end of what was read. Whatever is appended into that gap
  // afterwards is never seen.
  await withLive(async ({ live, emit }) => {
    const later = Array.from({ length: 5 }, (_, i) => `01a0dbe1-1111-7c61-999c-${String(i).padStart(12, '0')}`)
    await emit({ sessionId: SID, event: 'UserPromptSubmit' })
    await Promise.all([live.refresh(), live.refresh()])
    await emit(...later.map((sessionId) => ({ sessionId, event: 'UserPromptSubmit' })))
    await live.refresh()
    assert.equal(live.size, 1 + later.length, 'every appended event was read')
  })
})

test('two scans at once over a half-written line still end up with both events', async () => {
  // The failure this guards: both readers see the same tail, each glues the same half-line onto its
  // own chunk, and the whole line before it is swallowed into the garbage.
  await withLive(async ({ live, emit, file }) => {
    const a = line({ sessionId: SID, event: 'UserPromptSubmit' })
    const b = line({ sessionId: OTHER, event: 'UserPromptSubmit' })
    await fsp.writeFile(file, `${a}\n${b.slice(0, 40)}`, { mode: 0o600 })
    await Promise.all([live.refresh(), live.refresh()])
    await fsp.appendFile(file, `${b.slice(40)}\n`)
    await live.refresh()
    const other = { ...claudeThread, id: `claude-code:${OTHER}`, ref: { cliSessionId: OTHER } }
    const [first, second] = live.overlay([claudeThread, other])
    assert.equal(first.running, true, 'the complete event was kept')
    assert.equal(second.running, true, 'and the half-written one arrived whole')
  })
})

test('many scans of a growing file end up knowing every session', async () => {
  await withLive(async ({ live, emit, file }) => {
    const ids = Array.from({ length: 60 }, (_, i) => `01a0dbe1-0000-7c61-999c-${String(i).padStart(12, '0')}`)
    let expected = 0
    for (let round = 0; round < 10; round++) {
      const batch = ids.slice(round * 6, round * 6 + 6)
      await emit(...batch.map((sessionId) => ({ sessionId, event: 'UserPromptSubmit' })))
      expected += batch.length
      // Several readers at once, while the file is growing.
      await Promise.all([live.refresh(), live.refresh(), live.refresh(), live.refresh()])
      assert.equal(live.size, expected, `after round ${round}`)
    }
    // And every session is present and running, not merely counted.
    const threads = ids.map((id) => ({ ...claudeThread, id: `claude-code:${id}`, ref: { cliSessionId: id } }))
    assert.ok(live.overlay(threads).every((t) => t.running === true))
    assert.equal(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 60)
  })
})

test('a half-written line waits for its newline', async () => {
  await withLive(async ({ live, emit, file }) => {
    const whole = line({ event: 'UserPromptSubmit' })
    await fsp.writeFile(file, whole.slice(0, 40), { mode: 0o600 })
    await live.refresh()
    assert.equal(live.overlay([claudeThread])[0].running, false)
    await fsp.appendFile(file, whole.slice(40) + '\n')
    await live.refresh()
    assert.equal(live.overlay([claudeThread])[0].running, true)
  })
})

test('garbage lines are skipped without losing the good ones around them', async () => {
  await withLive(async ({ live, emit }) => {
    await emit('not json', { event: 'UserPromptSubmit' }, '{ "half": ', line({ sessionId: '../x' }), { tool: 'codex', event: 'Stop' })
    await live.refresh()
    const [c, x] = live.overlay([claudeThread, codexThread])
    assert.equal(c.running, true)
    assert.equal(x.liveSource, 'hooks')
  })
})

test('a replaced or truncated file is read again from its start', async () => {
  await withLive(async ({ live, emit, file }) => {
    await emit({ event: 'UserPromptSubmit' }, { event: 'PostToolUse' }, { event: 'PostToolUse' })
    await live.refresh()
    await fsp.rm(file)
    await fsp.writeFile(file, line({ event: 'StopFailure' }) + '\n', { mode: 0o600 })
    await live.refresh()
    assert.equal(live.overlay([claudeThread])[0].hasError, true)
  })
})

test('a file that grows past its limit is rotated aside and events keep flowing', async () => {
  await withLive(
    async ({ live, emit, file }) => {
      await emit({ event: 'UserPromptSubmit' }, { event: 'PostToolUse' }, { event: 'PostToolUse' })
      await live.refresh()
      assert.equal(fs.existsSync(`${file}.1`), true)
      assert.equal(fs.existsSync(file), false)
      await emit({ event: 'Stop' })
      await live.refresh()
      assert.equal(live.overlay([{ ...claudeThread, running: true }])[0].running, false)
    },
    { maxBytes: 200 }
  )
})

test('the first read replays recent events and ignores old ones', async () => {
  await withLive(async ({ live, emit }) => {
    await emit({ sessionId: OTHER, ts: NOW - 11 * 60 * 1000 }, { event: 'UserPromptSubmit', ts: NOW - 60 * 1000 })
    await live.refresh()
    assert.equal(live.overlay([claudeThread])[0].running, true)
    assert.equal(live.size, 1, 'the eleven-minute-old event was not replayed')
  })
})

test('a file or directory other users can write to is not trusted', async () => {
  await withLive(async ({ live, emit, file, dir }) => {
    await emit({ event: 'UserPromptSubmit' })
    await fsp.chmod(file, 0o666)
    await live.refresh()
    assert.equal(live.overlay([claudeThread])[0].running, false, 'world-writable file')
    await fsp.chmod(file, 0o600)
    await fsp.chmod(dir, 0o777)
    await live.refresh()
    assert.equal(live.overlay([claudeThread])[0].running, false, 'world-writable directory')
    await fsp.chmod(dir, 0o700)
    await live.refresh()
    assert.equal(live.overlay([claudeThread])[0].running, true, 'trusted again once it is private')
  })
})
