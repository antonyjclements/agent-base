/**
 * AC13 through the real routes: a copied terminal command and an opt-in cmux launcher, on ids and
 * folders the server found itself, and never on anything the request says.
 *
 * Both installs are faked on disk. The server's opener and terminal runner are recorders, so
 * nothing here can open an app or start `cmux`. The env is set before anything under `server/`
 * is imported, because the adapters read their store locations once, at load.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { SESSION_ID, line, fakeCodex, fakeClaude, typed } from './support/fixtures.mjs'
import { withServer } from './support/with-server.mjs'

const CLI_ONLY = '5b6c7d8e-9f01-4a2b-8c3d-4e5f6a7b8c9d'
const CLAUDE_WEIRD = '6c7d8e9f-0a12-4b3c-9d4e-5f6a7b8c9d0e'
const DESKTOP_ONLY = '7d8e9f0a-1b23-4c4d-8e5f-6a7b8c9d0e1f'
const CODEX_WEIRD = '019cc762-45a2-7112-89cd-cd345c17e222'
const CODEX_GONE = '019cc762-45a2-7112-89cd-cd345c17e333'
const CODEX_BROKEN = '019cc762-45a2-7112-89cd-cd345c17e444'

const DESKTOP_THREAD = `claude-code:${SESSION_ID}`
const CLI_THREAD = `claude-code:${CLI_ONLY}`
const CLAUDE_WEIRD_THREAD = `claude-code:${CLAUDE_WEIRD}`
const DESKTOP_ONLY_THREAD = `claude-code:local_${DESKTOP_ONLY}`
const CODEX_THREAD = `codex:${SESSION_ID}`
const CODEX_WEIRD_THREAD = `codex:${CODEX_WEIRD}`
const CODEX_GONE_THREAD = `codex:${CODEX_GONE}`
const CODEX_BROKEN_THREAD = `codex:${CODEX_BROKEN}`

const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'terminal-handoff-'))
const repo = path.join(base, 'plain-repo')
const weird = path.join(base, `evil & repo; $(touch x) "q" 'r'`)
const broken = path.join(base, 'line\nbreak')
const gone = path.join(base, 'deleted-repo')
for (const dir of [repo, weird, broken]) await fsp.mkdir(dir)

const at = (cwd, text) => ({ ...typed(text), cwd })

const claude = await fakeClaude({
  transcript: [at(repo, 'desktop backed')],
  records: [
    { sessionId: `local_${SESSION_ID}`, cliSessionId: SESSION_ID, cwd: repo, title: 'Desktop backed', createdAt: 1, lastActivityAt: Date.now(), lastFocusedAt: 1 },
    // A desktop record whose CLI transcript is not there: there is no CLI session to resume.
    { sessionId: `local_${DESKTOP_ONLY}`, cwd: repo, title: 'No CLI session', createdAt: 1, lastActivityAt: Date.now(), lastFocusedAt: 1 },
  ],
})
const project = path.join(claude.configDir, 'projects', '-tmp-demo')
await fsp.writeFile(path.join(project, `${CLI_ONLY}.jsonl`), JSON.stringify(at(repo, 'terminal started')) + '\n')
await fsp.writeFile(path.join(project, `${CLAUDE_WEIRD}.jsonl`), JSON.stringify(at(weird, 'odd folder')) + '\n')

const codexHome = await fakeCodex([
  line('session_meta', { id: SESSION_ID, cwd: repo }),
  line('response_item', { type: 'message', role: 'user', content: 'hello' }),
])
const rollout = (id, cwd) =>
  fsp.writeFile(path.join(codexHome, 'sessions', '2026', '09', '07', `rollout-2026-09-07T12-05-00-${id}.jsonl`), line('session_meta', { id, cwd }) + '\n')
await rollout(CODEX_WEIRD, weird)
await rollout(CODEX_GONE, gone)
await rollout(CODEX_BROKEN, broken)

const emptyHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'terminal-home-'))
process.env.HOME = emptyHome
process.env.CLAUDE_CONFIG_DIR = claude.configDir
process.env.MOON_BASE_CLAUDE_DESKTOP = claude.desktop
process.env.CODEX_HOME = codexHome

const post = (call, p, body) => call(p, { method: 'POST', body: JSON.stringify(body) })
const COMMAND = '/api/terminal-command'
const LAUNCH = '/api/terminal-launch'

/** Run `fn` with MOON_BASE_TERMINAL set (or unset), and put the environment back afterwards. */
async function withLauncher(value, fn) {
  const before = process.env.MOON_BASE_TERMINAL
  if (value === undefined) delete process.env.MOON_BASE_TERMINAL
  else process.env.MOON_BASE_TERMINAL = value
  try {
    return await fn()
  } finally {
    if (before === undefined) delete process.env.MOON_BASE_TERMINAL
    else process.env.MOON_BASE_TERMINAL = before
  }
}

/** Written out here rather than imported, so a mistake in the server's quoting cannot hide itself. */
const quoted = (value) => `'${value.replaceAll("'", `'\\''`)}'`

// ── which launcher is on ──────────────────────────────────────────────────────

test('the page is told there is no launcher unless the environment names cmux', async () => {
  await withServer(async ({ call }) => {
    for (const [value, expected] of [
      [undefined, null],
      ['', null],
      ['sh -c evil', null],
      ['CMUX', null],
      ['cmux', { id: 'cmux', label: 'cmux' }],
    ]) {
      await withLauncher(value, async () => {
        const res = await call('/api/terminal-launcher')
        assert.equal(res.status, 200)
        assert.deepEqual(await res.json(), { launcher: expected }, JSON.stringify(value))
      })
    }
  })
})

// ── the copied command ────────────────────────────────────────────────────────

test('a known thread gets the command that resumes it, in its own folder', async () => {
  await withServer(async ({ call, opened, launched }) => {
    const cases = [
      [DESKTOP_THREAD, `cd '${repo}' && claude --resume ${SESSION_ID}`],
      [CLI_THREAD, `cd '${repo}' && claude --resume ${CLI_ONLY}`],
      [CODEX_THREAD, `cd '${repo}' && codex resume ${SESSION_ID}`],
    ]
    for (const [id, command] of cases) {
      const res = await post(call, COMMAND, { id })
      assert.equal(res.status, 200, id)
      assert.deepEqual(await res.json(), { ok: true, command }, id)
    }
    assert.deepEqual(opened, [], 'copying opens nothing')
    assert.deepEqual(launched, [], 'copying launches nothing')
  })
})

test('a repo gets the command that starts a new session in it', async () => {
  await withServer(async ({ call, launched }) => {
    for (const [harness, tool] of [['claude-code', 'claude'], ['codex', 'codex']]) {
      const res = await post(call, COMMAND, { folder: repo, harness })
      assert.equal(res.status, 200, harness)
      assert.deepEqual(await res.json(), { ok: true, command: `cd '${repo}' && ${tool}` }, harness)
    }
    const dflt = await (await post(call, COMMAND, { folder: repo })).json()
    assert.match(dflt.command, new RegExp(`^cd '${repo}' && (claude|codex)$`), 'no tool named: the repo’s usual one')
    assert.deepEqual(launched, [])
  })
})

test('the copied command works whether or not a launcher is on', async () => {
  await withServer(async ({ call }) => {
    for (const value of [undefined, 'cmux', 'sh -c evil']) {
      await withLauncher(value, async () => {
        const res = await post(call, COMMAND, { id: CODEX_THREAD })
        assert.equal(res.status, 200, JSON.stringify(value))
      })
    }
  })
})

test('a folder name full of shell characters is quoted, and a real shell runs nothing from it', async () => {
  await withServer(async ({ call }) => {
    const cases = [
      [CODEX_WEIRD_THREAD, `codex resume ${CODEX_WEIRD}`],
      [CLAUDE_WEIRD_THREAD, `claude --resume ${CLAUDE_WEIRD}`],
    ]
    for (const [id, tail] of cases) {
      const { command } = await (await post(call, COMMAND, { id })).json()
      assert.equal(command, `cd ${quoted(weird)} && ${tail}`, id)

      // Run the folder part in a real shell, somewhere a stray `touch x` would leave a mark.
      const head = command.slice(0, command.indexOf(' && '))
      const out = execFileSync('sh', ['-c', `${head} && pwd -P`], { cwd: base, encoding: 'utf8' }).trim()
      assert.equal(out, await fsp.realpath(weird), id)
      await assert.rejects(fsp.stat(path.join(base, 'x')), 'the $(touch x) in the folder name never ran')
    }
    const fresh = await (await post(call, COMMAND, { folder: weird, harness: 'codex' })).json()
    assert.equal(fresh.command, `cd ${quoted(weird)} && codex`)
  })
})

// ── what is refused ───────────────────────────────────────────────────────────

for (const [name, route] of [['copy', COMMAND], ['launch', LAUNCH]]) {
  test(`${name}: an id the scan does not know is refused and nothing runs`, async () => {
    await withLauncher('cmux', () =>
      withServer(async ({ call, opened, launched }) => {
        for (const id of ['claude-code:00000000-0000-4000-8000-000000000000', 'codex:nope', 'cursor:1']) {
          assert.equal((await post(call, route, { id })).status, 404, id)
        }
        assert.deepEqual([opened, launched], [[], []])
      })
    )
  })

  test(`${name}: a missing or malformed request is refused and nothing runs`, async () => {
    await withLauncher('cmux', () =>
      withServer(async ({ call, opened, launched }) => {
        const bodies = [{}, { id: null }, { id: 5 }, { id: [CODEX_THREAD] }, { id: { id: CODEX_THREAD } }, { id: '' }, { id: 'x'.repeat(301) }, { command: 'touch /tmp/pwned' }, { url: 'claude://x' }]
        for (const body of bodies) assert.equal((await post(call, route, body)).status, 400, JSON.stringify(body).slice(0, 60))
        assert.deepEqual([opened, launched], [[], []])
      })
    )
  })

  test(`${name}: a folder no thread lives in is refused, however it is spelled`, async () => {
    await withLauncher('cmux', () =>
      withServer(async ({ call, opened, launched }) => {
        const refused = [base, os.tmpdir(), '/', path.join(repo, '..'), path.join(repo, 'nope'), 'plain-repo', '', 5, null, [repo], { folder: repo }]
        for (const folder of refused) {
          assert.equal((await post(call, route, { folder, harness: 'codex' })).status, 400, JSON.stringify(folder))
        }
        assert.deepEqual([opened, launched], [[], []])
      })
    )
  })

  test(`${name}: a harness that is not registered is refused`, async () => {
    await withLauncher('cmux', () =>
      withServer(async ({ call, launched }) => {
        for (const harness of ['evil', 'cursor', 'opencode', 5, ['codex'], { id: 'codex' }]) {
          assert.equal((await post(call, route, { folder: repo, harness })).status, 400, JSON.stringify(harness))
        }
        assert.deepEqual(launched, [])
      })
    )
  })

  test(`${name}: a folder that is gone, or whose name a terminal cannot carry safely, is refused with a reason`, async () => {
    await withLauncher('cmux', () =>
      withServer(async ({ call, launched }) => {
        const gone = await post(call, route, { id: CODEX_GONE_THREAD })
        assert.equal(gone.status, 400)
        assert.match((await gone.json()).error, /not on this machine/)

        const goneNew = await post(call, route, { folder: path.join(base, 'deleted-repo'), harness: 'codex' })
        assert.equal(goneNew.status, 400)
        assert.match((await goneNew.json()).error, /not on this machine/)

        for (const body of [{ id: CODEX_BROKEN_THREAD }, { folder: broken, harness: 'codex' }]) {
          const res = await post(call, route, body)
          assert.equal(res.status, 400, JSON.stringify(body))
          assert.match((await res.json()).error, /characters/)
        }
        assert.deepEqual(launched, [])
      })
    )
  })

  test(`${name}: a thread with no CLI session to resume says so`, async () => {
    await withLauncher('cmux', () =>
      withServer(async ({ call, launched }) => {
        const res = await post(call, route, { id: DESKTOP_ONLY_THREAD })
        assert.equal(res.status, 400)
        assert.match((await res.json()).error, /session id/i)
        assert.deepEqual(launched, [])
      })
    )
  })

  test(`${name}: a command, argument list, folder, URL, ref or launcher in the request is never read`, async () => {
    await withLauncher('cmux', () =>
      withServer(async ({ call, launched }) => {
        const extras = {
          harness: 'claude-code',
          command: 'touch /tmp/pwned',
          argv: ['sh', '-c', 'touch /tmp/pwned'],
          cwd: '/',
          folder: base,
          launcher: 'sh',
          terminal: 'osascript',
          url: 'https://evil.example/',
          ref: { sessionId: CODEX_WEIRD, cliSessionId: CLI_ONLY, cwd: '/' },
        }
        const res = await post(call, route, { id: CODEX_THREAD, ...extras })
        assert.equal(res.status, 200)
        if (route === COMMAND) assert.equal((await res.json()).command, `cd '${repo}' && codex resume ${SESSION_ID}`)
        else assert.deepEqual(launched, [['cmux', 'new-workspace', '--cwd', repo, '--command', `codex resume ${SESSION_ID}`, '--focus', 'true']])
      })
    )
  })

  test(`${name}: a cross-origin or origin-less POST is refused before anything runs`, async () => {
    await withLauncher('cmux', () =>
      withServer(async ({ call, port, opened, launched }) => {
        const evil = await call(route, {
          method: 'POST',
          headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: CODEX_THREAD }),
        })
        assert.equal(evil.status, 403)
        const bare = await fetch(`http://127.0.0.1:${port}${route}`, { method: 'POST', body: JSON.stringify({ id: CODEX_THREAD }) })
        assert.equal(bare.status, 403)
        assert.deepEqual([opened, launched], [[], []])
      })
    )
  })

  test(`${name}: only a POST is an action`, async () => {
    await withServer(async ({ call }) => {
      for (const method of ['GET', 'PUT', 'DELETE']) {
        assert.equal((await call(route, { method })).status, 404, method)
      }
    })
  })
}

// ── bringing cmux itself forward ────────────────────────────────────────────────

test('a successful launch also brings cmux forward', async () => {
  await withLauncher('cmux', () =>
    withServer(async ({ call, foregrounded }) => {
      const res = await post(call, LAUNCH, { id: CODEX_THREAD })
      assert.equal(res.status, 200)
      assert.deepEqual(foregrounded, [['open', '-a', 'cmux']])
    })
  )
})

test('skipping an already-open session still brings cmux forward — that is the point of clicking it', async () => {
  await withLauncher('cmux', () =>
    withServer(async ({ api, call, foregrounded, launched }) => {
      api.setSessionProbe(async () => ({ open: true }))
      const res = await post(call, LAUNCH, { id: CODEX_THREAD })
      assert.deepEqual(await res.json(), { ok: true, already: true })
      assert.deepEqual(foregrounded, [['open', '-a', 'cmux']])
      assert.deepEqual(launched, [])
    })
  )
})

test('nothing is brought forward for copy, for a refused request, or for a failed launch', async () => {
  await withLauncher('cmux', () =>
    withServer(async ({ api, call, foregrounded }) => {
      await post(call, COMMAND, { id: CODEX_THREAD })
      assert.deepEqual(foregrounded, [], 'copy never touches cmux')

      await post(call, LAUNCH, { id: 'codex:nope' })
      assert.deepEqual(foregrounded, [], 'an unknown thread is refused before anything runs')

      api.setTerminalRunner(async () => ({ ok: false, error: 'cmux could not open that session.' }))
      const failed = await post(call, LAUNCH, { id: CODEX_THREAD })
      assert.equal(failed.status, 400)
      assert.deepEqual(foregrounded, [], 'a launch that failed has nothing to bring forward')
    })
  )
})

test('a foreground step that throws is forgotten, and never changes the answer', async () => {
  // The contract with `setForegrounder` is that it resolves; the real `runForeground` guarantees
  // that with `execFile`'s own timeout. A stub that never resolves would hang this test, not the
  // server, so it is not something a test can safely stand in for — only a throw is exercised here.
  await withLauncher('cmux', () =>
    withServer(async ({ api, call }) => {
      api.setForegrounder(async () => {
        throw new Error('boom')
      })
      const res = await post(call, LAUNCH, { id: CODEX_THREAD })
      assert.equal(res.status, 200)
      assert.deepEqual(await res.json(), { ok: true })
    })
  )
})

// ── the launcher ──────────────────────────────────────────────────────────────

test('launching is off unless the environment turns it on, and says so', async () => {
  for (const value of [undefined, '', 'sh', 'sh -c evil', 'osascript', 'CMUX', ' cmux', 'cmux;touch x', 'constructor']) {
    await withLauncher(value, () =>
      withServer(async ({ call, opened, launched }) => {
        const res = await post(call, LAUNCH, { id: CODEX_THREAD })
        assert.equal(res.status, 400, JSON.stringify(value))
        assert.match((await res.json()).error, /not enabled/i)
        assert.deepEqual([opened, launched], [[], []], JSON.stringify(value))
      })
    )
  }
})

test('with cmux on, a thread opens as one cmux call: the folder as its own argument, the command with no path in it', async () => {
  await withLauncher('cmux', () =>
    withServer(async ({ call, launched, opened }) => {
      const cases = [
        [DESKTOP_THREAD, repo, `claude --resume ${SESSION_ID}`],
        [CLI_THREAD, repo, `claude --resume ${CLI_ONLY}`],
        [CODEX_THREAD, repo, `codex resume ${SESSION_ID}`],
        [CODEX_WEIRD_THREAD, weird, `codex resume ${CODEX_WEIRD}`],
        [CLAUDE_WEIRD_THREAD, weird, `claude --resume ${CLAUDE_WEIRD}`],
      ]
      for (const [id, cwd, command] of cases) {
        launched.length = 0
        const res = await post(call, LAUNCH, { id })
        assert.equal(res.status, 200, id)
        assert.deepEqual(await res.json(), { ok: true }, id)
        assert.deepEqual(launched, [['cmux', 'new-workspace', '--cwd', cwd, '--command', command, '--focus', 'true']], id)
        assert.ok(!launched[0][5].includes(cwd), 'the folder is not in the command text')
      }
      assert.deepEqual(opened, [], 'the OS opener is not involved')
    })
  )
})

test('with cmux on, a new session opens the bare tool in the repo', async () => {
  await withLauncher('cmux', () =>
    withServer(async ({ call, launched }) => {
      for (const [harness, tool] of [['claude-code', 'claude'], ['codex', 'codex']]) {
        launched.length = 0
        const res = await post(call, LAUNCH, { folder: weird, harness })
        assert.equal(res.status, 200, harness)
        assert.deepEqual(launched, [['cmux', 'new-workspace', '--cwd', weird, '--command', tool, '--focus', 'true']], harness)
      }
    })
  )
})

// ── not duplicating a session cmux already has open ───────────────────────────

test('a session cmux already has open is not launched a second time', async () => {
  await withLauncher('cmux', () =>
    withServer(async ({ api, call, launched }) => {
      const probed = []
      api.setSessionProbe(async (agent, id) => {
        probed.push([agent, id])
        return { open: true, workspaceId: 'W1' }
      })
      const codexRes = await post(call, LAUNCH, { id: CODEX_THREAD })
      assert.equal(codexRes.status, 200)
      assert.deepEqual(await codexRes.json(), { ok: true, already: true })
      assert.deepEqual(probed, [['codex', SESSION_ID]])

      probed.length = 0
      const claudeRes = await post(call, LAUNCH, { id: DESKTOP_THREAD })
      assert.deepEqual(await claudeRes.json(), { ok: true, already: true })
      assert.deepEqual(probed, [['claude', SESSION_ID]])

      assert.deepEqual(launched, [], 'no cmux workspace was started for either')
    })
  )
})

test('the probe is asked only for a launcher resuming a known session, never for a new one', async () => {
  await withLauncher('cmux', () =>
    withServer(async ({ api, call, launched }) => {
      let calls = 0
      api.setSessionProbe(async () => {
        calls++
        return { open: false }
      })
      await post(call, LAUNCH, { folder: repo, harness: 'codex' })
      assert.equal(calls, 0, 'a new session has no existing id to ask about')
      assert.equal(launched.length, 1)
    })
  )
})

test('the probe is never reached for copy, or without a launcher', async () => {
  let calls = 0
  const probe = async () => {
    calls++
    return { open: true }
  }
  await withServer(async ({ api, call }) => {
    api.setSessionProbe(probe)
    await post(call, COMMAND, { id: CODEX_THREAD })
  })
  assert.equal(calls, 0, 'copying never asks cmux anything')

  await withLauncher(undefined, () =>
    withServer(async ({ api, call }) => {
      api.setSessionProbe(probe)
      await post(call, LAUNCH, { id: CODEX_THREAD })
    })
  )
  assert.equal(calls, 0, 'with no launcher on, launch is refused before the probe would run')
})

test('a probe that throws, times out or answers oddly never blocks a real launch', async () => {
  await withLauncher('cmux', () =>
    withServer(async ({ api, call, launched }) => {
      const probes = [
        async () => {
          throw new Error('boom')
        },
        async () => null,
        async () => undefined,
        async () => ({}),
        async () => ({ open: false }),
        async () => ({ open: 'yes' }),
        async () => 'open',
      ]
      for (const probe of probes) {
        launched.length = 0
        api.setSessionProbe(probe)
        const res = await post(call, LAUNCH, { id: CODEX_THREAD })
        assert.equal(res.status, 200, String(probe))
        assert.deepEqual(await res.json(), { ok: true })
        assert.equal(launched.length, 1, String(probe))
      }
    })
  )
})

test('a failed launch is told to the page in the launcher’s own fixed words', async () => {
  await withLauncher('cmux', () =>
    withServer(async ({ api, call, launched }) => {
      api.setTerminalRunner(async (argv) => {
        launched.push(argv)
        return { ok: false, error: 'cmux only accepts requests from inside its own terminals.' }
      })
      const res = await post(call, LAUNCH, { id: CODEX_THREAD })
      assert.equal(res.status, 400)
      assert.deepEqual(await res.json(), { ok: false, error: 'cmux only accepts requests from inside its own terminals.' })
      assert.equal(launched.length, 1)
    })
  )
})

test('a runner that misbehaves cannot put anything but a fixed message on the page', async () => {
  await withLauncher('cmux', () =>
    withServer(async ({ api, call }) => {
      api.setTerminalRunner(async () => ({ ok: false, error: { secret: 'x' }, stderr: 'SECRET' }))
      const res = await post(call, LAUNCH, { id: CODEX_THREAD })
      assert.equal(res.status, 400)
      const body = await res.json()
      assert.equal(body.ok, false)
      assert.equal(typeof body.error, 'string')
      assert.ok(!JSON.stringify(body).includes('SECRET'))

      api.setTerminalRunner(async () => {
        throw new Error('SECRET stack')
      })
      const thrown = await post(call, LAUNCH, { id: CODEX_THREAD })
      assert.equal(thrown.status, 400)
      assert.ok(!JSON.stringify(await thrown.json()).includes('SECRET'))
    })
  )
})

// ── adapters describe a command; they never run one ───────────────────────────

test('adapters answer with an argument list and a folder, and nothing else', async () => {
  const claudeCode = (await import('../server/harnesses/claude-code.mjs')).default
  const codex = (await import('../server/harnesses/codex.mjs')).default
  const { commandLine } = await import('../server/lib/terminal.mjs')

  const answers = [
    [await claudeCode.terminalOpen({ cliSessionId: CLI_ONLY, cwd: '/tmp/demo' }), ['claude', '--resume', CLI_ONLY], CLI_ONLY],
    [await claudeCode.terminalOpen({ cliSessionId: CLI_ONLY, desktopSessionId: `local_${CLI_ONLY}`, cwd: '/tmp/demo' }), ['claude', '--resume', CLI_ONLY], CLI_ONLY],
    [await claudeCode.terminalNew('/tmp/demo'), ['claude'], undefined],
    [await codex.terminalOpen({ sessionId: SESSION_ID, cwd: '/tmp/demo' }), ['codex', 'resume', SESSION_ID], SESSION_ID],
    [await codex.terminalNew('/tmp/demo'), ['codex'], undefined],
  ]
  for (const [answer, argv, resumeId] of answers) {
    assert.deepEqual(answer, resumeId === undefined ? { ok: true, argv, cwd: '/tmp/demo' } : { ok: true, argv, cwd: '/tmp/demo', resumeId })
    assert.notEqual(commandLine(answer.argv), null, 'every token is one the server will accept')
  }
})

test('adapters refuse a thread they cannot resume, and say why', async () => {
  const claudeCode = (await import('../server/harnesses/claude-code.mjs')).default
  const codex = (await import('../server/harnesses/codex.mjs')).default
  const refused = [
    await claudeCode.terminalOpen({ cliSessionId: '', desktopSessionId: `local_${DESKTOP_ONLY}`, cwd: '/tmp/demo' }),
    await claudeCode.terminalOpen({ cliSessionId: [CLI_ONLY], cwd: '/tmp/demo' }),
    await claudeCode.terminalOpen({ cliSessionId: 'not-a-uuid; touch x', cwd: '/tmp/demo' }),
    await claudeCode.terminalOpen({ cliSessionId: CLI_ONLY }),
    await claudeCode.terminalOpen({ cliSessionId: CLI_ONLY, cwd: ['/tmp/demo'] }),
    await claudeCode.terminalOpen(null),
    await codex.terminalOpen({ sessionId: [SESSION_ID], cwd: '/tmp/demo' }),
    await codex.terminalOpen({ sessionId: 'x; touch y', cwd: '/tmp/demo' }),
    await codex.terminalOpen({ sessionId: SESSION_ID }),
    await codex.terminalOpen({}),
    await codex.terminalOpen(null),
  ]
  for (const answer of refused) {
    assert.equal(answer.ok, false)
    assert.equal(typeof answer.error, 'string')
    assert.deepEqual(Object.keys(answer).sort(), ['error', 'ok'])
  }
})

test('a buggy or hostile adapter cannot get a command past the server', async () => {
  const claudeCode = (await import('../server/harnesses/claude-code.mjs')).default
  const original = claudeCode.terminalOpen
  try {
    const hostile = [['claude; touch x'], ['claude', '$(touch x)'], ['claude', '--resume', 'a b'], 'claude --resume x', [], null, [1]]
    for (const argv of hostile) {
      claudeCode.terminalOpen = async () => ({ ok: true, argv, cwd: repo })
      await withLauncher('cmux', () =>
        withServer(async ({ call, launched }) => {
          for (const route of [COMMAND, LAUNCH]) {
            const res = await post(call, route, { id: DESKTOP_THREAD })
            assert.equal(res.status, 400, `${route} ${JSON.stringify(argv)}`)
            assert.match((await res.json()).error, /not a command/, `${route} ${JSON.stringify(argv)}`)
          }
          assert.deepEqual(launched, [])
        })
      )
    }
  } finally {
    claudeCode.terminalOpen = original
  }
})

test.after(async () => {
  for (const dir of [base, claude.root, codexHome, emptyHome]) await fsp.rm(dir, { recursive: true, force: true })
})
