/**
 * AC15, one command with subcommands: `moonbase1` on its own starts Moon Base, `doctor` runs the doctor,
 * and the hook commands go where they always went. And the rule that keeps the two worlds apart:
 * nothing the server or the page runs can reach the command line code.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { dispatch } from '../cli/dispatch.mjs'

const ROOT = new URL('..', import.meta.url).pathname

function harness() {
  const calls = []
  const out = []
  const err = []
  const io = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    start: async (argv) => (calls.push(['start', argv]), 0),
    doctor: async (argv) => (calls.push(['doctor', argv]), 0),
    hooks: async (argv) => (calls.push(['hooks', argv]), 7),
  }
  return { io, calls, out, err }
}

test('no arguments, or start, starts Moon Base', async () => {
  for (const [argv, passed] of [[[], []], [['start'], []], [['start', '--no-open'], ['--no-open']]]) {
    const h = harness()
    assert.equal(await dispatch(argv, h.io), 0)
    assert.deepEqual(h.calls, [['start', passed]], JSON.stringify(argv))
  }
})

test('a first argument that is a start option is a start', async () => {
  for (const argv of [['--no-open'], ['--port', '6000'], ['--port=6000', '--no-open']]) {
    const h = harness()
    await dispatch(argv, h.io)
    assert.deepEqual(h.calls, [['start', argv]], JSON.stringify(argv))
  }
})

test('doctor runs the doctor', async () => {
  const h = harness()
  await dispatch(['doctor'], h.io)
  await dispatch(['doctor', '--anything'], h.io)
  assert.deepEqual(h.calls, [['doctor', []], ['doctor', ['--anything']]])
})

test('the hook commands go to the hook installer with their arguments untouched, and its exit code comes back', async () => {
  for (const argv of [['install-hooks'], ['install-hooks', '--dry-run', '--tool', 'codex'], ['uninstall-hooks'], ['hooks-status']]) {
    const h = harness()
    assert.equal(await dispatch(argv, h.io), 7, JSON.stringify(argv))
    assert.deepEqual(h.calls, [['hooks', argv]])
  }
})

test('help is usage on the normal channel and exits 0', async () => {
  for (const argv of [['--help'], ['-h'], ['help']]) {
    const h = harness()
    assert.equal(await dispatch(argv, h.io), 0, JSON.stringify(argv))
    assert.equal(h.calls.length, 0)
    const text = h.out.join('\n')
    for (const word of ['moonbase1', 'doctor', 'install-hooks', 'uninstall-hooks', 'hooks-status', '--no-open', '--port']) {
      assert.ok(text.includes(word), `usage names ${word}`)
    }
  }
})

test('an unknown command is usage on the error channel, exit 2, and nothing runs', async () => {
  for (const argv of [['nope'], ['install'], ['Doctor'], ['start-now']]) {
    const h = harness()
    assert.equal(await dispatch(argv, h.io), 2, JSON.stringify(argv))
    assert.equal(h.calls.length, 0)
    assert.match(h.err.join('\n'), /Unknown command/)
    assert.match(h.err.join('\n'), /moonbase1/)
  }
})

// ── the two worlds ────────────────────────────────────────────────────────────

test('nothing under server/ or src/ imports the command line code, or the hook installer', async () => {
  const walk = async (dir) => {
    const found = []
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) found.push(...(await walk(p)))
      else if (/\.m?js$/.test(e.name)) found.push(p)
    }
    return found
  }
  for (const dir of ['server', 'src']) {
    for (const file of await walk(path.join(ROOT, dir))) {
      const text = await fsp.readFile(file, 'utf8')
      assert.doesNotMatch(text, /from ['"][^'"]*\/(cli|hooks\/(cli|install|diff))(\.mjs|\/)/, `${path.relative(ROOT, file)} reaches the command line code`)
      assert.doesNotMatch(text, /import\(['"][^'"]*\/cli\//, `${path.relative(ROOT, file)} reaches the command line code`)
    }
  }
})

test('the package exposes exactly one command, moonbase1, at the entry that dispatches', async () => {
  const pkg = JSON.parse(await fsp.readFile(path.join(ROOT, 'package.json'), 'utf8'))
  assert.deepEqual(pkg.bin, { moonbase1: 'bin/moon-base.mjs' })
  assert.equal(pkg.scripts['moon-base'], 'node bin/moon-base.mjs')
  const entry = await fsp.readFile(path.join(ROOT, 'bin', 'moon-base.mjs'), 'utf8')
  assert.match(entry, /^#!\/usr\/bin\/env node/)
  assert.match(entry, /dispatch/)
  const mode = (await fsp.stat(path.join(ROOT, 'bin', 'moon-base.mjs'))).mode
  assert.ok(mode & 0o100, 'the entry is executable, which `npm link` relies on')
})
