/**
 * AC3: Moon Base never modifies a tool's session data. A full scan and every read or write route
 * leave both installs byte-for-byte alone; the colony's own state file is the only thing written.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { SESSION_ID, line, fakeCodex, fakeClaude, typed, listing } from './support/fixtures.mjs'
import { withServer } from './support/with-server.mjs'

const claude = await fakeClaude({ transcript: [typed('tidy the ledger')], deleted: [SESSION_ID] })
const codexHome = await fakeCodex([
  line('session_meta', { id: SESSION_ID, cwd: '/tmp/demo' }),
  line('response_item', { type: 'message', role: 'user', content: 'hello' }),
])
const emptyHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'guard-home-'))
process.env.HOME = emptyHome
process.env.CLAUDE_CONFIG_DIR = claude.configDir
process.env.MOON_BASE_CLAUDE_DESKTOP = claude.desktop
process.env.CODEX_HOME = codexHome

const installs = async () => ({ claude: await listing(claude.root), codex: await listing(codexHome) })

test('every adapter reads only under the fixture roots, never a real home', async () => {
  const { HARNESSES } = await import('../server/harnesses/index.mjs')
  const roots = { 'claude-code': claude.root, codex: codexHome }
  for (const h of HARNESSES) {
    for (const p of Object.values(h.paths)) assert.ok(p.startsWith(roots[h.id]), `${h.id} reads ${p}`)
  }
})

test('scanning and saving leave both installs untouched and write only colony.json', async () => {
  const before = await installs()
  await withServer(async ({ call, dir, put }) => {
    const threads = await (await call('/api/threads')).json()
    assert.equal(threads.threads.length, 2, 'one thread from each tool was scanned')
    assert.equal((await call('/api/harnesses')).status, 200)
    assert.equal((await call('/api/state')).status, 200)
    assert.equal((await put({ archived: [threads.threads[0].id] })).status, 200)
    assert.equal((await call('/api/threads')).status, 200)
    assert.deepEqual(await fsp.readdir(dir), ['colony.json'], 'nothing else is ever written, temp files included')
  })
  assert.deepEqual(await installs(), before)
})

test.after(async () => {
  for (const dir of [claude.root, codexHome, emptyHome]) await fsp.rm(dir, { recursive: true, force: true })
})
