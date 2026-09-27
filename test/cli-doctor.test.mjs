/**
 * AC15, `moonbase1 doctor`: what start would decide and why, and for each live source whether it is
 * reporting and, if not, the reason. It reads and reports; it never starts anything, never prints a
 * message's content or an environment value, and always exits 0.
 *
 * Every folder here is a temp one passed in through the environment object, so no real home is read.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { SENTINEL, cmuxRow, fakeCmux, writeMarker } from './support/fixtures.mjs'
import { doctor } from '../cli/doctor.mjs'
import { LiveStatus } from '../server/hooks/live.mjs'

const NOW = Date.UTC(2026, 8, 26, 12)
const MIN = 60 * 1000
const CMUX_ENV = { CMUX_WORKSPACE_ID: 'ws-1', CMUX_SURFACE_ID: 'sf-1' }

async function withWorld(fn) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'doctor-'))
  const moonHome = path.join(root, 'moon-home')
  const cmux = await fakeCmux()
  const hooksDir = path.join(moonHome, 'events')
  await fsp.mkdir(hooksDir, { recursive: true, mode: 0o700 })
  await fsp.chmod(hooksDir, 0o700)
  await fsp.chmod(moonHome, 0o700)
  const hooksFile = path.join(hooksDir, 'events.jsonl')
  const hook = (o = {}) => fsp.appendFile(hooksFile, JSON.stringify({ v: 1, ts: NOW - 1000, tool: 'claude', event: 'UserPromptSubmit', sessionId: '2edc9798-ed07-4ec1-8e47-5a2d51565b92', ...o }) + '\n', { mode: 0o600 })
  try {
    return await fn({ root, moonHome, cmux, hook, hooksFile })
  } finally {
    await cmux.rm()
    await fsp.rm(root, { recursive: true, force: true })
  }
}

/** Run the doctor against a fake world. */
async function diagnose(world, { env = {}, ports = { 5274: { kind: 'free' } }, build = { state: 'fresh' }, markers = new Map(), asked, cmuxSessions = async () => ({ answered: false, why: 'missing' }) } = {}) {
  const lines = []
  const code = await doctor([], {
    env: { MOON_BASE_HOME: world.moonHome, MOON_BASE_CMUX_DIR: world.cmux.dir, ...env },
    home: world.root,
    root: '/repo',
    now: () => NOW,
    out: (l) => lines.push(l),
    err: (l) => lines.push(l),
    probe: async (p, o) => (asked?.push(o?.host), ports[p] ?? { kind: 'other' }),
    build: { state: async () => build },
    markers: async () => markers,
    cmuxSessions,
  })
  return { code, text: lines.join('\n'), lines }
}

// The adapter reads where Claude keeps its files when it is first imported, which the doctor does only
// when it is asked for markers it was not handed. So this is set before any test runs.
const claudeConfig = await fsp.mkdtemp(path.join(os.tmpdir(), 'doctor-claude-'))
process.env.CLAUDE_CONFIG_DIR = claudeConfig
process.env.MOON_BASE_CLAUDE_DESKTOP = path.join(claudeConfig, 'no-desktop')

const line = (text, label) => text.split('\n').find((l) => l.trim().toLowerCase().startsWith(label.toLowerCase())) ?? ''

// ── start ─────────────────────────────────────────────────────────────────────

test('it says whether it is inside cmux and what the launcher will be', async () => {
  await withWorld(async (w) => {
    let r = await diagnose(w, { env: CMUX_ENV })
    assert.match(line(r.text, 'inside cmux'), /yes/i)
    assert.match(line(r.text, 'terminal launcher'), /turned on for you/i)

    r = await diagnose(w)
    assert.match(line(r.text, 'inside cmux'), /no/i)
    assert.match(line(r.text, 'terminal launcher'), /off/i)
    assert.match(line(r.text, 'terminal launcher'), /copy/i)

    r = await diagnose(w, { env: { ...CMUX_ENV, MOON_BASE_TERMINAL: 'sentinel-value-abc' } })
    assert.match(line(r.text, 'terminal launcher'), /MOON_BASE_TERMINAL/)
    assert.ok(!r.text.includes('sentinel-value-abc'), 'the value is not printed')
  })
})

test('it says which port start would use, or which copy it would reuse', async () => {
  await withWorld(async (w) => {
    assert.match(line((await diagnose(w)).text, 'port'), /5274.*free/i)
    const running = { 5274: { kind: 'free' }, 5276: { kind: 'moon-base', identity: { app: 'moon-base', version: '0.1.0', launcher: null } } }
    assert.match(line((await diagnose(w, { ports: running })).text, 'port'), /already running.*5276/i)
    assert.match(line((await diagnose(w, { ports: {} })).text, 'port'), /no free port/i)
  })
})

test('it looks for a running copy where start would, and never prints the address it was configured with', async () => {
  await withWorld(async (w) => {
    const running = { 5274: { kind: 'moon-base', identity: { app: 'moon-base', version: '0.1.0', launcher: null } } }
    for (const [host, expected] of [['::1', '[::1]'], ['10.9.8.7', '10.9.8.7'], ['0.0.0.0', '127.0.0.1'], [undefined, '127.0.0.1']]) {
      const asked = []
      const r = await diagnose(w, { env: host ? { MOON_BASE_HOST: host } : {}, ports: running, asked })
      assert.ok(asked.length > 0 && asked.every((a) => a === expected), `${host}: asked ${asked}`)
      assert.match(line(r.text, 'port'), /already running on port 5274/i, String(host))
      if (host) assert.ok(!r.text.includes(host), `${host}: an environment value is not printed`)
    }
  })
})

test('the missing cmux stream is explained as its Claude Code integration being off, not as cmux being uninstalled', async () => {
  await withWorld(async (w) => {
    const row = line((await diagnose(w)).text, 'cmux stream')
    assert.match(row, /not found/i)
    assert.match(row, /claude code integration/i)
    assert.match(row, /claude.s own busy marker/i, 'and says what status comes from instead')
    assert.ok(!/installed/i.test(row), row)
  })
})

const terminalMarkers = (n, cli = true) => new Map(Array.from({ length: n }, (_, i) => [`session-${i}`, { status: 'idle', at: NOW, cli }]))

test('the resume check says what cmux knows, and what the fallback sees when it knows nothing', async () => {
  await withWorld(async (w) => {
    const cases = [
      [{ answered: true, count: 3 }, terminalMarkers(2), [/cmux knows 3 Claude sessions/i, /claude.s own marker is checked too/i, /2 live terminal sessions/i]],
      [{ answered: true, count: 1 }, terminalMarkers(0), [/cmux knows 1 Claude session\b/i, /0 live terminal sessions/i]],
      [{ answered: true, count: 0 }, terminalMarkers(1), [/cmux answers but knows no claude sessions/i, /none is open in cmux, or its claude code integration is off/i, /falls back to claude.s own marker/i, /1 live terminal session\b/i]],
      [{ answered: false, why: 'missing' }, terminalMarkers(1), [/cmux command was not found/i, /falls back to claude.s own marker/i, /1 live terminal session\b/i]],
      [{ answered: false, why: 'failed' }, terminalMarkers(0), [/cmux did not answer/i, /falls back to claude.s own marker/i]],
    ]
    for (const [known, markers, expected] of cases) {
      const row = line((await diagnose(w, { cmuxSessions: async () => known, markers })).text, 'resume check')
      assert.ok(row, JSON.stringify(known))
      for (const re of expected) assert.match(row, re, `${JSON.stringify(known)} -> ${row}`)
    }
  })
})

test('desktop-app sessions are not counted as terminal ones, in the markers row or the resume check', async () => {
  await withWorld(async (w) => {
    const markers = new Map([...terminalMarkers(2), ...new Map([['desk-1', { status: 'idle', at: NOW, cli: false }], ['desk-2', { status: 'busy', at: NOW, cli: false }]])])
    const r = await diagnose(w, { markers, cmuxSessions: async () => ({ answered: true, count: 0 }) })
    assert.match(line(r.text, 'claude'), /4 live sessions.*2 in a terminal/i)
    assert.match(line(r.text, 'resume check'), /2 live terminal sessions/i)
  })
})

test('a cmux check that throws is read as not answering, and the doctor still finishes', async () => {
  await withWorld(async (w) => {
    const r = await diagnose(w, {
      cmuxSessions: async () => {
        throw new Error('boom')
      },
    })
    assert.equal(r.code, 0)
    assert.match(line(r.text, 'resume check'), /cmux did not answer/i)
  })
})

test('the resume check prints counts only: no session id, folder or message', async () => {
  await withWorld(async (w) => {
    const markers = new Map([[SENTINEL, { status: 'busy', at: NOW, cli: true, cwd: `/${SENTINEL}` }]])
    const r = await diagnose(w, { markers, cmuxSessions: async () => ({ answered: true, count: 1, ids: [SENTINEL], cwd: SENTINEL }) })
    assert.ok(!r.text.includes(SENTINEL), 'nothing the sessions said is printed')
  })
})

test('it says whether the build is fresh, stale or missing', async () => {
  await withWorld(async (w) => {
    for (const [state, expected] of [['fresh', /fresh/i], ['stale', /stale.*source changed/i], ['missing', /missing.*build/i]]) {
      assert.match(line((await diagnose(w, { build: { state } })).text, 'build'), expected, state)
    }
  })
})

// ── live sources ──────────────────────────────────────────────────────────────

test('hooks: reporting, quiet, not there, and refused each get their own reason', async () => {
  await withWorld(async (w) => {
    assert.match(line((await diagnose(w)).text, 'hooks'), /no events file/i)

    await w.hook({ ts: NOW - 20 * 1000 })
    assert.match(line((await diagnose(w)).text, 'hooks'), /reporting.*20 seconds? ago/i)

    await fsp.rm(w.hooksFile)
    await w.hook({ ts: NOW - 30 * MIN })
    assert.match(line((await diagnose(w)).text, 'hooks'), /nothing in the last 10 minutes/i)

    await fsp.chmod(w.hooksFile, 0o666)
    assert.match(line((await diagnose(w)).text, 'hooks'), /refused.*write/i)
  })
})

test('cmux: reporting, quiet, not there, refused, unreadable, and switched off each get their own reason', async () => {
  await withWorld(async (w) => {
    assert.match(line((await diagnose(w)).text, 'cmux stream'), /not found/i)

    await w.cmux.append(cmuxRow({ kind: 'userPrompt', at: NOW - 3000 }))
    assert.match(line((await diagnose(w)).text, 'cmux stream'), /reporting.*3 seconds? ago/i)

    await fsp.rm(w.cmux.file)
    await w.cmux.append(cmuxRow({ kind: 'userPrompt', at: NOW - 2 * 60 * MIN }))
    assert.match(line((await diagnose(w)).text, 'cmux stream'), /nothing in the last 10 minutes/i)

    await w.cmux.append('not a row')
    assert.match(line((await diagnose(w)).text, 'cmux stream'), /nothing in the last 10 minutes/i)

    await fsp.chmod(w.cmux.file, 0o666)
    assert.match(line((await diagnose(w)).text, 'cmux stream'), /refused.*write/i)
    await fsp.chmod(w.cmux.file, 0o644)

    for (const off of ['off', '0', 'false', 'no']) {
      assert.match(line((await diagnose(w, { env: { MOON_BASE_CMUX_STATUS: off } })).text, 'cmux stream'), /switched off.*MOON_BASE_CMUX_STATUS/i, off)
    }
  })
})

test('a cmux file that cannot be opened is reported as not readable, not as quiet', async (t) => {
  if (process.getuid?.() === 0) return t.skip('root can read a mode-000 file')
  await withWorld(async (w) => {
    await w.cmux.append(cmuxRow({ kind: 'userPrompt', at: NOW - 1000 }))
    await fsp.chmod(w.cmux.file, 0o000)
    try {
      assert.match(line((await diagnose(w)).text, 'cmux stream'), /not readable/i)
    } finally {
      await fsp.chmod(w.cmux.file, 0o644)
    }
  })
})

test('a switched-off cmux stream is never handed to the live status, so it is never opened', async () => {
  await withWorld(async (w) => {
    const seen = []
    const run = (env) =>
      doctor([], {
        env: { MOON_BASE_HOME: w.moonHome, MOON_BASE_CMUX_DIR: w.cmux.dir, ...env },
        home: w.root,
        root: '/repo',
        now: () => NOW,
        out: () => {},
        probe: async () => ({ kind: 'free' }),
        build: { state: async () => ({ state: 'fresh' }) },
        markers: async () => new Map(),
        cmuxSessions: async () => ({ answered: false, why: 'missing' }),
        makeLive: (options) => {
          seen.push(options)
          return new LiveStatus(options)
        },
      })
    await run({})
    await run({ MOON_BASE_CMUX_STATUS: 'off' })
    assert.equal(seen[0].cmuxFile, w.cmux.file, 'on: the stream is given')
    assert.equal(seen[1].cmuxFile, undefined, 'off: there is no stream to open')
  })
})

test('a switched-off cmux stream is not opened at all', async () => {
  await withWorld(async (w) => {
    await w.cmux.append(cmuxRow({ kind: 'userPrompt', at: NOW - 1000 }))
    await fsp.chmod(w.cmux.file, 0o666) // if anything read it, the doctor would say "refused" instead
    const r = await diagnose(w, { env: { MOON_BASE_CMUX_STATUS: 'off' } })
    assert.ok(!/refused/i.test(line(r.text, 'cmux stream')))
  })
})

test('Claude’s own markers are counted, busy and idle', async () => {
  await withWorld(async (w) => {
    assert.match(line((await diagnose(w)).text, 'claude'), /no live sessions/i)
    const markers = new Map([['a', { status: 'busy', at: NOW }], ['b', { status: 'idle', at: NOW }], ['c', { status: 'idle', at: NOW }], ['d', { status: '', at: 0 }]])
    assert.match(line((await diagnose(w, { markers })).text, 'claude'), /4 live sessions.*1 busy.*2 idle/i)
    assert.match(line((await diagnose(w, { markers: new Map([['a', { status: 'busy', at: NOW }]]) })).text, 'claude'), /1 live session\b.*1 busy/i)
  })
})

// ── what it never says ────────────────────────────────────────────────────────

test('it never prints a row’s content, an environment value, or a path', async () => {
  await withWorld(async (w) => {
    await w.cmux.append(...['userPrompt', 'toolUse', 'permissionRequest', 'question', 'stop'].map((kind) => cmuxRow({ kind, at: NOW - 1000 })))
    await w.hook({ ts: NOW - 1000 })
    const secret = '/very/secret/home-sentinel'
    const r = await diagnose(w, { env: { ...CMUX_ENV, PATH: secret, MOON_BASE_DATA: secret, CMUX_SOCKET_PATH: secret } })
    assert.ok(!r.text.includes(SENTINEL), 'no message content')
    assert.ok(!r.text.includes(secret), 'no environment value')
    assert.ok(!r.text.includes(w.root), 'no temp folder path')
    assert.ok(!r.text.includes(w.cmux.dir), 'no cmux folder path')
    assert.ok(!r.text.includes('ws-1') && !r.text.includes('sf-1'), 'no ids')
    assert.ok(!/\u001b\[/.test(r.text), 'no escape codes')
  })
})

test('it exits 0 whatever it finds, and says nothing failed when things are simply off', async () => {
  await withWorld(async (w) => {
    assert.equal((await diagnose(w)).code, 0)
    await fsp.chmod(w.cmux.dir, 0o777)
    await w.cmux.append('x')
    assert.equal((await diagnose(w, { build: { state: 'missing' }, ports: {} })).code, 0)
    await fsp.chmod(w.cmux.dir, 0o700)
  })
})

test('it starts nothing and writes nothing', async () => {
  await withWorld(async (w) => {
    await w.cmux.append(cmuxRow({ kind: 'stop', at: NOW - 1000 }))
    await w.hook()
    const before = [await fsp.readFile(w.cmux.file, 'utf8'), await fsp.readFile(w.hooksFile, 'utf8')]
    const filesBefore = [await fsp.readdir(w.cmux.dir), await fsp.readdir(path.dirname(w.hooksFile))]
    await diagnose(w)
    assert.deepEqual([await fsp.readFile(w.cmux.file, 'utf8'), await fsp.readFile(w.hooksFile, 'utf8')], before)
    assert.deepEqual([await fsp.readdir(w.cmux.dir), await fsp.readdir(path.dirname(w.hooksFile))], filesBefore)
  })
})

test('with no markers handed to it, it reads the real ones: this process is a live session, busy', async () => {
  await withWorld(async (w) => {
    await writeMarker(claudeConfig, { pid: process.pid, sessionId: '3f0a9c1e-4b6d-4e7a-8c2b-1d5e6f7a8b9c', status: 'busy' })
    const lines = []
    await doctor([], {
      env: { MOON_BASE_HOME: w.moonHome, MOON_BASE_CMUX_DIR: w.cmux.dir },
      home: w.root,
      root: '/repo',
      now: () => Date.now(),
      out: (l) => lines.push(l),
      probe: async (p) => (p === 5274 ? { kind: 'free' } : { kind: 'other' }),
      build: { state: async () => ({ state: 'fresh' }) },
      cmuxSessions: async () => ({ answered: false, why: 'missing' }),
    })
    assert.match(line(lines.join('\n'), 'claude'), /1 live session\b.*1 busy.*1 in a terminal/i)
  })
})

test.after(async () => {
  await fsp.rm(claudeConfig, { recursive: true, force: true })
})
