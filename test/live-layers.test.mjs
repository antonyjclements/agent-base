/**
 * AC14, the layering: hooks, cmux's stream and Claude's own busy/idle marker all lay over what the
 * adapters read from files. The newest signal for a session wins, every state expires back to the
 * files, and a signal can colour a bot that exists but never make one.
 *
 * `test/hook-events.test.mjs` covers the hook path on its own and passes unchanged, which is what
 * shows adding cmux did not move it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { cmuxRow, fakeCmux, SENTINEL } from './support/fixtures.mjs'
import { LiveStatus, TTL } from '../server/hooks/live.mjs'

const NOW = Date.UTC(2026, 8, 26, 12)
const SID = '2edc9798-ed07-4ec1-8e47-5a2d51565b92'
const OTHER = '01a0dbe2-aaaa-7c61-999c-16e6243ba432'
const MIN = 60 * 1000

const hookLine = (o) => JSON.stringify({ v: 1, ts: NOW, tool: 'claude', event: 'UserPromptSubmit', sessionId: SID, ...o })

async function withLayers(fn, { cmux = true } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'layers-'))
  await fsp.chmod(dir, 0o700)
  const hooksFile = path.join(dir, 'events.jsonl')
  const stream = await fakeCmux()
  const clock = { now: NOW }
  const live = new LiveStatus({ file: hooksFile, ...(cmux ? { cmuxFile: stream.file } : {}), now: () => clock.now })
  const hook = (...events) => fsp.appendFile(hooksFile, events.map((e) => hookLine(e)).join('\n') + '\n', { mode: 0o600 })
  const cm = (...rows) => stream.append(...rows.map((r) => (typeof r === 'string' ? r : cmuxRow({ sessionId: SID, at: clock.now, ...r }))))
  try {
    return await fn({ live, hook, cm, clock, stream })
  } finally {
    await stream.rm()
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

const base = { running: false, unread: false, hasError: false, prState: '', lastActivityAt: NOW - 1000, lastFocusedAt: NOW - 500 }
const claude = (extra = {}) => ({ ...base, id: `claude-code:${SID}`, harness: 'claude-code', ref: { cliSessionId: SID }, ...extra })
const codex = (extra = {}) => ({ ...base, id: `codex:${SID}`, harness: 'codex', ref: { sessionId: SID }, lastFocusedAt: 0, ...extra })

async function scan(live, threads) {
  await live.refresh()
  return live.overlay(threads)
}

// ── cmux rows colour a bot ────────────────────────────────────────────────────

test('a prompt in cmux turns the bot to running, and says where that came from', async () => {
  await withLayers(async ({ live, cm }) => {
    await cm({ kind: 'userPrompt' })
    const [t] = await scan(live, [claude()])
    assert.equal(t.running, true)
    assert.equal(t.liveSource, 'cmux')
  })
})

test('a question or permission request waits on you; the answer, then the stop, move it on', async () => {
  await withLayers(async ({ live, cm, clock }) => {
    await cm({ kind: 'question' })
    let [t] = await scan(live, [claude()])
    assert.equal(t.running, false)
    assert.equal(t.unread, true, 'it is waiting on you')

    clock.now += 5000
    await cm({ kind: 'toolResult' })
    ;[t] = await scan(live, [claude()])
    assert.equal(t.running, true, 'answered, so working again')

    clock.now += 5000
    await cm({ kind: 'stop' })
    ;[t] = await scan(live, [claude()])
    assert.equal(t.running, false)
    assert.equal(t.unread, true, 'finished after you last looked')
  })
})

test('the session ending makes cmux forget it', async () => {
  await withLayers(async ({ live, cm, clock }) => {
    await cm({ kind: 'userPrompt' })
    await scan(live, [claude()])
    assert.equal(live.size, 1)
    clock.now += 1000
    await cm({ kind: 'sessionEnd' })
    const [t] = await scan(live, [claude()])
    assert.equal(live.size, 0)
    assert.equal(t.running, false)
  })
})

test('Codex rows work the same way, by the same mapping', async () => {
  await withLayers(async ({ live, cm }) => {
    await cm({ kind: 'toolUse', source: 'codex' })
    const [t] = await scan(live, [codex()])
    assert.equal(t.running, true)
    assert.equal(t.liveSource, 'cmux')
  })
})

// ── several sources at once ───────────────────────────────────────────────────

test('the newest signal wins, whichever source it came from and in whichever order it was read', async () => {
  await withLayers(async ({ live, hook, cm, clock }) => {
    // Read the older one second: an old cmux row must not put back what a newer hook event changed.
    await hook({ event: 'Stop', ts: NOW + 2000 })
    await cm({ kind: 'toolUse', at: NOW + 1000 })
    clock.now = NOW + 3000
    let [t] = await scan(live, [claude()])
    assert.equal(t.running, false, 'the hook stop at +2s is newer than the cmux row at +1s')
    assert.equal(t.liveSource, 'hooks')

    // And the other way: a newer cmux row beats an older hook event.
    await cm({ kind: 'userPrompt', at: NOW + 3000 })
    ;[t] = await scan(live, [claude()])
    assert.equal(t.running, true)
    assert.equal(t.liveSource, 'cmux')
  })
})

test('an event that is older than what is already known is ignored', async () => {
  await withLayers(async ({ live, hook, clock }) => {
    await hook({ event: 'Stop', ts: NOW })
    clock.now = NOW + 1000
    await live.refresh()
    await hook({ event: 'UserPromptSubmit', ts: NOW - 5000 }) // arrives late, happened earlier
    let [t] = await scan(live, [claude()])
    assert.equal(t.running, false)
  }, { cmux: false })
})

test('a session that has ended stays ended against an older event that is read afterwards', async () => {
  await withLayers(async ({ live, hook, cm, clock }) => {
    // The hooks file is read first, so the end is known before the older cmux row arrives.
    await hook({ event: 'SessionEnd', ts: NOW + 2000 })
    await cm({ kind: 'toolUse', at: NOW + 1000 })
    clock.now = NOW + 3000
    const [t] = await scan(live, [claude()])
    assert.equal(t.running, false, 'the end at +2s is newer than the row at +1s')
    assert.equal(live.size, 0, 'and the old row made no entry for it')
  })
})

test('an end read from cmux is remembered against an older hook event read in a later poll', async () => {
  await withLayers(async ({ live, hook, cm, clock }) => {
    await cm({ kind: 'sessionEnd', at: NOW + 2000 })
    clock.now = NOW + 3000
    await live.refresh()
    await hook({ event: 'PostToolUse', ts: NOW + 1000 }) // written late, happened before the end
    const [t] = await scan(live, [claude()])
    assert.equal(t.running, false)
    assert.equal(live.size, 0)
  })
})

test('an event newer than the end brings the session back, as when it is resumed', async () => {
  await withLayers(async ({ live, hook, cm, clock }) => {
    await hook({ event: 'SessionEnd', ts: NOW + 2000 })
    await cm({ kind: 'userPrompt', at: NOW + 4000 })
    clock.now = NOW + 5000
    const [t] = await scan(live, [claude()])
    assert.equal(t.running, true)
    assert.equal(t.liveSource, 'cmux')
    // ...and once it is back, an event from before it ended is still older than what is known.
    await cm({ kind: 'stop', at: NOW + 1000 })
    const [again] = await scan(live, [claude()])
    assert.equal(again.running, true)
  })
})

test('every state expires, and the files decide again', async () => {
  await withLayers(async ({ live, cm, clock }) => {
    await cm({ kind: 'userPrompt' })
    let [t] = await scan(live, [claude()])
    assert.equal(t.running, true)
    clock.now = NOW + TTL.running + MIN
    ;[t] = await scan(live, [claude()])
    assert.equal(t.running, false)
    assert.equal(t.liveSource, undefined)
  })
})

test('a signal for a session nobody has scanned is held briefly, then dropped, and never makes a bot', async () => {
  await withLayers(async ({ live, cm, clock }) => {
    await cm({ kind: 'userPrompt', sessionId: OTHER })
    let out = await scan(live, [claude()])
    assert.equal(out.length, 1, 'no bot was added')
    assert.equal(live.size, 1, 'held in case the scan is a step behind')
    clock.now = NOW + TTL.unknown + 1000
    out = await scan(live, [claude()])
    assert.equal(out.length, 1)
    assert.equal(live.size, 0, 'forgotten')
  })
})

test('a cmux row only touches the tool it names', async () => {
  await withLayers(async ({ live, cm }) => {
    await cm({ kind: 'userPrompt', source: 'codex' })
    const [c, x] = await scan(live, [claude(), codex()])
    assert.equal(c.running, false, 'the Claude thread with the same id is not the Codex one')
    assert.equal(x.running, true)
  })
})

// ── Claude's own marker ───────────────────────────────────────────────────────

test('a busy marker means running, an idle one adds nothing, and only Claude has one', async () => {
  await withLayers(async ({ live }) => {
    let [t] = await scan(live, [claude({ markerStatus: 'busy', markerAt: NOW - 1000 })])
    assert.equal(t.running, true)
    assert.equal(t.liveSource, 'claude')

    ;[t] = await scan(live, [claude({ markerStatus: 'idle', markerAt: NOW - 1000 })])
    assert.equal(t.running, false)
    assert.equal(t.liveSource, undefined)

    ;[t] = await scan(live, [claude({ markerStatus: '', markerAt: 0 })])
    assert.equal(t.running, false)

    ;[t] = await scan(live, [codex({ markerStatus: 'busy', markerAt: NOW - 1000 })])
    assert.equal(t.running, false, 'a Codex thread has no Claude marker')
  })
})

test('the marker and an event compete on time', async () => {
  await withLayers(async ({ live, cm, clock }) => {
    await cm({ kind: 'stop', at: NOW - 500 })
    clock.now = NOW
    let [t] = await scan(live, [claude({ markerStatus: 'busy', markerAt: NOW - 5000 })])
    assert.equal(t.running, false, 'the stop is newer than the busy stamp')
    assert.equal(t.liveSource, 'cmux')

    ;[t] = await scan(live, [claude({ markerStatus: 'busy', markerAt: NOW - 100 })])
    assert.equal(t.running, true, 'a new turn began after the stop')
    assert.equal(t.liveSource, 'claude')
  })
})

test('a busy marker does not expire on its own: a long turn is still a turn', async () => {
  await withLayers(async ({ live, clock }) => {
    clock.now = NOW + 3 * 60 * MIN
    const [t] = await scan(live, [claude({ markerStatus: 'busy', markerAt: NOW })])
    assert.equal(t.running, true)
  })
})

// ── the switch, and what the page is told ─────────────────────────────────────

test('with no cmux stream configured, the file is never read and the page hears nothing of cmux', async () => {
  await withLayers(async ({ live, cm }) => {
    await cm({ kind: 'userPrompt' }) // a row that would turn the bot to running if anything read it
    const [t] = await scan(live, [claude()])
    assert.equal(t.running, false)
    assert.equal(t.liveSource, undefined)
    assert.deepEqual(live.summary().sources.map((s) => s.id), ['hooks'])
  }, { cmux: false })
})

test('the page is told which sources exist and when each last reported', async () => {
  await withLayers(async ({ live, hook, cm, clock }) => {
    let s = live.summary()
    assert.deepEqual(s.sources, [
      { id: 'hooks', present: false, lastAt: 0 },
      { id: 'cmux', present: false, lastAt: 0 },
    ])
    assert.equal(s.active, false)

    await cm({ kind: 'userPrompt', at: NOW - 1000 })
    await live.refresh()
    s = live.summary()
    assert.deepEqual(s.sources.find((x) => x.id === 'cmux'), { id: 'cmux', present: true, lastAt: NOW - 1000 })
    assert.equal(s.active, true, 'cmux alone is enough to poll faster')
    assert.equal(s.tools['claude-code'], NOW - 1000)
    assert.equal(s.tools.codex, 0)

    await hook({ tool: 'codex', event: 'Stop', ts: NOW - 500 })
    await live.refresh()
    s = live.summary()
    assert.equal(s.tools.codex, NOW - 500)
    assert.equal(s.sources.find((x) => x.id === 'hooks').lastAt, NOW - 500)

    clock.now = NOW + 11 * MIN
    assert.equal(live.summary().active, false, 'nothing said anything for ten minutes')
  })
})

test('a cmux source that is present but silent is still listed, so the chip can say it is quiet', async () => {
  await withLayers(async ({ live, stream }) => {
    await stream.append('not a row')
    await live.refresh()
    assert.deepEqual(live.summary().sources.find((x) => x.id === 'cmux'), { id: 'cmux', present: true, lastAt: 0 })
  })
})

test('nothing from a row’s content is in what the page is told or in the threads', async () => {
  await withLayers(async ({ live, cm }) => {
    await cm({ kind: 'userPrompt' }, { kind: 'permissionRequest' }, { kind: 'question' })
    const out = await scan(live, [claude()])
    assert.ok(!JSON.stringify(out).includes(SENTINEL))
    assert.ok(!JSON.stringify(live.summary()).includes(SENTINEL))
  })
})
