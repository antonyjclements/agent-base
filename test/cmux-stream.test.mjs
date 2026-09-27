/**
 * AC14, the reader: cmux's event stream (`workstream.jsonl`) turned into the same normalised events the
 * hooks produce, reading only what it needs, tolerating everything a log can do, and never writing.
 *
 * The rows are the real shape with invented content, and every content field holds SENTINEL, so the
 * privacy rule (metadata only) is checked against something that would actually show a leak.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { SENTINEL, b64, cmuxRow, fakeCmux } from './support/fixtures.mjs'
import { CMUX_MAX_LINE, cmuxDir, cmuxFile, cmuxStatusEnabled, cmuxTail, parseCmuxRow } from '../server/hooks/cmux.mjs'

const NOW = Date.UTC(2026, 8, 26, 12)
const SID = '2edc9798-ed07-4ec1-8e47-5a2d51565b92'
const HOUR = 60 * 60 * 1000

const row = (o = {}) => cmuxRow({ sessionId: SID, at: NOW, ...o })

// ── what a row means ──────────────────────────────────────────────────────────

test('every kind maps onto the hook vocabulary, for both tools', () => {
  const table = [
    ['userPrompt', 'UserPromptSubmit'],
    ['toolUse', 'PostToolUse'],
    ['toolResult', 'PostToolUse'],
    ['permissionRequest', 'PermissionRequest'],
    ['question', 'PermissionRequest'],
    ['stop', 'Stop'],
    ['sessionEnd', 'SessionEnd'],
  ]
  for (const source of ['claude', 'codex']) {
    for (const [kind, event] of table) {
      const e = parseCmuxRow(row({ kind, source, cwd: '/tmp/x' }), NOW)
      assert.deepEqual(e, { tool: source, event, sessionId: SID, cwd: '/tmp/x', at: NOW }, `${source} ${kind}`)
    }
  }
})

test('a session starting says nothing about state', () => {
  assert.equal(parseCmuxRow(row({ kind: 'sessionStart' }), NOW), null)
})

test('an event carries five fields and nothing from the row’s content', () => {
  for (const kind of ['userPrompt', 'toolUse', 'toolResult', 'permissionRequest', 'question', 'stop']) {
    const e = parseCmuxRow(row({ kind }), NOW)
    assert.deepEqual(Object.keys(e).sort(), ['at', 'cwd', 'event', 'sessionId', 'tool'], kind)
    assert.ok(!JSON.stringify(e).includes(SENTINEL), `${kind} leaked content`)
  }
})

// ── the session id in workstreamId ────────────────────────────────────────────

test('workstreamId is read whether or not its base64 is padded', () => {
  for (const padded of [false, true]) {
    const id = `cmux-feed-v1:${b64('codex', padded)}:${b64(SID, padded)}`
    const e = parseCmuxRow(row({ source: 'codex', workstreamId: id }), NOW)
    assert.equal(e?.sessionId, SID, `padded=${padded}`)
  }
})

test('a workstreamId that is not exactly what cmux writes is refused', () => {
  const good = (s) => b64(s)
  const bad = [
    `cmux-feed-v2:${good('claude')}:${good(SID)}`, // another version of the format
    `${good('claude')}:${good(SID)}`, // two parts
    `cmux-feed-v1:${good('claude')}:${good(SID)}:extra`, // four parts
    `cmux-feed-v1::${good(SID)}`, // empty source
    `cmux-feed-v1:${good('claude')}:`, // empty id
    `cmux-feed-v1:!!!:${good(SID)}`, // not base64
    `cmux-feed-v1:${good('claude')}:!!!`,
    `cmux-feed-v1:${good('codex')}:${good(SID)}`, // decoded source is not the row's source
    `cmux-feed-v1:${good('cursor')}:${good(SID)}`, // a tool Moon Base does not know
    `cmux-feed-v1:${good('claude')}:${good('not a session id!')}`, // fails the id pattern
    `cmux-feed-v1:${good('claude')}:${good('x')}`, // too short
    `cmux-feed-v1:${good('claude')}:${good(SID).slice(0, 8)}!!${good(SID).slice(8)}`, // junk that a lenient decoder would skip
    `cmux-feed-v1:${good('claude').slice(0, 4)} ${good('claude').slice(4)}:${good(SID)}`, // whitespace inside
    '',
    null,
    5,
  ]
  for (const workstreamId of bad) {
    assert.equal(parseCmuxRow(row({ workstreamId }), NOW), null, JSON.stringify(workstreamId))
  }
})

// ── the row itself ────────────────────────────────────────────────────────────

test('anything that is not a well-formed row is ignored', () => {
  const rows = [
    '',
    'not json',
    '[]',
    'null',
    '5',
    '"a string"',
    JSON.stringify({}),
    row({ kind: 'somethingNew' }),
    row({ kind: 5 }),
    row({ source: 'cursor' }),
    row({ source: 5, workstreamId: 'cmux-feed-v1:NQ:MmVkYzk3OTgtZWQwNy00ZWMxLTgyMzktNWQyMzM1MWE1YjBh' }), // a number where the tool should be
    row({ extra: { kind: undefined } }),
    'x'.repeat(CMUX_MAX_LINE + 1),
  ]
  for (const r of rows) assert.equal(parseCmuxRow(r, NOW), null, String(r).slice(0, 40))
  assert.equal(parseCmuxRow(undefined, NOW), null)
  assert.equal(parseCmuxRow(42, NOW), null)
})

test('a missing or odd folder is fine, and a missing or odd time becomes the arrival time', () => {
  assert.equal(parseCmuxRow(row({ extra: { cwd: undefined } }), NOW).cwd, undefined)
  assert.equal(parseCmuxRow(row({ extra: { cwd: 5 } }), NOW).cwd, undefined)
  assert.equal(parseCmuxRow(row({ extra: { cwd: '/a'.repeat(400) } }), NOW).cwd.length, 512)
  for (const createdAt of [undefined, 'yesterday', 5, null, '']) {
    assert.equal(parseCmuxRow(row({ extra: { createdAt } }), NOW).at, NOW, JSON.stringify(createdAt))
  }
})

test('an event may not claim to be newer than it is, and an old one stays old', () => {
  const future = parseCmuxRow(row({ at: NOW + 6 * 60 * 1000 }), NOW)
  assert.equal(future.at, NOW)
  const nearFuture = parseCmuxRow(row({ at: NOW + 60 * 1000 }), NOW)
  assert.equal(nearFuture.at, NOW + 60 * 1000)
  const old = parseCmuxRow(row({ at: NOW - 3 * HOUR }), NOW)
  assert.equal(old.at, NOW - 3 * HOUR)
})

// ── the switch and the location ───────────────────────────────────────────────

test('only off, 0, false and no switch the source off, in any case', () => {
  for (const value of ['off', 'OFF', 'Off', '0', 'false', 'FALSE', 'no', 'No']) {
    assert.equal(cmuxStatusEnabled({ MOON_BASE_CMUX_STATUS: value }), false, value)
  }
  for (const value of [undefined, '', 'on', '1', 'true', 'yes', 'auto', 'of', 'offf', ' off']) {
    assert.equal(cmuxStatusEnabled({ MOON_BASE_CMUX_STATUS: value }), true, JSON.stringify(value))
  }
  assert.equal(cmuxStatusEnabled({}), true)
})

test('the stream is in ~/.cmuxterm unless MOON_BASE_CMUX_DIR says otherwise', () => {
  assert.equal(cmuxDir({}, '/home/me'), path.join('/home/me', '.cmuxterm'))
  assert.equal(cmuxFile({}, '/home/me'), path.join('/home/me', '.cmuxterm', 'workstream.jsonl'))
  assert.equal(cmuxFile({ MOON_BASE_CMUX_DIR: '/elsewhere' }, '/home/me'), path.join('/elsewhere', 'workstream.jsonl'))
})

// ── following the file ────────────────────────────────────────────────────────

async function withStream(fn, options = {}) {
  const cmux = await fakeCmux()
  const clock = { now: NOW }
  const tail = cmuxTail(cmux.file, { now: () => clock.now, ...options })
  try {
    return await fn({ ...cmux, tail, clock })
  } finally {
    await cmux.rm()
  }
}

const kinds = (events) => events.map((e) => e.event)

test('rows are read in order as they arrive, and junk between them is skipped', async () => {
  await withStream(async ({ tail, append }) => {
    assert.deepEqual(await tail.readNew(), [])
    await append(row({ kind: 'userPrompt' }), 'not json', row({ kind: 'sessionStart' }), row({ kind: 'toolUse' }))
    assert.deepEqual(kinds(await tail.readNew()), ['UserPromptSubmit', 'PostToolUse'])
    await append(row({ kind: 'stop' }))
    assert.deepEqual(kinds(await tail.readNew()), ['Stop'])
    assert.deepEqual(await tail.readNew(), [])
  })
})

test('a half-written last line waits until it is finished', async () => {
  await withStream(async ({ tail, file }) => {
    const full = row({ kind: 'stop' })
    await fsp.writeFile(file, full.slice(0, 40), { mode: 0o644 })
    assert.deepEqual(await tail.readNew(), [])
    await fsp.appendFile(file, full.slice(40) + '\n')
    assert.deepEqual(kinds(await tail.readNew()), ['Stop'])
  })
})

test('a file that is truncated, or replaced by a new one, is read again from its start', async () => {
  await withStream(async ({ tail, file, append }) => {
    await append(row({ kind: 'userPrompt' }), row({ kind: 'toolUse' }), row({ kind: 'toolUse' }))
    assert.equal((await tail.readNew()).length, 3)

    await fsp.writeFile(file, '') // truncated, as `cmux feed clear` would leave it
    await append(row({ kind: 'stop' }))
    assert.deepEqual(kinds(await tail.readNew()), ['Stop'])

    await fsp.rm(file) // replaced: a new file at the same path
    await append(row({ kind: 'permissionRequest' }))
    assert.deepEqual(kinds(await tail.readNew()), ['PermissionRequest'])
  })
})

test('a long row that is still being written is waited for, not dropped', async () => {
  await withStream(async ({ tail, file }) => {
    const long = row({ kind: 'toolUse', extra: { payload: { toolUse: { toolInputJSON: 'z'.repeat(100 * 1024) } } } })
    assert.ok(long.length > 4096 && long.length < CMUX_MAX_LINE, 'long, but well inside the limit')
    await fsp.writeFile(file, long.slice(0, 60 * 1024), { mode: 0o644 })
    assert.deepEqual(await tail.readNew(), [])
    await fsp.appendFile(file, long.slice(60 * 1024) + '\n')
    assert.deepEqual(kinds(await tail.readNew()), ['PostToolUse'])
  })
})

test('a row too long to keep is skipped, and the rows after it are still read', async () => {
  await withStream(async ({ tail, append }) => {
    const huge = row({ kind: 'toolUse', extra: { payload: { toolUse: { toolInputJSON: 'y'.repeat(CMUX_MAX_LINE + 100) } } } })
    await append(row({ kind: 'userPrompt' }), huge, row({ kind: 'stop' }))
    assert.deepEqual(kinds(await tail.readNew()), ['UserPromptSubmit', 'Stop'])
  })
})

test('a file that was already there is replayed for the last six hours, and no further back', async () => {
  await withStream(async ({ tail, append }) => {
    await append(
      row({ kind: 'toolUse', at: NOW - 7 * HOUR }),
      row({ kind: 'permissionRequest', at: NOW - 5 * HOUR }),
      row({ kind: 'toolUse', at: NOW - 60 * 1000 })
    )
    const events = await tail.readNew()
    assert.deepEqual(kinds(events), ['PermissionRequest', 'PostToolUse'])
    assert.equal(events[0].at, NOW - 5 * HOUR, 'a prompt left waiting for hours is still waiting')
  })
})

test('a big old file is replayed from its recent end, not from its start', async () => {
  await withStream(
    async ({ tail, append }) => {
      const filler = Array.from({ length: 40 }, () => row({ kind: 'toolUse', at: NOW - 2 * HOUR }))
      await append(row({ kind: 'permissionRequest', at: NOW - HOUR }), ...filler, row({ kind: 'stop', at: NOW - 60 * 1000 }))
      const events = await tail.readNew()
      assert.equal(events.at(-1).event, 'Stop')
      assert.ok(events.length < 42, 'the oldest rows fell outside the replay window')
    },
    { seedBytes: 20 * 1024 }
  )
})

test('the file is only read when it is the current user’s and nobody else can write to it', async () => {
  await withStream(async ({ tail, file, dir, append }) => {
    await append(row({ kind: 'stop' }))
    await fsp.chmod(file, 0o666)
    assert.deepEqual(await tail.readNew(), [])
    assert.equal(tail.problem, 'not-private')

    await fsp.chmod(file, 0o644) // mode 0644 is how cmux writes it, and is fine
    assert.deepEqual(kinds(await tail.readNew()), ['Stop'])
    assert.equal(tail.problem, null)

    await fsp.chmod(dir, 0o777)
    await append(row({ kind: 'userPrompt' }))
    assert.deepEqual(await tail.readNew(), [])
    assert.equal(tail.problem, 'not-private')
    await fsp.chmod(dir, 0o700)
  })
})

test('why nothing came back is recorded: not read yet, missing, not a file', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cmux-missing-'))
  await fsp.chmod(dir, 0o700)
  try {
    const tail = cmuxTail(path.join(dir, 'workstream.jsonl'), { now: () => NOW })
    assert.equal(tail.problem, 'unread')
    assert.equal(tail.present, false)
    assert.deepEqual(await tail.readNew(), [])
    assert.equal(tail.problem, 'missing')
    assert.equal(tail.present, false)

    const asDir = cmuxTail(dir, { now: () => NOW }) // a folder where the file should be
    assert.deepEqual(await asDir.readNew(), [])
    assert.ok(['not-a-file', 'not-private'].includes(asDir.problem), asDir.problem)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('a file that cannot be opened is recorded as unreadable, and the error still reaches the caller', async (t) => {
  if (process.getuid?.() === 0) return t.skip('root can read a mode-000 file')
  await withStream(async ({ tail, file, append }) => {
    await append(row({ kind: 'stop' }))
    await fsp.chmod(file, 0o000)
    await assert.rejects(tail.readNew(), (err) => err.code === 'EACCES')
    assert.equal(tail.problem, 'unreadable', 'not "read fine, said nothing"')
    await fsp.chmod(file, 0o644)
    assert.deepEqual(kinds(await tail.readNew()), ['Stop'])
    assert.equal(tail.problem, null, 'and it recovers when it can be read again')
  })
})

test('cmux’s file is never renamed, rotated or written, however large it grows', async () => {
  await withStream(
    async ({ tail, file, dir, append }) => {
      await append(...Array.from({ length: 20 }, () => row({ kind: 'toolUse' })))
      const before = await fsp.readFile(file, 'utf8')
      await tail.readNew()
      await tail.readNew()
      assert.equal(await fsp.readFile(file, 'utf8'), before, 'the file is byte-for-byte what cmux wrote')
      assert.deepEqual(await fsp.readdir(dir), ['workstream.jsonl'], 'no `.1` beside it')
    },
    { maxBytes: 100 }
  )
})

test('nothing from a row’s content survives the tail', async () => {
  await withStream(async ({ tail, append }) => {
    await append(...['userPrompt', 'toolUse', 'toolResult', 'permissionRequest', 'question', 'stop'].map((kind) => row({ kind })))
    const events = await tail.readNew()
    assert.equal(events.length, 6)
    assert.ok(!JSON.stringify(events).includes(SENTINEL))
  })
})
