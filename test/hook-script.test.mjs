/**
 * The hook script that Claude Code and Codex run on every event.
 *
 * It must be invisible to the tool that calls it: silent on stdout and stderr, exit 0 whatever
 * happens, quick, and bounded. It records only what the map needs (which session, which event) and
 * nothing the person typed or a tool returned. What it writes is readable by their user alone.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SCRIPT = new URL('../hooks/moon-base-hook.mjs', import.meta.url).pathname
const SID = '01a0dbe1-e660-7c61-999c-16e6243ba432'

async function withHome(fn) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'hook-home-'))
  try {
    return await fn(home, path.join(home, 'events', 'events.jsonl'))
  } finally {
    await fsp.rm(home, { recursive: true, force: true })
  }
}

function run(home, tool, stdin) {
  return spawnSync(process.execPath, [SCRIPT, tool], {
    input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
    env: { ...process.env, MOON_BASE_HOME: home },
    encoding: 'utf8',
    timeout: 10000,
  })
}

const lines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

test('an event becomes one line naming the tool, the event and the session', async () => {
  await withHome((home, file) => {
    const done = run(home, 'claude', { hook_event_name: 'UserPromptSubmit', session_id: SID, cwd: '/tmp/demo' })
    assert.equal(done.status, 0)
    const [event] = lines(file)
    assert.equal(event.v, 1)
    assert.equal(event.tool, 'claude')
    assert.equal(event.event, 'UserPromptSubmit')
    assert.equal(event.sessionId, SID)
    assert.equal(event.cwd, '/tmp/demo')
    assert.equal(typeof event.ts, 'number')
  })
})

test('Codex turn ids and Claude notification types are kept', async () => {
  await withHome((home, file) => {
    run(home, 'codex', { hook_event_name: 'Stop', session_id: SID, turn_id: 'turn-1' })
    run(home, 'claude', { hook_event_name: 'Notification', session_id: SID, notification_type: 'permission_prompt' })
    const [a, b] = lines(file)
    assert.equal(a.turnId, 'turn-1')
    assert.equal(b.notificationType, 'permission_prompt')
  })
})

test('nothing the person typed or a tool returned is ever written', async () => {
  await withHome((home, file) => {
    run(home, 'claude', {
      hook_event_name: 'PostToolUse',
      session_id: SID,
      cwd: '/tmp/demo',
      prompt: 'SECRET-PROMPT',
      transcript_path: '/somewhere/SECRET-PATH.jsonl',
      tool_name: 'Bash',
      tool_input: { command: 'SECRET-COMMAND' },
      tool_response: { stdout: 'SECRET-OUTPUT' },
      last_assistant_message: 'SECRET-REPLY',
      message: 'SECRET-MESSAGE',
    })
    const text = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /SECRET/)
    const [event] = lines(file)
    const allowed = ['v', 'ts', 'tool', 'event', 'sessionId', 'turnId', 'notificationType', 'cwd']
    assert.deepEqual(Object.keys(event).filter((k) => !allowed.includes(k)), [])
  })
})

test('it is silent, exits 0, and the events directory and file are private to the user', async () => {
  await withHome((home, file) => {
    const done = run(home, 'claude', { hook_event_name: 'Stop', session_id: SID })
    assert.equal(done.status, 0)
    assert.equal(done.stdout, '')
    assert.equal(done.stderr, '')
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700)
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  })
})

test('events append, in order', async () => {
  await withHome((home, file) => {
    for (const event of ['UserPromptSubmit', 'PostToolUse', 'Stop']) {
      run(home, 'claude', { hook_event_name: event, session_id: SID })
    }
    assert.deepEqual(lines(file).map((e) => e.event), ['UserPromptSubmit', 'PostToolUse', 'Stop'])
  })
})

test('garbage, empty and hostile input is ignored quietly', async () => {
  await withHome((home, file) => {
    const inputs = ['', 'not json', '{ "half": ', 'null', '[]', '"str"', '{}', JSON.stringify({ hook_event_name: 'Stop' })]
    for (const input of inputs) {
      const done = run(home, 'claude', input)
      assert.equal(done.status, 0, JSON.stringify(input))
      assert.equal(done.stdout + done.stderr, '')
    }
    assert.equal(fs.existsSync(file), false, 'nothing valid was sent, so nothing was written')
  })
})

test('an event or tool it does not know is ignored', async () => {
  await withHome((home, file) => {
    assert.equal(run(home, 'claude', { hook_event_name: 'FileChanged', session_id: SID }).status, 0)
    assert.equal(run(home, 'cursor', { hook_event_name: 'Stop', session_id: SID }).status, 0)
    assert.equal(run(home, '', { hook_event_name: 'Stop', session_id: SID }).status, 0)
    assert.equal(fs.existsSync(file), false)
  })
})

test('a session id that is not a plain id is ignored', async () => {
  await withHome((home, file) => {
    for (const session_id of ['../../etc/passwd', 'a b', 'x'.repeat(200), 5, null, { a: 1 }, 'evil\nid']) {
      assert.equal(run(home, 'claude', { hook_event_name: 'Stop', session_id }).status, 0)
    }
    assert.equal(fs.existsSync(file), false)
  })
})

test('a huge payload is bounded: it exits 0 and never writes an oversized line', async () => {
  await withHome((home, file) => {
    const payload = JSON.stringify({ hook_event_name: 'PostToolUse', session_id: SID, tool_response: 'x'.repeat(3 * 1024 * 1024) })
    const done = run(home, 'claude', payload)
    assert.equal(done.status, 0)
    if (fs.existsSync(file)) for (const l of fs.readFileSync(file, 'utf8').split('\n')) assert.ok(l.length < 4096)
  })
})

test('a long cwd is cut, not written whole', async () => {
  await withHome((home, file) => {
    run(home, 'claude', { hook_event_name: 'Stop', session_id: SID, cwd: '/' + 'a'.repeat(5000) })
    for (const l of fs.readFileSync(file, 'utf8').split('\n')) assert.ok(l.length < 4096)
  })
})

test('it exits 0 and writes nothing when the events directory cannot be created', async () => {
  await withHome(async (home) => {
    const blocker = path.join(home, 'blocker')
    await fsp.writeFile(blocker, 'a file where a directory should be')
    const done = run(path.join(blocker, 'nested'), 'claude', { hook_event_name: 'Stop', session_id: SID })
    assert.equal(done.status, 0)
    assert.equal(done.stdout + done.stderr, '')
  })
})

test('it refuses to write into a directory that other users can write to', async () => {
  await withHome(async (home, file) => {
    await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o777 })
    await fsp.chmod(path.dirname(file), 0o777)
    const done = run(home, 'claude', { hook_event_name: 'Stop', session_id: SID })
    assert.equal(done.status, 0)
    assert.equal(fs.existsSync(file), false)
  })
})

test('it is quick', async () => {
  await withHome((home) => {
    const started = Date.now()
    run(home, 'claude', { hook_event_name: 'Stop', session_id: SID })
    assert.ok(Date.now() - started < 2000)
  })
})
