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

import { SESSION_ID, line, fakeCodex, listing } from './support/fixtures.mjs'
import { withServer } from './support/with-server.mjs'

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

process.env.HOME = path.join(scratch, 'home')
process.env.CLAUDE_CONFIG_DIR = path.join(scratch, 'claude-config') // no Claude Code on this machine
process.env.MOON_BASE_CLAUDE_DESKTOP = path.join(scratch, 'claude-desktop')
process.env.CODEX_HOME = codexHome
process.env.MOON_BASE_HOME = moonHome

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

test.after(async () => {
  for (const dir of [codexHome, scratch]) await fsp.rm(dir, { recursive: true, force: true })
})
