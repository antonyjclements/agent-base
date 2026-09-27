/**
 * The harness seam: what an adapter is allowed to hand back, and the two things the colony has
 * historically got wrong about a thread — which repo it belongs to, and whether it is working.
 *
 * Fixture-driven. Nothing here reads a real harness, so it says the same thing on any machine.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { HARNESSES } from '../server/harnesses/index.mjs'
import codex from '../server/harnesses/codex.mjs'
import claudeCode from '../server/harnesses/claude-code.mjs'
import { readTail } from '../server/lib/fsutil.mjs'
import { schemeOf } from '../server/lib/xdg.mjs'
import { SESSION_ID, line, fakeCodex, scanWith, fakeClaude, claudeWith, typed, listing, writeMarker } from './support/fixtures.mjs'


// ── the contract ──────────────────────────────────────────────────────────────

test('every registered harness implements the interface, and none of them can write', () => {
  for (const h of HARNESSES) {
    assert.match(h.id, /^[a-z0-9-]+$/, `${h.id} is not a kebab-case id`)
    assert.equal(typeof h.name, 'string')
    for (const fn of ['detect', 'scanThreads', 'openThread', 'newSession']) {
      assert.equal(typeof h[fn], 'function', `${h.id} is missing ${fn}()`)
    }
    // The one rule the project will not bend on. An adapter that grows a write is a bug.
    assert.equal(h.setArchived, undefined, `${h.id} must not write to its harness`)
  }
})

test('harness ids are unique, and so are the id prefixes they hand out', () => {
  const ids = HARNESSES.map((h) => h.id)
  assert.equal(new Set(ids).size, ids.length)
})

// ── ids are prefixed, and refs from the page are not trusted ──────────────────

test('a session id that merely stringifies to a UUID is refused', async () => {
  // `RegExp.test` coerces, so an array holding a valid id passes the pattern and then travels on
  // as an array. Both adapters check the type first.
  const uuid = '2df3987c-02d3-405e-b8f5-da30e3835213'
  assert.equal((await claudeCode.openThread({ cliSessionId: [uuid] })).ok, false)
  assert.equal((await claudeCode.openThread({ desktopSessionId: { toString: () => `local_${uuid}` } })).ok, false)
  assert.equal((await codex.openThread({ sessionId: [uuid] })).ok, false)
  assert.equal((await codex.openThread({})).ok, false)
  assert.equal((await codex.openThread(null)).ok, false)
})

test('codex opens through the registered scheme and prefixes its ids', async () => {
  const id = '019cc762-45a2-7112-89cd-cd345c17e834'
  const opened = await codex.openThread({ sessionId: id })
  assert.equal(opened.ok, true)
  assert.equal(schemeOf(opened.url), 'codex')
  assert.equal(opened.url, `codex://threads/${id}`)
})

// ── URL schemes only: an adapter never offers a command to run ────────────────

test('adapters answer with a URL and never a command or a pid', async () => {
  const cli = '2df3987c-02d3-405e-b8f5-da30e3835213'
  const answers = [
    await claudeCode.openThread({ cliSessionId: cli, cwd: '/tmp/demo' }),
    await claudeCode.openThread({ desktopSessionId: `local_${cli}` }),
    await claudeCode.newSession('/tmp/demo'),
    await codex.openThread({ sessionId: SESSION_ID, cwd: '/tmp/demo' }),
    await codex.newSession('/tmp/demo'),
  ]
  for (const answer of answers) {
    assert.equal(answer.ok, true)
    assert.match(answer.url, /^(claude|codex):\/\//)
    assert.deepEqual(Object.keys(answer).sort(), ['ok', 'url'], 'nothing else to run or to focus')
  }
})

// ── a Codex install, faked on disk ────────────────────────────────────────────

test('a CLI-only Codex session is found with no database at all', async () => {
  const home = await fakeCodex([
    line('session_meta', { id: SESSION_ID, cwd: '/tmp/demo', git: { branch: 'main' } }),
    line('turn_context', { model: 'gpt-5.3-codex', effort: 'high' }),
    line('response_item', { type: 'message', role: 'user', content: [{ text: 'ship the thing' }] }),
    line('event_msg', { type: 'task_complete' }),
  ])
  const h = await scanWith(home)
  assert.equal(await h.detect(), true)
  const [t] = await h.scanThreads()
  assert.equal(t.id, `codex:${SESSION_ID}`, 'ids are prefixed')
  assert.equal(t.project, 'demo')
  assert.equal(t.model, 'gpt-5.3-codex')
  assert.equal(t.effort, 'high')
  assert.equal(t.gitBranch, 'main')
  assert.equal(t.preview, 'ship the thing')
  assert.ok(t.sizeBytes > 0, 'sizeBytes is transcript bytes, not a token count')
  assert.equal(t.running, false)
  assert.deepEqual(t.ref, { sessionId: SESSION_ID, cwd: '/tmp/demo' }, 'ref carries the cwd the CLI resumes in')
  await fsp.rm(home, { recursive: true, force: true })
})

/**
 * A `state_N.sqlite` beside the rollouts, shaped like the columns the adapter probes for. Only the
 * columns a test cares about are created: the adapter names a column only if it is there.
 */
async function withThreadIndex(home, rows, spawnEdges = []) {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(path.join(home, 'state_5.sqlite'))
  db.exec(
    'CREATE TABLE threads (id TEXT PRIMARY KEY, cwd TEXT, title TEXT, model TEXT, reasoning_effort TEXT, git_branch TEXT, archived INTEGER, created_at_ms INTEGER, updated_at_ms INTEGER)'
  )
  db.exec('CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT, status TEXT)')
  const insert = db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  for (const r of rows) insert.run(r.id, r.cwd ?? '/tmp/demo', r.title, r.model, r.effort, r.branch ?? 'main', r.archived ? 1 : 0, 1, 2)
  for (const child of spawnEdges) db.prepare('INSERT INTO thread_spawn_edges VALUES (?, ?, ?)').run(SESSION_ID, child, 'done')
  db.close()
}

test("the thread index supplies a Codex session's title, model, effort and branch", async () => {
  const home = await fakeCodex([
    line('session_meta', { id: SESSION_ID, cwd: '/tmp/demo' }),
    line('response_item', { type: 'message', role: 'user', content: 'plain first prompt' }),
  ])
  await withThreadIndex(home, [{ id: SESSION_ID, title: 'Titled in the database', model: 'gpt-5.5', effort: 'high', branch: 'feature' }])
  const [t] = await (await scanWith(home)).scanThreads()
  assert.equal(t.title, 'Titled in the database')
  assert.equal(t.model, 'gpt-5.5')
  assert.equal(t.effort, 'high')
  assert.equal(t.gitBranch, 'feature')
  assert.equal(t.archived, false)
  await fsp.rm(home, { recursive: true, force: true })
})

test('a thread archived in Codex is reported archived, and the database is never written', async () => {
  const home = await fakeCodex([line('session_meta', { id: SESSION_ID, cwd: '/tmp/demo' })])
  await withThreadIndex(home, [{ id: SESSION_ID, title: 'Old work', model: 'm', effort: 'low', archived: true }])
  const before = await listing(home)
  const [t] = await (await scanWith(home)).scanThreads()
  assert.equal(t.archived, true)
  assert.deepEqual(await listing(home), before, 'the scan leaves the database alone')
  await fsp.rm(home, { recursive: true, force: true })
})

test('a thread a task spawned is not a conversation, so it stays off the map', async () => {
  const CHILD = '019cc762-45a2-7112-89cd-cd345c17e999'
  const home = await fakeCodex([line('session_meta', { id: SESSION_ID, cwd: '/tmp/demo' })])
  const day = path.join(home, 'sessions', '2026', '09', '07')
  await fsp.writeFile(path.join(day, `rollout-2026-09-07T12-05-00-${CHILD}.jsonl`), line('session_meta', { id: CHILD, cwd: '/tmp/demo' }) + '\n')
  await withThreadIndex(
    home,
    [
      { id: SESSION_ID, title: 'Parent', model: 'm', effort: 'low' },
      { id: CHILD, title: 'Child', model: 'm', effort: 'low' },
    ],
    [CHILD]
  )
  const threads = await (await scanWith(home)).scanThreads()
  assert.deepEqual(threads.map((t) => t.id), [`codex:${SESSION_ID}`])
  await fsp.rm(home, { recursive: true, force: true })
})

test('an interrupted turn is not an error — escape must not redden an astronaut', async () => {
  const home = await fakeCodex([
    line('session_meta', { id: SESSION_ID, cwd: '/tmp/demo' }),
    line('event_msg', { type: 'task_started' }),
    line('event_msg', { type: 'turn_aborted' }),
  ])
  const h = await scanWith(home)
  const [t] = await h.scanThreads()
  assert.equal(t.hasError, false)
  assert.equal(t.running, false, 'an aborted turn is not still running')
  await fsp.rm(home, { recursive: true, force: true })
})

test('a task started long ago is not still running', async () => {
  const home = await fakeCodex([
    line('session_meta', { id: SESSION_ID, cwd: '/tmp/demo' }),
    line('event_msg', { type: 'task_started' }),
  ])
  const day = path.join(home, 'sessions', '2026', '09', '07')
  const [file] = await fsp.readdir(day)
  const old = new Date(Date.now() - 6 * 60 * 60 * 1000)
  await fsp.utimes(path.join(day, file), old, old)
  const h = await scanWith(home)
  const [t] = await h.scanThreads()
  assert.equal(t.running, false, 'Codex writes nothing when killed, so the window has to bound it')
  await fsp.rm(home, { recursive: true, force: true })
})

test('malformed records are skipped rather than throwing the scan away', async () => {
  const home = await fakeCodex([
    'not json at all',
    '{"half": ',
    line('session_meta', { id: SESSION_ID, cwd: '/tmp/demo' }),
    line('response_item', { type: 'message', role: 'user', content: 'hello' }),
  ])
  const h = await scanWith(home)
  const threads = await h.scanThreads()
  assert.equal(threads.length, 1)
  assert.equal(threads[0].preview, 'hello')
  await fsp.rm(home, { recursive: true, force: true })
})

test('an absent Codex is simply not detected', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-empty-'))
  const h = await scanWith(home)
  assert.equal(await h.detect(), false)
  assert.deepEqual(await h.scanThreads(), [])
  await fsp.rm(home, { recursive: true, force: true })
})

// ── subagents ─────────────────────────────────────────────────────────────────

/**
 * A Claude Code home with one live CLI session and one subagent under it. The pid is this
 * process's own, which is the only pid a test can be sure is alive when the scan probes it.
 */
async function fakeClaudeWithErrands(errandRecords) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-home-'))
  const session = '11111111-2222-4333-8444-555555555555'
  const project = path.join(home, '.claude', 'projects', '-tmp-demo')
  await fsp.mkdir(path.join(project, session, 'subagents'), { recursive: true })
  await fsp.mkdir(path.join(home, '.claude', 'sessions'), { recursive: true })
  await fsp.writeFile(
    path.join(project, `${session}.jsonl`),
    `${JSON.stringify({ type: 'user', cwd: '/tmp/demo', message: { content: 'build the thing' } })}\n`
  )
  await fsp.writeFile(
    path.join(home, '.claude', 'sessions', `${process.pid}.json`),
    JSON.stringify({ pid: process.pid, sessionId: session, cwd: '/tmp/demo', status: 'busy' })
  )
  await fsp.writeFile(
    path.join(project, session, 'subagents', 'agent-abc.jsonl'),
    errandRecords.map((r) => `${JSON.stringify(r)}\n`).join('')
  )
  return home
}

async function claudeWithErrands(home) {
  process.env.HOME = home
  const mod = await import(`../server/harnesses/claude-code.mjs?${home}`)
  return mod.default
}

const midTurn = { type: 'assistant', message: { content: [{ type: 'tool_use' }], stop_reason: 'tool_use' } }

test('a running subagent is reported with the brief it was given, however long that is', async () => {
  const realHome = process.env.HOME
  // Longer than any head this could reasonably read at once: a brief that is truncated away
  // yields no task at all, because readHead drops the line it lands in the middle of.
  const brief = `repair the raster pipeline ${'x'.repeat(20 * 1024)}`
  const home = await fakeClaudeWithErrands([{ type: 'user', message: { content: brief } }, midTurn])
  const h = await claudeWithErrands(home)
  const [thread] = await h.scanThreads()
  assert.equal(thread.subagents?.length, 1)
  assert.equal(thread.subagents[0].id, 'agent-abc')
  assert.match(thread.subagents[0].task, /^repair the raster pipeline/)
  process.env.HOME = realHome
  await fsp.rm(home, { recursive: true, force: true })
})

test('a subagent that has handed its answer back is finished, however recently it wrote', async () => {
  const realHome = process.env.HOME
  const home = await fakeClaudeWithErrands([
    { type: 'user', message: { content: 'summarise the diff' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'here it is' }], stop_reason: 'end_turn' } },
  ])
  const h = await claudeWithErrands(home)
  const [thread] = await h.scanThreads()
  assert.equal(thread.subagents, undefined, 'a finished errand is not an astronaut on the map')
  process.env.HOME = realHome
  await fsp.rm(home, { recursive: true, force: true })
})

// ── shared helpers ────────────────────────────────────────────────────────────

test('readTail drops the partial line it lands in the middle of', async () => {
  const f = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'tail-')), 'x.jsonl')
  await fsp.writeFile(f, 'first line\nsecond line\nthird line\n')
  assert.equal(await readTail(f, 15), 'third line\n')
  assert.equal(await readTail(f, 1000), 'first line\nsecond line\nthird line\n')
})

// ── Claude Code, faked on disk ────────────────────────────────────────────────

test('a thread deleted in the desktop app is reported archived, not dropped', async () => {
  const fx = await fakeClaude({ transcript: [typed('tidy the ledger')] })
  const h = await claudeWith(fx)
  assert.equal(await h.detect(), true)
  const [before] = await h.scanThreads()
  assert.equal(before.id, `claude-code:${SESSION_ID}`)
  assert.equal(before.source, 'cli', 'with no record, the transcript reads as terminal-started')
  assert.equal(before.archived, false)

  // Deleting in the app removes the record and leaves `deleted_<cliSessionId>`; the transcript stays.
  await fsp.writeFile(path.join(fx.org, `deleted_${SESSION_ID}`), String(Date.now()))
  const files = await listing(fx.root)
  const [after] = await h.scanThreads()
  assert.equal(after.archived, true, 'noticed on the next poll, no restart')
  assert.equal(after.title, 'tidy the ledger', 'still a thread, so the colony sends it home rather than losing it')
  assert.deepEqual(await listing(fx.root), files, 'the marker is read and never tidied — the adapter does not write')
  await fsp.rm(fx.root, { recursive: true, force: true })
})

test('a record the app still holds outranks a leftover deletion marker', async () => {
  // Resuming a deleted transcript makes the app write a fresh record; the marker stays behind.
  const fx = await fakeClaude({
    transcript: [typed('bring it back')],
    records: [
      {
        sessionId: 'local_2df3987c-02d3-405e-b8f5-da30e3835213',
        cliSessionId: SESSION_ID,
        cwd: '/tmp/demo',
        title: 'Back again',
        createdAt: 1,
        lastActivityAt: 2,
        lastFocusedAt: 3,
      },
    ],
    deleted: [SESSION_ID],
  })
  const h = await claudeWith(fx)
  const [t] = await h.scanThreads()
  assert.equal(t.source, 'desktop')
  assert.equal(t.title, 'Back again')
  assert.equal(t.archived, false, 'a record that exists is the newer truth')
  await fsp.rm(fx.root, { recursive: true, force: true })
})

// ── Claude's own busy/idle marker (AC14) ──────────────────────────────────────

/** A pid that is certainly gone: a child that ran and exited. */
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid

async function markerThread(marker) {
  const fx = await fakeClaude({ transcript: [typed('tidy the ledger')] })
  if (marker) await writeMarker(fx.configDir, marker)
  const h = await claudeWith(fx)
  const [thread] = await h.scanThreads()
  await fsp.rm(fx.root, { recursive: true, force: true })
  return thread
}

test('a live session carries the status Claude wrote for it, and when', async () => {
  const at = Date.now() - 4000
  assert.deepEqual(
    (({ markerStatus, markerAt }) => ({ markerStatus, markerAt }))(await markerThread({ status: 'busy', at })),
    { markerStatus: 'busy', markerAt: at }
  )
  assert.deepEqual(
    (({ markerStatus, markerAt }) => ({ markerStatus, markerAt }))(await markerThread({ status: 'idle', at })),
    { markerStatus: 'idle', markerAt: at }
  )
})

test('a marker that says nothing usable reads as no status, but the process is still alive', async () => {
  for (const extra of [{ status: undefined }, { status: 'waiting' }, { status: 5 }, { status: 'BUSY' }]) {
    const thread = await markerThread({ status: extra.status, extra })
    assert.equal(thread.markerStatus, '', JSON.stringify(extra))
  }
  const noTime = await markerThread({ status: 'busy', extra: { statusUpdatedAt: undefined, updatedAt: undefined } })
  assert.equal(noTime.markerStatus, 'busy')
  assert.equal(noTime.markerAt, 0)
})

test('a marker whose process is gone, or no marker at all, gives no status', async () => {
  const gone = await markerThread({ pid: deadPid(), status: 'busy' })
  assert.equal(gone.markerStatus, '')
  assert.equal(gone.markerAt, 0)
  const none = await markerThread(null)
  assert.equal(none.markerStatus, '')
  assert.equal(none.markerAt, 0)
})

test('a marker file that is not JSON is skipped, and the scan carries on', async () => {
  const fx = await fakeClaude({ transcript: [typed('tidy the ledger')] })
  await fsp.mkdir(path.join(fx.configDir, 'sessions'), { recursive: true })
  await fsp.writeFile(path.join(fx.configDir, 'sessions', '1.json'), '{ not json')
  await writeMarker(fx.configDir, { status: 'busy' })
  const h = await claudeWith(fx)
  const [thread] = await h.scanThreads()
  assert.equal(thread.markerStatus, 'busy')
  await fsp.rm(fx.root, { recursive: true, force: true })
})

test('two live processes for one session: the newer marker wins, and a tie goes to busy, whatever order the files are in', async () => {
  const SID = '11111111-2222-4333-8444-555555555555'
  const alive = [process.pid, process.ppid] // both are running, which is all a marker needs
  const cases = [
    // [what each of the two markers says, the answer]
    [[{ status: 'idle', at: 2000 }, { status: 'busy', at: 1000 }], { markerStatus: 'idle', markerAt: 2000 }],
    [[{ status: 'busy', at: 3000 }, { status: 'idle', at: 1000 }], { markerStatus: 'busy', markerAt: 3000 }],
    [[{ status: 'idle', at: 2000 }, { status: 'busy', at: 2000 }], { markerStatus: 'busy', markerAt: 2000 }],
    [[{ status: '', at: 0 }, { status: 'busy', at: 500 }], { markerStatus: 'busy', markerAt: 500 }],
  ]
  for (const [markers, expected] of cases) {
    for (const flip of [false, true]) {
      const fx = await fakeClaude({ transcript: [{ ...typed('x'), cwd: '/tmp/demo' }] })
      const ordered = flip ? [...markers].reverse() : markers
      for (const [i, m] of ordered.entries()) await writeMarker(fx.configDir, { pid: alive[i], sessionId: SESSION_ID, status: m.status, at: m.at })
      const h = await claudeWith(fx)
      const [thread] = await h.scanThreads()
      assert.deepEqual({ markerStatus: thread.markerStatus, markerAt: thread.markerAt }, expected, `${JSON.stringify(markers)} flip=${flip}`)
      await fsp.rm(fx.root, { recursive: true, force: true })
    }
  }
})
