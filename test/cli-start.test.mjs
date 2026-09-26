/**
 * AC15, `moonbase1` start, with every dependency injected: the server, the port probe, the build, the page
 * opener and the environment. So nothing here starts a server, builds, opens a browser, or reads the real
 * environment, and every decision it makes can be checked on its own.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { insideCmux } from '../cli/cmux-env.mjs'
import { start } from '../cli/start.mjs'

const CMUX = { CMUX_WORKSPACE_ID: 'ws-1', CMUX_SURFACE_ID: 'sf-1' }

function harness({ env = {}, ports = { 5274: { kind: 'free' } }, build = { state: 'fresh' }, buildCode = 0, serve, open } = {}) {
  const out = []
  const err = []
  const calls = { built: 0, served: [], opened: [] }
  const io = {
    env: { ...env },
    root: '/repo',
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    build: {
      state: async () => build,
      run: async () => (calls.built++, buildCode),
    },
    probe: async (p) => ports[p] ?? { kind: 'other' },
    serve:
      serve ??
      (async ({ port, host }) => {
        calls.served.push({ port, host, terminal: io.env.MOON_BASE_TERMINAL })
        return { port, host, close() {} }
      }),
    open: open ?? ((url) => (calls.opened.push(url), true)),
  }
  return { io, out, err, calls, text: () => out.concat(err).join('\n') }
}

// ── am I inside cmux ──────────────────────────────────────────────────────────

test('inside cmux means both the workspace and the surface variables are there', () => {
  assert.equal(insideCmux(CMUX), true)
  for (const env of [{}, { CMUX_WORKSPACE_ID: 'ws-1' }, { CMUX_SURFACE_ID: 'sf-1' }, { CMUX_SOCKET_PATH: '/tmp/x.sock' }, { CMUX_WORKSPACE_ID: '', CMUX_SURFACE_ID: 'sf-1' }, { CMUX_WORKSPACE_ID: '  ', CMUX_SURFACE_ID: 'sf-1' }]) {
    assert.equal(insideCmux(env), false, JSON.stringify(env))
  }
})

// ── the launcher ──────────────────────────────────────────────────────────────

test('inside cmux the launcher is on before the server starts, and it says so', async () => {
  const h = harness({ env: CMUX })
  assert.equal(await start([], h.io), 0)
  assert.equal(h.calls.served[0].terminal, 'cmux', 'set before the server was started')
  assert.match(h.text(), /terminal launcher is on/i)
})

test('outside cmux the launcher is left off, and copy mode is mentioned', async () => {
  for (const env of [{}, { CMUX_WORKSPACE_ID: 'ws-1' }]) {
    const h = harness({ env })
    assert.equal(await start([], h.io), 0)
    assert.equal(h.calls.served[0].terminal, undefined)
    assert.match(h.text(), /launcher is off/i)
    assert.match(h.text(), /copy/i)
  }
})

test('an explicit MOON_BASE_TERMINAL always wins, whatever it says, and its value is never printed', async () => {
  for (const [env, value] of [
    [{ ...CMUX, MOON_BASE_TERMINAL: 'sentinel-off-value' }, 'sentinel-off-value'],
    [{ ...CMUX, MOON_BASE_TERMINAL: '' }, ''],
    [{ MOON_BASE_TERMINAL: 'cmux' }, 'cmux'],
  ]) {
    const h = harness({ env })
    assert.equal(await start([], h.io), 0)
    assert.equal(h.calls.served[0].terminal, value)
    assert.match(h.text(), /MOON_BASE_TERMINAL is set/)
    if (value.length > 4) assert.ok(!h.text().includes(value), 'the value is not echoed')
  }
})

// ── the port ──────────────────────────────────────────────────────────────────

test('it starts on the default port when that is free, and tells you where', async () => {
  const h = harness()
  await start([], h.io)
  assert.deepEqual(h.calls.served.map((s) => s.port), [5274])
  assert.match(h.out.join('\n'), /http:\/\/127\.0\.0\.1:5274/)
})

test('a taken port is skipped for the next free one', async () => {
  const h = harness({ ports: { 5274: { kind: 'other' }, 5275: { kind: 'other' }, 5276: { kind: 'free' } } })
  await start([], h.io)
  assert.deepEqual(h.calls.served.map((s) => s.port), [5276])
})

test('a copy that is already running is used, not duplicated', async () => {
  const h = harness({ ports: { 5274: { kind: 'moon-base', identity: { app: 'moon-base', launcher: null } } } })
  assert.equal(await start([], h.io), 0)
  assert.equal(h.calls.served.length, 0, 'no second server')
  assert.deepEqual(h.calls.opened, ['http://127.0.0.1:5274'])
  assert.match(h.text(), /already running/i)
})

test('reusing a copy that has the launcher off, from inside cmux, says so', async () => {
  const off = harness({ env: CMUX, ports: { 5274: { kind: 'moon-base', identity: { app: 'moon-base', launcher: null } } } })
  await start([], off.io)
  assert.match(off.text(), /launcher off/i)

  const on = harness({ env: CMUX, ports: { 5274: { kind: 'moon-base', identity: { app: 'moon-base', launcher: { id: 'cmux', label: 'cmux' } } } } })
  await start([], on.io)
  assert.ok(!/launcher off/i.test(on.text()))

  const outside = harness({ ports: { 5274: { kind: 'moon-base', identity: { app: 'moon-base', launcher: null } } } })
  await start([], outside.io)
  assert.ok(!/launcher off/i.test(outside.text()), 'not a problem when this terminal is not inside cmux')
})

test('a running copy further along is reused even though an earlier port is free', async () => {
  const h = harness({ ports: { 5274: { kind: 'free' }, 5277: { kind: 'moon-base', identity: { app: 'moon-base', launcher: null } } } })
  await start([], h.io)
  assert.equal(h.calls.served.length, 0)
  assert.deepEqual(h.calls.opened, ['http://127.0.0.1:5277'])
})

test('with no free port in the range it says so and starts nothing', async () => {
  const h = harness({ ports: {} })
  assert.equal(await start([], h.io), 1)
  assert.equal(h.calls.served.length, 0)
  assert.match(h.err.join('\n'), /5274/)
  assert.match(h.err.join('\n'), /--port/)
})

test('the search starts where PORT or --port says', async () => {
  const viaEnv = harness({ env: { PORT: '6100' }, ports: { 6100: { kind: 'free' } } })
  await start([], viaEnv.io)
  assert.deepEqual(viaEnv.calls.served.map((s) => s.port), [6100])

  const viaFlag = harness({ env: { PORT: '6100' }, ports: { 6200: { kind: 'free' } } })
  await start(['--port', '6200'], viaFlag.io)
  assert.deepEqual(viaFlag.calls.served.map((s) => s.port), [6200], 'the flag beats the environment')

  const eq = harness({ ports: { 6300: { kind: 'free' } } })
  await start(['--port=6300'], eq.io)
  assert.deepEqual(eq.calls.served.map((s) => s.port), [6300])
})

test('a port that is not a port is refused before anything happens', async () => {
  for (const args of [['--port', 'abc'], ['--port'], ['--port', '80'], ['--port', '70000'], ['--port', '5274.5'], ['--nope']]) {
    const h = harness()
    assert.equal(await start(args, h.io), 2, args.join(' '))
    assert.equal(h.calls.served.length, 0)
    assert.equal(h.calls.built, 0)
    assert.match(h.err.join('\n'), /Usage|--port|Unknown/)
  }
})

test('a port taken between looking and starting is a message, not a crash', async () => {
  const h = harness({ serve: async () => { throw Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }) } })
  assert.equal(await start([], h.io), 1)
  assert.match(h.err.join('\n'), /taken/i)
  assert.match(h.err.join('\n'), /again/i)
})

test('any other failure to start is said plainly', async () => {
  const h = harness({ serve: async () => { throw new Error('listen EACCES') } })
  assert.equal(await start([], h.io), 1)
  assert.match(h.err.join('\n'), /Could not start/)
})

// ── the build ─────────────────────────────────────────────────────────────────

test('a fresh build is served as it is, and nothing is built', async () => {
  const h = harness({ build: { state: 'fresh' } })
  await start([], h.io)
  assert.equal(h.calls.built, 0)
})

test('a missing or stale build is made first, and it says which', async () => {
  const missing = harness({ build: { state: 'missing' } })
  await start([], missing.io)
  assert.equal(missing.calls.built, 1)
  assert.match(missing.out.join('\n'), /first run/i)

  const stale = harness({ build: { state: 'stale' } })
  await start([], stale.io)
  assert.equal(stale.calls.built, 1)
  assert.match(stale.out.join('\n'), /source changed/i)
})

test('a failed build starts nothing, and points at the fix', async () => {
  const h = harness({ build: { state: 'stale' }, buildCode: 1 })
  assert.equal(await start([], h.io), 1)
  assert.equal(h.calls.served.length, 0)
  assert.equal(h.calls.opened.length, 0)
  assert.match(h.err.join('\n'), /build failed/i)
})

// ── the page ──────────────────────────────────────────────────────────────────

test('the page is opened once it is up, unless told not to', async () => {
  const opens = harness()
  await start([], opens.io)
  assert.deepEqual(opens.calls.opened, ['http://127.0.0.1:5274'])

  const quiet = harness()
  await start(['--no-open'], quiet.io)
  assert.deepEqual(quiet.calls.opened, [])
  assert.equal(quiet.calls.served.length, 1)
})

test('a page that cannot be opened is a note, not a failure', async () => {
  const h = harness({ open: () => false })
  assert.equal(await start([], h.io), 0)
  assert.match(h.out.join('\n'), /open .*http:\/\/127\.0\.0\.1:5274/i)
})

// ── the address it listens on ─────────────────────────────────────────────────

test('a host that is not loopback is passed on, with the warning the README gives', async () => {
  const h = harness({ env: { MOON_BASE_HOST: '0.0.0.0' } })
  await start([], h.io)
  assert.equal(h.calls.served[0].host, '0.0.0.0')
  assert.match(h.text(), /anyone on that network/i)
  assert.match(h.out.join('\n'), /http:\/\/127\.0\.0\.1:5274/, 'the page is still opened on loopback')

  for (const host of [undefined, '127.0.0.1', 'localhost', '::1']) {
    const ok = harness({ env: host ? { MOON_BASE_HOST: host } : {} })
    await start([], ok.io)
    assert.ok(!/anyone on that network/i.test(ok.text()), String(host))
  }
})

// ── what it prints ────────────────────────────────────────────────────────────

test('it prints plain lines and never the environment', async () => {
  const secret = '/very/secret/home-dir-sentinel'
  const h = harness({ env: { ...CMUX, MOON_BASE_HOME: secret, MOON_BASE_DATA: secret, PATH: secret, CMUX_SOCKET_PATH: secret } })
  await start([], h.io)
  const text = h.text()
  assert.ok(!text.includes(secret))
  assert.ok(!text.includes('ws-1') && !text.includes('sf-1'), 'not even the ids')
  assert.ok(!/\u001b\[/.test(text), 'no escape codes')
})

test('help is a usage message and starts nothing', async () => {
  for (const flag of ['--help', '-h']) {
    const h = harness()
    assert.equal(await start([flag], h.io), 0)
    assert.match(h.out.join('\n'), /--no-open/)
    assert.equal(h.calls.served.length, 0)
  }
})

test('a start that fails says why by its error code, and never echoes the host it was told to use', async () => {
  const h = harness({
    env: { MOON_BASE_HOST: '10.9.8.7' },
    serve: async () => {
      throw Object.assign(new Error('listen EADDRNOTAVAIL: address not available 10.9.8.7:5274'), { code: 'EADDRNOTAVAIL' })
    },
  })
  assert.equal(await start([], h.io), 1)
  assert.match(h.err.join('\n'), /Could not start/)
  assert.match(h.err.join('\n'), /EADDRNOTAVAIL/)
  assert.ok(!h.err.join('\n').includes('10.9.8.7'), 'the address it was given is not printed back')
})

// ── against a real server ─────────────────────────────────────────────────────

test('against a real server: it starts, is found by identity, and a second start reuses it', async () => {
  const data = await fsp.mkdtemp(path.join(os.tmpdir(), 'start-real-'))
  const dist = path.join(data, 'dist')
  await fsp.mkdir(dist)
  await fsp.writeFile(path.join(dist, 'index.html'), '<title>real</title>')
  // Not from the system's own choice: those ports are handed out one after another, so a server another
  // test file is running right now would sit inside the range this searches, and be found, and reused. A
  // port from a range nothing else here uses, checked free, keeps this test to itself.
  const free = await (async () => {
    for (let tries = 0; tries < 50; tries++) {
      const port = 20000 + Math.floor(Math.random() * 20000)
      const ok = await new Promise((resolve) => {
        const probe = net.createServer()
        probe.once('error', () => resolve(false))
        probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
      })
      if (ok) return port
    }
    throw new Error('no free port found in 20000-40000')
  })()

  // The server reads these when it is first loaded, and the launcher from the process environment, as in real use.
  const saved = Object.fromEntries(['MOON_BASE_DATA', 'MOON_BASE_CMUX_DIR', 'MOON_BASE_TERMINAL', 'CMUX_WORKSPACE_ID', 'CMUX_SURFACE_ID'].map((k) => [k, process.env[k]]))
  process.env.MOON_BASE_DATA = data
  process.env.MOON_BASE_CMUX_DIR = path.join(data, 'no-cmux')
  delete process.env.MOON_BASE_TERMINAL
  Object.assign(process.env, CMUX)

  const real = await import('../server/serve.mjs')
  let handle
  const shared = {
    env: process.env,
    root: '/repo',
    out: () => {},
    err: () => {},
    build: { state: async () => ({ state: 'fresh' }) },
  }
  try {
    const first = harness()
    const code = await start(['--no-open', '--port', String(free)], {
      ...shared,
      out: first.io.out,
      open: first.io.open,
      serve: async (options) => (handle = await real.serve({ ...options, dist })),
    })
    assert.equal(code, 0)
    assert.equal(handle.port, free, 'the port it was asked for, because it was free')
    assert.match(first.out.join('\n'), /launcher is on/i)

    const identity = await (await fetch(`http://127.0.0.1:${free}/api/identity`)).json()
    assert.equal(identity.app, 'moon-base')
    assert.deepEqual(identity.launcher, { id: 'cmux', label: 'cmux' }, 'inside cmux, the launcher is on in the real server')

    const second = harness()
    let started = false
    const again = await start(['--no-open', '--port', String(free)], {
      ...shared,
      out: second.io.out,
      serve: async () => {
        started = true
        throw new Error('a second server must not be started')
      },
    })
    assert.equal(again, 0)
    assert.equal(started, false)
    assert.match(second.out.join('\n'), /already running/i)
  } finally {
    await handle?.close()
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    await fsp.rm(data, { recursive: true, force: true })
  }
})
