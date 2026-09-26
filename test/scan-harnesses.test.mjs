/**
 * AC1: both tools are discovered together, each session is exactly one bot with a unique,
 * prefixed id, and a malformed file costs that file and nothing else.
 *
 * Both installs are faked on disk. The env is set before `scan.mjs` is first imported, because the
 * adapters read their store locations once, at load — which is why this lives in its own file.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { SESSION_ID, line, fakeCodex, fakeClaude, typed } from './support/fixtures.mjs'

const OTHER_ID = '3aa4f2d1-7b0c-4e3a-9c55-1d2e3f4a5b6c'

// Claude Code: a transcript the desktop app also has a record for, a desktop-only record, and
// a record file that is not JSON.
const claude = await fakeClaude({
  transcript: [typed('build the base')],
  records: [
    {
      sessionId: `local_${SESSION_ID}`,
      cliSessionId: SESSION_ID,
      cwd: '/tmp/demo',
      title: 'Build the base',
      createdAt: 1,
      lastActivityAt: Date.now(),
      lastFocusedAt: 1,
    },
    {
      sessionId: `local_${OTHER_ID}`,
      cwd: '/tmp/other',
      title: 'Desktop only',
      createdAt: 1,
      lastActivityAt: Date.now(),
      lastFocusedAt: 1,
    },
  ],
})
await fsp.writeFile(path.join(claude.org, 'local_broken.json'), '{ nope')
await fsp.appendFile(path.join(claude.configDir, 'projects', '-tmp-demo', `${SESSION_ID}.jsonl`), 'not json\n')

// Codex: one rollout that reuses the very same raw id as the Claude session, with junk lines in it.
const codexHome = await fakeCodex([
  'not json at all',
  line('session_meta', { id: SESSION_ID, cwd: '/tmp/demo' }),
  line('response_item', { type: 'message', role: 'user', content: 'ship the base' }),
])

const emptyHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'scan-home-'))
process.env.HOME = emptyHome
process.env.CLAUDE_CONFIG_DIR = claude.configDir
process.env.MOON_BASE_CLAUDE_DESKTOP = claude.desktop
process.env.CODEX_HOME = codexHome

const { scanThreads } = await import('../server/scan.mjs')
const threads = await scanThreads()

test('sessions from both tools are found', () => {
  assert.deepEqual([...new Set(threads.map((t) => t.harness))].sort(), ['claude-code', 'codex'])
  assert.equal(threads.filter((t) => t.harness === 'claude-code').length, 2)
  assert.equal(threads.filter((t) => t.harness === 'codex').length, 1)
})

test('every id is unique and carries its tool as a prefix', () => {
  const ids = threads.map((t) => t.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const t of threads) assert.match(t.id, new RegExp(`^${t.harness}:`), t.id)
})

test('one raw session id in both tools stays two different bots', () => {
  const ids = threads.map((t) => t.id)
  assert.ok(ids.includes(`claude-code:${SESSION_ID}`))
  assert.ok(ids.includes(`codex:${SESSION_ID}`))
})

test('a desktop record and its transcript are one bot, not two', () => {
  assert.equal(threads.filter((t) => t.id === `claude-code:${SESSION_ID}`).length, 1)
})

test('malformed files are skipped without losing the rest of the scan', () => {
  const codexThread = threads.find((t) => t.harness === 'codex')
  assert.equal(codexThread.preview, 'ship the base')
  assert.ok(threads.some((t) => t.title === 'Desktop only'))
})

test.after(async () => {
  for (const dir of [claude.root, codexHome, emptyHome]) await fsp.rm(dir, { recursive: true, force: true })
})
