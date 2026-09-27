/**
 * Live status through the real API (AC6, AC7): an event on disk shows up in `/api/threads` on the
 * very next request, the page is told hooks are reporting so it can poll faster, and an event never
 * adds a thread or touches the tool's own files.
 *
 * The env is set before anything under `server/` is imported: the adapters read their store
 * locations once, and the live status reads the events location on first use.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { SESSION_ID, SENTINEL, cmuxRow, line, fakeCodex, listing } from './support/fixtures.mjs'
import { withServer } from './support/with-server.mjs'
import { resetLiveStatus } from '../server/hooks/live.mjs'

const OTHER = '01a0dbe2-aaaa-7c61-999c-16e6243ba432'

const codexHome = await fakeCodex([
  line('session_meta', { id: SESSION_ID, cwd: '/tmp/demo' }),
  line('response_item', { type: 'message', role: 'user', content: 'hello' }),
])
const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), 'live-api-'))
const moonHome = path.join(scratch, 'moon-home')
const eventsDir = path.join(moonHome, 'events')
const eventsFile = path.join(eventsDir, 'events.jsonl')
await fsp.mkdir(eventsDir, { recursive: true, mode: 0o700 })
await fsp.chmod(eventsDir, 0o700)
const cmuxDir = path.join(scratch, 'cmuxterm')
const cmuxFile = path.join(cmuxDir, 'workstream.jsonl')
await fsp.mkdir(cmuxDir, { recursive: true, mode: 0o700 })
await fsp.chmod(cmuxDir, 0o700)

process.env.HOME = path.join(scratch, 'home')
process.env.CLAUDE_CONFIG_DIR = path.join(scratch, 'claude-config') // no Claude Code on this machine
process.env.MOON_BASE_CLAUDE_DESKTOP = path.join(scratch, 'claude-desktop')
process.env.CODEX_HOME = codexHome
process.env.MOON_BASE_HOME = moonHome
process.env.MOON_BASE_CMUX_DIR = cmuxDir

const emit = (o) =>
  fsp.appendFile(eventsFile, JSON.stringify({ v: 1, ts: Date.now(), tool: 'codex', sessionId: SESSION_ID, ...o }) + '\n', { mode: 0o600 })
const threads = async (call) => (await (await call('/api/threads')).json())
const codexThread = (body) => body.threads.find((t) => t.id === `codex:${SESSION_ID}`)

test('without any events, status is whatever the files say and nothing is live', async () => {
  await withServer(async ({ call }) => {
    const body = await threads(call)
    assert.equal(codexThread(body).running, false)
    assert.equal(codexThread(body).liveSource, undefined)
    assert.equal(body.live.active, false)
  })
})

test('an event shows on the next request, and the page is told hooks are reporting', async () => {
  await withServer(async ({ call }) => {
    await emit({ event: 'UserPromptSubmit' })
    const body = await threads(call)
    assert.equal(codexThread(body).running, true)
    assert.equal(codexThread(body).liveSource, 'hooks')
    assert.equal(body.live.active, true)
    assert.ok(body.live.tools.codex > 0)
    assert.equal(body.live.tools['claude-code'], 0)
  })
})

test('a permission request waits on you, and a finished turn stops running', async () => {
  await withServer(async ({ call }) => {
    await emit({ event: 'PermissionRequest' })
    let t = codexThread(await threads(call))
    assert.equal(t.running, false)
    assert.equal(t.unread, true)
    await emit({ event: 'PostToolUse' })
    assert.equal(codexThread(await threads(call)).running, true)
    await emit({ event: 'Stop' })
    t = codexThread(await threads(call))
    assert.equal(t.running, false)
    assert.equal(t.unread, true)
  })
})

test('an event for a session nobody has scanned adds no thread', async () => {
  await withServer(async ({ call }) => {
    const before = (await threads(call)).threads.length
    await emit({ sessionId: OTHER, event: 'UserPromptSubmit' })
    assert.equal((await threads(call)).threads.length, before)
  })
})

test('reading events writes nothing: the tool’s files are unchanged and no file is added beside the events', async () => {
  const before = await listing(codexHome)
  await withServer(async ({ call }) => {
    await emit({ event: 'UserPromptSubmit' })
    await threads(call)
  })
  assert.deepEqual(await listing(codexHome), before)
  assert.deepEqual(await fsp.readdir(eventsDir), ['events.jsonl'])
})

// ── cmux's stream, through the same API (AC14) ────────────────────────────────

const emitCmux = async (kind, extra = {}) => {
  await fsp.appendFile(cmuxFile, cmuxRow({ kind, source: 'codex', sessionId: SESSION_ID, at: Date.now() + 1000, ...extra }) + '\n')
  await fsp.chmod(cmuxFile, 0o644)
}

test('a cmux row shows on the next request, with no hook installed, and the page is told cmux is reporting', async () => {
  resetLiveStatus()
  await withServer(async ({ call }) => {
    await emitCmux('userPrompt')
    const body = await threads(call)
    assert.equal(codexThread(body).running, true)
    assert.equal(codexThread(body).liveSource, 'cmux')
    assert.equal(body.live.active, true)
    const cmux = body.live.sources.find((s) => s.id === 'cmux')
    assert.equal(cmux.present, true)
    assert.ok(cmux.lastAt > 0)
  })
})

test('a question in cmux waits on you, and the answer that follows turns it back to running', async () => {
  resetLiveStatus()
  await withServer(async ({ call }) => {
    await emitCmux('question', { at: Date.now() + 2000 })
    let t = codexThread(await threads(call))
    assert.equal(t.running, false)
    assert.equal(t.unread, true)
    await emitCmux('toolResult', { at: Date.now() + 4000 })
    t = codexThread(await threads(call))
    assert.equal(t.running, true)
  })
})

test('with MOON_BASE_CMUX_STATUS=off, cmux is not read and not mentioned', async () => {
  const before = process.env.MOON_BASE_CMUX_STATUS
  process.env.MOON_BASE_CMUX_STATUS = 'off'
  resetLiveStatus()
  try {
    await withServer(async ({ call }) => {
      await emitCmux('userPrompt', { at: Date.now() + 8000 })
      const body = await threads(call)
      assert.notEqual(codexThread(body).liveSource, 'cmux')
      assert.equal(body.live.sources.some((s) => s.id === 'cmux'), false)
    })
  } finally {
    if (before === undefined) delete process.env.MOON_BASE_CMUX_STATUS
    else process.env.MOON_BASE_CMUX_STATUS = before
    resetLiveStatus()
  }
})

test('nothing a cmux row says leaves the server: no endpoint returns any of its content', async () => {
  resetLiveStatus()
  await withServer(async ({ call }) => {
    await emitCmux('userPrompt', { at: Date.now() + 10000 })
    await emitCmux('permissionRequest', { at: Date.now() + 11000 })
    await threads(call)
    for (const p of ['/api/threads', '/api/harnesses', '/api/state', '/api/terminal-launcher']) {
      const text = await (await call(p)).text()
      assert.ok(!text.includes(SENTINEL), `${p} returned content from a cmux row`)
    }
  })
})

test('reading cmux’s stream writes nothing: its folder is exactly as cmux left it', async () => {
  resetLiveStatus()
  const before = await listing(cmuxDir)
  await withServer(async ({ call }) => {
    await threads(call)
    await threads(call)
  })
  assert.deepEqual(await listing(cmuxDir), before)
  assert.deepEqual(await fsp.readdir(cmuxDir), ['workstream.jsonl'])
})

test.after(async () => {
  for (const dir of [codexHome, scratch]) await fsp.rm(dir, { recursive: true, force: true })
})
