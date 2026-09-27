/**
 * AC13, the part that has no server in it: what may go into a terminal command, how a folder is
 * quoted, which launcher the environment names, and what a launcher failure is reported as.
 *
 * `shellQuote` is checked against a real `sh`, because a quoting test that only compares strings
 * proves nothing about what a shell does with them.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { cmuxSessionOpen, cmuxSessionsSummary, commandLine, foregroundArgv, launcherArgv, launcherFromEnv, pasteLine, runForeground, runLauncher, shellQuote } from '../server/lib/terminal.mjs'
import { cmuxProcessTree, cmuxReadScreen } from '../server/lib/terminal.mjs'

const ID = '019cc762-45a2-7112-89cd-cd345c17e834'

test('screen status commands are bounded read-only argument lists and invalid targets run nothing', async () => {
  const calls = []
  const run = (cmd, args, options, done) => { calls.push({ cmd, args, options }); done(null, args.includes('top') ? '{"windows":[]}' : 'visible text') }
  assert.deepEqual(await cmuxProcessTree(run), { windows: [] })
  assert.equal(await cmuxReadScreen({ workspace: ID, surface: ID }, run), 'visible text')
  assert.deepEqual(calls.map(c => [c.cmd, ...c.args]), [
    ['cmux', '--json', '--id-format', 'uuids', 'top', '--all', '--processes'],
    ['cmux', 'read-screen', '--workspace', ID, '--surface', ID],
  ])
  assert.ok(calls.every(c => c.options.timeout === 1200 && c.options.maxBuffer <= 1024 * 1024 && !c.options.shell))
  assert.equal(await cmuxReadScreen({ workspace: '--focus', surface: ID }, run), null)
  assert.equal(calls.length, 2)
  for (const failure of [(_c, _a, _o, done) => done(Error('secret'), 'secret'), () => { throw Error('secret') }]) {
    assert.equal(await cmuxProcessTree(failure), null)
    assert.equal(await cmuxReadScreen({ workspace: ID, surface: ID }, failure), null)
  }
  assert.equal(await cmuxProcessTree((_c, _a, _o, done) => done(null, 'malformed')), null)
})

// ── what may go into a command ────────────────────────────────────────────────

test('a command is its tokens joined by single spaces', () => {
  assert.equal(commandLine(['claude']), 'claude')
  assert.equal(commandLine(['claude', '--resume', ID]), `claude --resume ${ID}`)
  assert.equal(commandLine(['codex', 'resume', ID]), `codex resume ${ID}`)
})

test('any token that could carry shell syntax refuses the whole command', () => {
  const bad = [
    'claude; touch x',
    'a b',
    '$(touch x)',
    '`touch x`',
    'a\nb',
    'a\rb',
    'a\tb',
    'a|b',
    'a&b',
    'a>b',
    'a<b',
    "a'b",
    'a"b',
    'a\\b',
    'a/b',
    '~',
    '*',
    '?',
    '!',
    '#',
    '=',
    '{a,b}',
    '(a)',
    '',
    'é',
    'x'.repeat(129),
  ]
  for (const token of bad) {
    assert.equal(commandLine(['claude', token]), null, JSON.stringify(token))
    assert.equal(commandLine([token]), null, JSON.stringify(token))
  }
})

test('only a real, short list of string tokens makes a command', () => {
  for (const argv of [undefined, null, 'claude', {}, [], [1], [null], [['claude']], [{ toString: () => 'claude' }], Array(9).fill('a')]) {
    assert.equal(commandLine(argv), null, JSON.stringify(argv))
  }
})

// ── quoting a folder for a pasted line ────────────────────────────────────────

const NASTY = [
  'plain',
  'a b',
  "it's",
  "'''",
  '"dq"',
  '$(touch x)',
  '`touch x`',
  '${HOME}',
  '$HOME',
  'a;touch x',
  'a&&touch x',
  'a|touch x',
  'a\\b',
  'a\\',
  '*',
  '~',
  '!important',
  '%s',
  '-n',
  '--help',
  'é日本',
  '',
]

test('a quoted string comes out of a real shell exactly as it went in, and runs nothing', async () => {
  const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'quote-'))
  try {
    for (const value of NASTY) {
      const out = execFileSync('sh', ['-c', `printf %s ${shellQuote(value)}`], { cwd, encoding: 'utf8' })
      assert.equal(out, value, JSON.stringify(value))
    }
    assert.deepEqual(await fsp.readdir(cwd), [], 'no quoted string ran anything')
  } finally {
    await fsp.rm(cwd, { recursive: true, force: true })
  }
})

test('the pasted line changes into the folder, then runs the command', () => {
  assert.equal(pasteLine({ argv: ['claude'], cwd: '/tmp/a b' }), "cd '/tmp/a b' && claude")
  assert.equal(pasteLine({ argv: ['codex', 'resume', ID], cwd: "/tmp/it's" }), `cd '/tmp/it'\\''s' && codex resume ${ID}`)
})

test('a line that cannot be made safely is refused, not made less safe', () => {
  const ok = { argv: ['claude'], cwd: '/tmp/a' }
  assert.equal(pasteLine(ok), "cd '/tmp/a' && claude")
  for (const cwd of ['/tmp/a\nb', '/tmp/a\rb', '/tmp/a\u0000b', '/tmp/a\u001bb', '/tmp/a\u007fb', '/tmp/a\tb', 'relative/dir', '', '/'.padEnd(2000, 'a'), 5, null, ['/tmp/a']]) {
    assert.equal(pasteLine({ ...ok, cwd }), null, JSON.stringify(cwd))
  }
  assert.equal(pasteLine({ argv: ['claude', '; touch x'], cwd: '/tmp/a' }), null)
  assert.equal(pasteLine({ argv: [], cwd: '/tmp/a' }), null)
})

// ── which launcher the environment names ──────────────────────────────────────

test('cmux is the only launcher, and only when the environment says exactly that', () => {
  assert.deepEqual(launcherFromEnv({ MOON_BASE_TERMINAL: 'cmux' }), { id: 'cmux', label: 'cmux' })
  for (const value of [undefined, '', 'CMUX', ' cmux', 'cmux ', 'cmux;touch x', 'sh', 'sh -c evil', 'osascript', 'open', '/usr/bin/cmux', 'constructor', '__proto__', 'toString']) {
    assert.equal(launcherFromEnv({ MOON_BASE_TERMINAL: value }), null, JSON.stringify(value))
  }
  assert.equal(launcherFromEnv({}), null)
})

test('the cmux argument list keeps the folder out of the command text', () => {
  const argv = launcherArgv('cmux', { argv: ['claude', '--resume', ID], cwd: "/tmp/it's a $(folder)" })
  assert.deepEqual(argv, ['cmux', 'new-workspace', '--cwd', "/tmp/it's a $(folder)", '--command', `claude --resume ${ID}`, '--focus', 'true'])
})

test('there is no argument list for another launcher, a bad command or a bad folder', () => {
  assert.equal(launcherArgv('sh', { argv: ['claude'], cwd: '/tmp/a' }), null)
  assert.equal(launcherArgv('constructor', { argv: ['claude'], cwd: '/tmp/a' }), null)
  assert.equal(launcherArgv('cmux', { argv: ['claude; x'], cwd: '/tmp/a' }), null)
  assert.equal(launcherArgv('cmux', { argv: ['claude'], cwd: '/tmp/a\nb' }), null)
  assert.equal(launcherArgv('cmux', { argv: ['claude'], cwd: 'relative' }), null)
})

// ── running it, and saying what went wrong ────────────────────────────────────

/** An `execFile` that answers the way a failing or succeeding child would. */
const fakeExec = (answer, seen = []) => (file, args, options, done) => {
  seen.push({ file, args, options })
  answer(done)
}

test('the launcher runs once, as an argument list, with no shell and a time limit', async () => {
  const seen = []
  const argv = ['cmux', 'new-workspace', '--cwd', '/tmp/a', '--command', 'claude', '--focus', 'true']
  const result = await runLauncher(argv, fakeExec((done) => done(null, '', ''), seen))
  assert.deepEqual(result, { ok: true })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].file, 'cmux')
  assert.deepEqual(seen[0].args, argv.slice(1))
  assert.ok(!seen[0].options.shell, 'no shell')
  assert.ok(seen[0].options.timeout > 0 && seen[0].options.timeout <= 15000, 'bounded')
})

test('a launcher failure is reported as a fixed message, never as the tool’s own output', async () => {
  const secret = 'SECRET-PATH-/Users/somebody/private'
  const failures = [
    [Object.assign(new Error(`spawn cmux ENOENT ${secret}`), { code: 'ENOENT' }), '', '', /not on PATH/i],
    [Object.assign(new Error(`failed ${secret}`), { code: 1 }), '', `Error: ERROR: Access denied - only processes started inside cmux can connect ${secret}`, /inside a cmux terminal/i],
    [Object.assign(new Error(`timed out ${secret}`), { killed: true, signal: 'SIGTERM' }), '', '', /did not answer/i],
    [Object.assign(new Error(`odd ${secret}`), { code: 2 }), '', `something else ${secret}`, /could not open/i],
  ]
  for (const [err, stdout, stderr, expected] of failures) {
    const result = await runLauncher(['cmux', 'new-workspace'], fakeExec((done) => done(err, stdout, stderr)))
    assert.equal(result.ok, false)
    assert.match(result.error, expected)
    assert.ok(!result.error.includes(secret), 'nothing from the tool reaches the page')
    assert.deepEqual(Object.keys(result).sort(), ['error', 'ok'])
  }
})

// ── asking cmux whether a session is already open ──────────────────────────────

/** A `run` that answers the way `execFile('cmux', ['sessions', ...])` would. */
const fakeSessions = (stdout, seen = []) => (file, args, options, done) => {
  seen.push({ file, args, options })
  done(null, stdout, '')
}

test('cmuxSessionOpen asks for exactly one session and reads whether its stored pid is real', async () => {
  const seen = []
  const stdout = JSON.stringify({
    sessions: [
      { session_id: 'other', stored_pid_exists: true, workspace_id: 'nope' },
      { session_id: 'abc', stored_pid_exists: true, workspace_id: 'W1' },
    ],
  })
  const result = await cmuxSessionOpen('claude', 'abc', fakeSessions(stdout, seen))
  assert.deepEqual(result, { open: true, workspaceId: 'W1' })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].file, 'cmux')
  assert.deepEqual(seen[0].args, ['sessions', '--agent', 'claude', '--session', 'abc', '--json'])
  assert.ok(!seen[0].options.shell, 'no shell')
})

test('a session cmux has not stored, or whose stored pid is gone, reads as not open', async () => {
  const notFound = JSON.stringify({ sessions: [] })
  assert.deepEqual(await cmuxSessionOpen('claude', 'abc', fakeSessions(notFound)), { open: false, workspaceId: '' })

  const stalePid = JSON.stringify({ sessions: [{ session_id: 'abc', stored_pid_exists: false }] })
  assert.deepEqual(await cmuxSessionOpen('claude', 'abc', fakeSessions(stalePid)), { open: false, workspaceId: '' })

  const noFlag = JSON.stringify({ sessions: [{ session_id: 'abc' }] })
  assert.deepEqual(await cmuxSessionOpen('claude', 'abc', fakeSessions(noFlag)), { open: false, workspaceId: '' })
})

test('anything cmux is not expected to say is read as not open, never as a crash', async () => {
  const oddities = [
    (file, args, options, done) => done(new Error('cmux: unknown command'), '', 'error'),
    (file, args, options, done) => done(null, 'not json', ''),
    (file, args, options, done) => done(null, '[]', ''),
    (file, args, options, done) => done(null, JSON.stringify({ sessions: 'nope' }), ''),
    (file, args, options, done) => done(null, JSON.stringify({ sessions: [null, 5, { session_id: 'abc', stored_pid_exists: 'yes' }] }), ''),
    () => {
      throw new Error('execFile itself threw')
    },
  ]
  for (const run of oddities) {
    const result = await cmuxSessionOpen('claude', 'abc', run)
    assert.equal(result.open, false)
  }
})

// ── what cmux knows, for the doctor ───────────────────────────────────────────

test('cmuxSessionsSummary counts the Claude sessions cmux knows, and returns nothing else about them', async () => {
  const seen = []
  const stdout = JSON.stringify({
    sessions: [
      { session_id: 'secret-id-1', cwd: '/secret/folder', stored_pid_exists: true },
      { session_id: 'secret-id-2', cwd: '/secret/other', stored_pid_exists: false },
    ],
    stores: [{ path: '/secret/store.json' }],
  })
  const result = await cmuxSessionsSummary(fakeSessions(stdout, seen))
  assert.deepEqual(result, { answered: true, count: 2 })
  assert.ok(!JSON.stringify(result).includes('secret'), 'no id, folder or path leaves this function')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].file, 'cmux')
  assert.deepEqual(seen[0].args, ['sessions', '--agent', 'claude', '--json'])
  assert.ok(!seen[0].options.shell, 'no shell')
})

test('the count is the total cmux says it holds, not just the page of it that was listed', async () => {
  const capped = JSON.stringify({ limit: 100, total_matches: 130, sessions: [{ session_id: 'a' }] })
  assert.deepEqual(await cmuxSessionsSummary(fakeSessions(capped)), { answered: true, count: 130 })
  for (const total of ['many', -1, 1.5, null]) {
    const odd = JSON.stringify({ total_matches: total, sessions: [{ session_id: 'a' }, { session_id: 'b' }] })
    assert.deepEqual(await cmuxSessionsSummary(fakeSessions(odd)), { answered: true, count: 2 }, String(total))
  }
})

test('an empty list is an answer, and the answer is zero', async () => {
  assert.deepEqual(await cmuxSessionsSummary(fakeSessions(JSON.stringify({ sessions: [] }))), { answered: true, count: 0 })
})

test('a cmux that is missing, fails, or says something unexpected is not an answer, and never a crash', async () => {
  const missing = Object.assign(new Error('spawn cmux ENOENT'), { code: 'ENOENT' })
  assert.deepEqual(await cmuxSessionsSummary((file, args, options, done) => done(missing, '', '')), { answered: false, why: 'missing' })

  const failures = [
    (file, args, options, done) => done(new Error('cmux: unknown command'), '', 'error'),
    (file, args, options, done) => done(null, 'not json', ''),
    (file, args, options, done) => done(null, '[]', ''),
    (file, args, options, done) => done(null, JSON.stringify({ sessions: 'nope' }), ''),
    (file, args, options, done) => done(null, JSON.stringify({}), ''),
    () => {
      throw new Error('execFile itself threw')
    },
  ]
  for (const run of failures) assert.deepEqual(await cmuxSessionsSummary(run), { answered: false, why: 'failed' }, String(run))
})

// ── bringing cmux itself forward ────────────────────────────────────────────────

test('bringing the app forward is only ever `open -a cmux`, only for cmux, only on macOS', () => {
  assert.deepEqual(foregroundArgv('cmux', 'darwin'), ['open', '-a', 'cmux'])
  for (const [id, platform] of [
    ['cmux', 'linux'],
    ['cmux', 'win32'],
    ['sh', 'darwin'],
    ['', 'darwin'],
    [undefined, 'darwin'],
    ['constructor', 'darwin'],
  ]) {
    assert.equal(foregroundArgv(id, platform), null, `${id}/${platform}`)
  }
})

test('bringing the app forward never rejects, whatever the child does', async () => {
  const cases = [
    (file, args, options, done) => done(null, '', ''),
    (file, args, options, done) => done(new Error('cmux quit')),
    () => {
      throw new Error('execFile itself threw')
    },
  ]
  for (const run of cases) {
    await assert.doesNotReject(runForeground(['open', '-a', 'cmux'], run))
  }
})

test('bringing the app forward runs the exact argument list, with no shell', async () => {
  const seen = []
  await runForeground(['open', '-a', 'cmux'], (file, args, options, done) => {
    seen.push({ file, args, options })
    done(null, '', '')
  })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].file, 'open')
  assert.deepEqual(seen[0].args, ['-a', 'cmux'])
  assert.ok(!seen[0].options.shell)
})

test('bringing the app forward says whether it worked, so the one caller that cares can tell', async () => {
  assert.deepEqual(await runForeground(['open', '-a', 'cmux'], (file, args, options, done) => done(null, '', '')), { ok: true })
  assert.deepEqual(await runForeground(['open', '-a', 'cmux'], (file, args, options, done) => done(new Error('Unable to find application'), '', '')), { ok: false })
  assert.deepEqual(
    await runForeground(['open', '-a', 'cmux'], () => {
      throw new Error('execFile itself threw')
    }),
    { ok: false }
  )
})

test('a launcher that throws when it is started is a failure too, not a crash', async () => {
  const result = await runLauncher(['cmux'], () => {
    throw new Error('boom')
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /could not open/i)
})
