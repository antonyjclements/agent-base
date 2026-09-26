/**
 * AC8 and the open routes of AC4: the server exposes two fixed actions, on ids and folders it found
 * itself, and never starts a process from anything the request says.
 *
 * Both installs are faked on disk and the server's opener is a recorder, so nothing here can
 * launch a real app. The env is set before anything under `server/` is imported, because the
 * adapters read their store locations once, at load.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { SESSION_ID, line, fakeCodex, fakeClaude, typed } from './support/fixtures.mjs'
import { withServer } from './support/with-server.mjs'

const CLI_ONLY = '5b6c7d8e-9f01-4a2b-8c3d-4e5f6a7b8c9d'
const CODEX_WEIRD = '019cc762-45a2-7112-89cd-cd345c17e222'

const DESKTOP_THREAD = `claude-code:${SESSION_ID}`
const CLI_THREAD = `claude-code:${CLI_ONLY}`
const CODEX_THREAD = `codex:${SESSION_ID}`

const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'open-security-'))
const repo = path.join(base, 'plain-repo')
const weird = path.join(base, `evil & repo; $(touch x) "q" 'r'`)
await fsp.mkdir(repo)
await fsp.mkdir(weird)

// Claude Code: one thread the desktop app has a record for, and one that only exists in the CLI.
const claude = await fakeClaude({
  transcript: [typed('desktop backed')],
  records: [
    {
      sessionId: `local_${SESSION_ID}`,
      cliSessionId: SESSION_ID,
      cwd: repo,
      title: 'Desktop backed',
      createdAt: 1,
      lastActivityAt: Date.now(),
      lastFocusedAt: 1,
    },
  ],
})
await fsp.writeFile(
  path.join(claude.configDir, 'projects', '-tmp-demo', `${CLI_ONLY}.jsonl`),
  JSON.stringify(typed('terminal started')) + '\n'
)

// Codex: one thread in a plain repo, one in a folder whose name is full of shell characters.
const codexHome = await fakeCodex([
  line('session_meta', { id: SESSION_ID, cwd: repo }),
  line('response_item', { type: 'message', role: 'user', content: 'hello' }),
])
await fsp.writeFile(
  path.join(codexHome, 'sessions', '2026', '09', '07', `rollout-2026-09-07T12-05-00-${CODEX_WEIRD}.jsonl`),
  line('session_meta', { id: CODEX_WEIRD, cwd: weird }) + '\n'
)

const emptyHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'open-home-'))
process.env.HOME = emptyHome
process.env.CLAUDE_CONFIG_DIR = claude.configDir
process.env.MOON_BASE_CLAUDE_DESKTOP = claude.desktop
process.env.CODEX_HOME = codexHome

const post = (call, p, body) => call(p, { method: 'POST', body: JSON.stringify(body) })
const newSessionUrl = (scheme, key, folder) => scheme + '?' + new URLSearchParams({ [key]: folder })

// ── /api/open ─────────────────────────────────────────────────────────────────

test('opening a known thread hands the opener the adapter’s URL and nothing else', async () => {
  await withServer(async ({ call, opened }) => {
    const cases = [
      [DESKTOP_THREAD, `claude://claude.ai/epitaxy/local_${SESSION_ID}`],
      [CLI_THREAD, `claude://resume?session=${CLI_ONLY}`],
      [CODEX_THREAD, `codex://threads/${SESSION_ID}`],
    ]
    for (const [id, url] of cases) {
      opened.length = 0
      const res = await post(call, '/api/open', { id })
      assert.equal(res.status, 200, id)
      assert.deepEqual(opened, [url], id)
    }
  })
})

test('an id the scan does not know is refused and nothing is opened', async () => {
  await withServer(async ({ call, opened }) => {
    for (const id of ['claude-code:00000000-0000-4000-8000-000000000000', 'codex:nope', 'cursor:1']) {
      const res = await post(call, '/api/open', { id })
      assert.equal(res.status, 404, id)
    }
    assert.deepEqual(opened, [])
  })
})

test('a missing or malformed id is refused', async () => {
  await withServer(async ({ call, opened }) => {
    for (const body of [{}, { id: null }, { id: 5 }, { id: [CODEX_THREAD] }, { id: { id: CODEX_THREAD } }, { id: '' }]) {
      assert.equal((await post(call, '/api/open', body)).status, 400, JSON.stringify(body))
    }
    assert.deepEqual(opened, [])
  })
})

test('a ref, harness, URL or command in the request is ignored', async () => {
  await withServer(async ({ call, opened }) => {
    const res = await post(call, '/api/open', {
      id: CODEX_THREAD,
      harness: 'claude-code',
      ref: { sessionId: CODEX_WEIRD, cliSessionId: CLI_ONLY },
      url: 'https://evil.example/',
      command: 'touch /tmp/pwned',
      argv: ['sh', '-c', 'touch /tmp/pwned'],
    })
    assert.equal(res.status, 200)
    assert.deepEqual(opened, [`codex://threads/${SESSION_ID}`])
  })
})

test('a request that names only a URL or a command opens nothing', async () => {
  await withServer(async ({ call, opened }) => {
    for (const body of [{ url: 'claude://resume?session=x' }, { command: 'touch /tmp/pwned' }, { ref: { sessionId: SESSION_ID } }]) {
      assert.equal((await post(call, '/api/open', body)).status, 400, JSON.stringify(body))
    }
    assert.deepEqual(opened, [])
  })
})

// ── /api/new-session ──────────────────────────────────────────────────────────

test('a new session opens in a folder that a known thread already lives in', async () => {
  await withServer(async ({ call, opened }) => {
    await post(call, '/api/new-session', { folder: repo, harness: 'codex' })
    await post(call, '/api/new-session', { folder: repo, harness: 'claude-code' })
    await post(call, '/api/new-session', { folder: repo })
    assert.deepEqual(opened, [
      newSessionUrl('codex://threads/new', 'path', repo),
      newSessionUrl('claude://code/new', 'folder', repo),
      newSessionUrl('claude://code/new', 'folder', repo),
    ])
  })
})

test('a folder no thread lives in is refused, however it is spelled', async () => {
  await withServer(async ({ call, opened }) => {
    const refused = [base, os.tmpdir(), '/', path.join(repo, '..'), path.join(repo, 'nope'), 'plain-repo', '', 5, null, [repo], { folder: repo }]
    for (const folder of refused) {
      const res = await post(call, '/api/new-session', { folder, harness: 'codex' })
      assert.equal(res.status, 400, JSON.stringify(folder))
    }
    assert.deepEqual(opened, [])
  })
})

test('a harness that is not registered is refused', async () => {
  await withServer(async ({ call, opened }) => {
    for (const harness of ['evil', 'cursor', 'opencode', 5, ['codex']]) {
      assert.equal((await post(call, '/api/new-session', { folder: repo, harness })).status, 400, JSON.stringify(harness))
    }
    assert.deepEqual(opened, [])
  })
})

test('a folder name full of shell characters reaches the opener encoded, as one URL', async () => {
  await withServer(async ({ call, opened }) => {
    const res = await post(call, '/api/new-session', { folder: weird, harness: 'codex' })
    assert.equal(res.status, 200)
    assert.equal(opened.length, 1)
    assert.match(opened[0], /^codex:\/\/threads\/new\?path=[A-Za-z0-9%+._*-]+$/, 'nothing raw survives into the URL')
    assert.equal(new URL(opened[0]).searchParams.get('path'), weird)
  })
})

// ── what is not there ─────────────────────────────────────────────────────────

test('there is no reveal route, and no other action', async () => {
  await withServer(async ({ call, opened }) => {
    assert.equal((await post(call, '/api/reveal', { folder: repo })).status, 404)
    for (const p of ['/api/exec', '/api/run', '/api/terminal', '/api/hooks', '/api/config']) {
      assert.equal((await post(call, p, { command: 'x' })).status, 404, p)
    }
    assert.deepEqual(opened, [])
  })
})

test('the only server code that starts a process is the opener, the terminal launcher and the Linux scheme probe', async () => {
  const serverDir = new URL('../server/', import.meta.url).pathname
  const files = (await fsp.readdir(serverDir, { recursive: true })).filter((f) => f.endsWith('.mjs'))
  const spawners = []
  for (const f of files) {
    const text = await fsp.readFile(path.join(serverDir, f), 'utf8')
    if (/from ['"](node:)?child_process['"]/.test(text)) spawners.push(f)
  }
  assert.deepEqual(spawners.sort(), ['api.mjs', path.join('lib', 'terminal.mjs'), path.join('lib', 'xdg.mjs')])
})

test('no server code hands a process to a shell', async () => {
  const serverDir = new URL('../server/', import.meta.url).pathname
  const files = (await fsp.readdir(serverDir, { recursive: true })).filter((f) => f.endsWith('.mjs'))
  for (const f of files) {
    // Comments are dropped first: they explain why there is no shell, and may say the word.
    const code = (await fsp.readFile(path.join(serverDir, f), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.ok(!/\bshell\s*:\s*(true|['"`])/.test(code), `${f} asks for a shell`)
    // A bare call, not a method: `pattern.exec(text)` is a regular expression, not a command.
    assert.ok(!/(?<![.\w])(exec|execSync|spawnSync)\s*\(/.test(code), `${f} runs a command string`)
  }
})

test('the terminal launcher never runs anything that a request can name', async () => {
  const serverDir = new URL('../server/', import.meta.url).pathname
  const text = await fsp.readFile(path.join(serverDir, 'lib', 'terminal.mjs'), 'utf8')
  assert.match(text, /\bexecFile\b/, 'it runs the launcher with execFile, an argument list')
  for (const other of ['sh', 'bash', 'zsh', 'osascript']) {
    assert.ok(!new RegExp(`['"\`]${other}['"\`]`).test(text), `the launcher table never names ${other}`)
  }
  // `open` appears exactly once, to bring cmux itself forward — a fixed, hardcoded app name that a
  // request can never change. A second appearance, or a different argument list, fails this check
  // on purpose: that is exactly the shape a request-controlled `open` would take.
  const openLiterals = text.match(/['"`]open['"`]/g) || []
  assert.equal(openLiterals.length, 1, 'open is named exactly once')
  assert.match(text, /\['open',\s*'-a',\s*'cmux'\]/, 'and only as this fixed argument list')
})

// ── the request must come from the page itself (AC4) ──────────────────────────

test('a cross-origin POST is refused before anything is opened', async () => {
  await withServer(async ({ call, opened }) => {
    const res = await call('/api/open', {
      method: 'POST',
      headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: CODEX_THREAD }),
    })
    assert.equal(res.status, 403)
    assert.deepEqual(opened, [])
  })
})

test('a POST with no Origin at all is refused', async () => {
  await withServer(async ({ port, opened }) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/open`, { method: 'POST', body: JSON.stringify({ id: CODEX_THREAD }) })
    assert.equal(res.status, 403)
    assert.deepEqual(opened, [])
  })
})

test('a request with a foreign Host header (DNS rebinding) is refused', async () => {
  await withServer(async ({ port, opened }) => {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/api/open', method: 'POST', headers: { Host: 'evil.example', Origin: `http://localhost:${port}` } },
        (res) => {
          res.resume()
          resolve(res.statusCode)
        }
      )
      req.on('error', reject)
      req.end(JSON.stringify({ id: CODEX_THREAD }))
    })
    assert.equal(status, 403)
    assert.deepEqual(opened, [])
  })
})

// ── what the page is told before it clicks ────────────────────────────────────

test('a CLI-only Claude session is flagged as opening a new desktop session; the rest are not', async () => {
  await withServer(async ({ call }) => {
    const { threads } = await (await call('/api/threads')).json()
    const byId = Object.fromEntries(threads.map((t) => [t.id, t]))
    assert.equal(byId[CLI_THREAD].opensAsNewSession, true)
    assert.equal(byId[DESKTOP_THREAD].opensAsNewSession, false)
    assert.ok(!byId[CODEX_THREAD].opensAsNewSession)
  })
})

test.after(async () => {
  for (const dir of [base, claude.root, codexHome, emptyHome]) await fsp.rm(dir, { recursive: true, force: true })
})
